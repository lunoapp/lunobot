import { describe, it, expect } from 'bun:test';

import { SDK_DISALLOWED_TOOLS, TOOL_ALLOWLIST, CLAUDE_ENV_DEFAULTS } from './claude.js';

// Regression: after an image rebuild the SDK started deferring tools behind
// ToolSearch. `mcp__nanoclaw__send_message` was no longer directly visible, so
// the agent loaded the name-alike builtin `SendMessage` (Claude Code's
// agent-to-agent inbox) instead. It reported success, and every reply was
// swallowed — nothing reached the channel.
// (TeamCreate/TeamDelete were disallowed for the same reason; CLI 2.1.280
// no longer offers them.)
describe('claude provider tool policy', () => {
  it('does not expose the SendMessage builtin', () => {
    expect(TOOL_ALLOWLIST).not.toContain('SendMessage');
    expect(SDK_DISALLOWED_TOOLS).toContain('SendMessage');
  });

  it('keeps tools directly visible instead of deferring them behind ToolSearch', () => {
    expect(CLAUDE_ENV_DEFAULTS.ENABLE_TOOL_SEARCH).toBe('0');
  });
});
