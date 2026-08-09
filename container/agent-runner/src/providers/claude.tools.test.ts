/**
 * Drift guard for the harness tool surface. sdk-tools-baseline.json is a wire
 * capture of every tool the pinned CLI offers under our configuration
 * (regenerate with dump-sdk-tools.ts — instructions in its header, and
 * container/build.sh re-captures on every image build).
 *
 * These tests catch two failure modes: a list entry naming a tool that does
 * not exist on the pinned surface, and a pin that moved without the fixture
 * being regenerated.
 */
import fs from 'fs';

import { SDK_DISALLOWED_TOOLS, TOOL_ALLOWLIST } from './claude.js';
import baseline from './sdk-tools-baseline.json';

/** CLI pin lives in the Dockerfile ARG — the only place that installs it. */
function pinnedCliVersion(): string {
  const dockerfile = fs.readFileSync(new URL('../../../Dockerfile', import.meta.url), 'utf8');
  const match = dockerfile.match(/^ARG CLAUDE_CODE_VERSION=(.+)$/m);
  if (!match) throw new Error('CLAUDE_CODE_VERSION not found in container/Dockerfile');
  return match[1].trim();
}

const installedSdkVersion = (
  JSON.parse(
    fs.readFileSync(new URL('../../node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

/**
 * Tools kept on a list although the capture never offers them. `ToolSearch`
 * only materialises when the CLI defers tools; the runner turns deferral off
 * (ENABLE_TOOL_SEARCH=0), so it is absent from a healthy capture — its
 * reappearance means deferral came back on and belongs in a failing test.
 */
const KNOWN_ABSENT: string[] = [];

// Membership checks run against stable ∪ variant: a tool that flickers on
// this pin (see dump-sdk-tools.ts header) is still a real tool.
const baselineTools = new Set<string>([...baseline.tools, ...baseline.variantTools]);

describe('sdk tool-surface drift guard', () => {
  it('fixture matches the pinned claude-code CLI version', () => {
    expect(baseline.cliVersion).toBe(pinnedCliVersion());
  });

  it('fixture matches the installed Agent SDK version', () => {
    expect(baseline.sdkVersion).toBe(installedSdkVersion);
  });

  it('allowedTools has no surface effect: the stable cores match', () => {
    expect([...baseline.tools].sort()).toEqual([...baseline.toolsBare].sort());
  });

  it('every allowlist entry names a real tool on this surface', () => {
    for (const name of TOOL_ALLOWLIST) {
      expect(baselineTools.has(name), `allowlist entry '${name}' not in captured surface`).toBe(true);
    }
  });

  it('every disallow entry names a real tool on this surface', () => {
    for (const name of SDK_DISALLOWED_TOOLS) {
      const real = baselineTools.has(name);
      const insurance = KNOWN_ABSENT.includes(name);
      expect(real || insurance, `disallow entry '${name}' is neither on the surface nor in KNOWN_ABSENT`).toBe(true);
    }
  });

  it('tool deferral stays off — ToolSearch must not appear on the surface', () => {
    expect(baselineTools.has('ToolSearch')).toBe(false);
  });
});
