#!/usr/bin/env bash
# Verify the freshly built agent image offers the tool surface the runner
# expects. The claude-code pin only fixes the npm package — its native binary
# is fetched at install time, so a rebuild can silently change which tools the
# model sees. When that happens the agent reaches for a name-alike tool and
# replies vanish, with nothing in any log. Fail the build instead.
#
# Usage: check-tool-surface.sh <image>:<tag>
set -euo pipefail

IMAGE="${1:?usage: check-tool-surface.sh <image>:<tag>}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE="$SCRIPT_DIR/agent-runner/src/providers/sdk-tools-baseline.json"

if [ ! -f "$BASELINE" ]; then
    echo "Tool-surface baseline missing: $BASELINE" >&2
    exit 1
fi

CAPTURE="$(mktemp)"
trap 'rm -f "$CAPTURE"' EXIT

echo "Capturing tool surface from ${IMAGE}..."
${CONTAINER_RUNTIME} run --rm --network none \
    -v "$SCRIPT_DIR/agent-runner/src":/app/src:ro \
    --entrypoint bun "$IMAGE" /app/src/providers/dump-sdk-tools.ts > "$CAPTURE"

# Compared as one set: every tool the capture saw, stable or flickering. Which
# capture mode a flickering tool landed in is noise (see dump-sdk-tools.ts), so
# comparing the per-mode lists fails builds on nothing. `capturedAt` and
# `toolsDisallowProbe` are diagnostics, not drift.
node -e '
const fs = require("fs");
const [baselinePath, capturePath] = process.argv.slice(1);
const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const baseline = load(baselinePath);
const capture = load(capturePath);
const surface = (c) => [...new Set([...(c.tools || []), ...(c.toolsBare || []), ...(c.variantTools || [])])].sort();

// The ToolSearch guard is only real if a deferred capture would show it. The
// control capture forces deferral; if ToolSearch is missing there, the CLI
// changed how deferral surfaces and the guard below proves nothing.
const control = capture.toolsDeferralControl || [];
if (!control.includes("ToolSearch")) {
  console.error("\nTOOL SURFACE CHECK BLIND — the deferral control capture shows no ToolSearch.");
  console.error("Find how this CLI version forces deferral and update DEFERRAL_ON in dump-sdk-tools.ts.\n");
  process.exit(1);
}
const now = surface(capture);
if (now.includes("ToolSearch")) {
  console.error("\nTOOL DEFERRAL IS ON — ToolSearch appears under the runner env (CLAUDE_ENV_DEFAULTS).\n");
  process.exit(1);
}

const drift = [];
for (const f of ["cliVersion", "sdkVersion"]) {
  if (baseline[f] !== capture[f]) drift.push(`  ${f}: ${baseline[f]} -> ${capture[f]}`);
}
const before = surface(baseline);
const gone = before.filter((t) => !now.includes(t));
const added = now.filter((t) => !before.includes(t));
if (gone.length) drift.push(`  tools disappeared -> ${gone.join(", ")}`);
if (added.length) drift.push(`  tools appeared    -> ${added.join(", ")}`);

if (drift.length === 0) {
  console.log(`Tool surface matches baseline (CLI ${capture.cliVersion}, SDK ${capture.sdkVersion}).`);
  process.exit(0);
}

console.error("\nTOOL SURFACE DRIFT — the built image does not match the recorded baseline.\n");
console.error(drift.join("\n"));
console.error(`
Review the change, then re-record the baseline and re-run the drift test:
  ${process.env.CONTAINER_RUNTIME || "docker"} run --rm --network none \\
    -v "$PWD/container/agent-runner/src":/app/src:ro \\
    --entrypoint bun <image> /app/src/providers/dump-sdk-tools.ts \\
    > container/agent-runner/src/providers/sdk-tools-baseline.json
`);
process.exit(1);
' "$BASELINE" "$CAPTURE"
