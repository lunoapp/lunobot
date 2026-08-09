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

# `capturedAt` is a timestamp and `toolsDisallowProbe` is a diagnostic of a
# mechanism upstream measured as nondeterministic — neither is drift.
node -e '
const fs = require("fs");
const [baselinePath, capturePath] = process.argv.slice(1);
const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const baseline = load(baselinePath);
const capture = load(capturePath);

const fields = ["cliVersion", "sdkVersion", "tools", "toolsBare", "variantTools"];
const drift = fields.filter((f) => JSON.stringify(baseline[f]) !== JSON.stringify(capture[f]));

if (drift.length === 0) {
  console.log(`Tool surface matches baseline (CLI ${capture.cliVersion}, SDK ${capture.sdkVersion}).`);
  process.exit(0);
}

console.error("\nTOOL SURFACE DRIFT — the built image does not match the recorded baseline.\n");
for (const f of drift) {
  if (Array.isArray(baseline[f])) {
    const gone = baseline[f].filter((t) => !capture[f].includes(t));
    const added = capture[f].filter((t) => !baseline[f].includes(t));
    if (gone.length) console.error(`  ${f}: disappeared -> ${gone.join(", ")}`);
    if (added.length) console.error(`  ${f}: appeared    -> ${added.join(", ")}`);
  } else {
    console.error(`  ${f}: ${baseline[f]} -> ${capture[f]}`);
  }
}
console.error(`
Review the change, then re-record the baseline and re-run the drift test:
  ${process.env.CONTAINER_RUNTIME || "docker"} run --rm --network none \\
    -v "$PWD/container/agent-runner/src":/app/src:ro \\
    --entrypoint bun <image> /app/src/providers/dump-sdk-tools.ts \\
    > container/agent-runner/src/providers/sdk-tools-baseline.json
`);
process.exit(1);
' "$BASELINE" "$CAPTURE"
