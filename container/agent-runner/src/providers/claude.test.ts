import { describe, it, expect } from 'bun:test';

import { SDK_DISALLOWED_TOOLS, TOOL_ALLOWLIST, CLAUDE_ENV_DEFAULTS } from './claude.js';

// Regression: after an image rebuild the SDK started deferring tools behind
// ToolSearch. `mcp__nanoclaw__send_message` was no longer directly visible, so
// the agent loaded the name-alike builtin `SendMessage` (Claude Code's
// agent-to-agent inbox) instead. It reported success, and every reply was
// swallowed — nothing reached the channel.
describe('claude provider tool policy', () => {
  for (const builtin of ['SendMessage', 'TeamCreate', 'TeamDelete']) {
    it(`does not expose the ${builtin} builtin`, () => {
      expect(TOOL_ALLOWLIST).not.toContain(builtin);
      expect(SDK_DISALLOWED_TOOLS).toContain(builtin);
    });
  }

  it('keeps tools directly visible instead of deferring them behind ToolSearch', () => {
    expect(CLAUDE_ENV_DEFAULTS.ENABLE_TOOL_SEARCH).toBe('0');
  });
});
