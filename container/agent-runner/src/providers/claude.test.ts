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
  // ListAgents (new in CLI 2.1.280) lists Claude Code's in-session agents —
  // the same name-alike trap: an agent asked "who can you message?" would
  // answer from it instead of from its NanoClaw destinations.
  // TaskCreate/TaskGet/TaskList/TaskUpdate are Claude Code's in-session todo
  // list. Named like `ncl tasks`, they are where an agent asked to "schedule a
  // task" lands instead — and nothing ever runs from that list.
  for (const builtin of ['SendMessage', 'ListAgents', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate']) {
    it(`does not expose the ${builtin} builtin`, () => {
      expect(TOOL_ALLOWLIST).not.toContain(builtin);
      expect(SDK_DISALLOWED_TOOLS).toContain(builtin);
    });
  }

  // Tool search stays at the CLI default: MCP tool definitions are deferred and
  // loaded on demand instead of filling the context on every request. The
  // allowlist must name ToolSearch, or the SDK filters it out and every
  // deferred tool becomes unreachable.
  it('leaves tool search at the CLI default and lets the agent reach it', () => {
    expect(CLAUDE_ENV_DEFAULTS).not.toHaveProperty('ENABLE_TOOL_SEARCH');
    expect(TOOL_ALLOWLIST).toContain('ToolSearch');
  });
});
