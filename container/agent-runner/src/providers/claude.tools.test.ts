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

/** CLI pin lives in container/cli-tools.json — the only place that installs it. */
function pinnedCliVersion(): string {
  const tools = JSON.parse(fs.readFileSync(new URL('../../../cli-tools.json', import.meta.url), 'utf8')) as Array<{
    name: string;
    version: string;
  }>;
  const cli = tools.find((t) => t.name === '@anthropic-ai/claude-code');
  if (!cli) throw new Error('@anthropic-ai/claude-code not found in container/cli-tools.json');
  return cli.version;
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
//
// AskUserQuestion, EnterPlanMode and ExitPlanMode left the surface with CLI
// 2.1.280; upstream keeps disallowing them, which costs nothing and holds if
// a later CLI brings them back.
const KNOWN_ABSENT: string[] = ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'];

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

  // The allowlist may add tools to the surface (it does on CLI 2.1.280), but a
  // tool present without it and missing with it would mean the allowlist hides
  // something the agent then cannot reach.
  it('the bare surface adds nothing the allowlist mode lacks', () => {
    const withAllowlist = new Set(baseline.tools);
    expect(baseline.toolsBare.filter((t) => !withAllowlist.has(t))).toEqual([]);
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

  it('the deferral control proves the ToolSearch guard can see deferral', () => {
    expect(baseline.toolsDeferralControl).toContain('ToolSearch');
  });
});
