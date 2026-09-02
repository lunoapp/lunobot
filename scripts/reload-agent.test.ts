/**
 * Unit tests for the pure half of scripts/reload-agent.ts.
 *
 * The assertions run against the container's own recogniser and routing
 * extractor rather than against the builder's fields, because "the runner
 * treats this row as /clear and can address the reply" is the property that
 * matters — re-reading what the builder just wrote would pass on a row the
 * container drops.
 */
import { describe, expect, it, vi } from 'vitest';

// formatter.ts pulls in destinations.ts, whose DB layer is Bun-only
// (`bun:sqlite`), and this suite runs under Node. The stub exists solely to
// break that import chain — `isClearCommand` and `extractRouting` below are
// the container's real implementations, which is the point of the file.
vi.mock('../container/agent-runner/src/destinations.js', () => ({
  findByRouting: () => undefined,
}));

import { extractRouting, isClearCommand } from '../container/agent-runner/src/formatter.js';
import type { MessageInRow } from '../container/agent-runner/src/db/messages-in.js';
import { buildClearMessage, selectSessionsToClear } from './reload-agent.js';
import type { MessagingGroup, Session } from '../src/types.js';

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    agent_group_id: 'ag-luno',
    messaging_group_id: 'mg-1',
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'stopped',
    last_active: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

const telegramGroup: Pick<MessagingGroup, 'platform_id' | 'channel_type'> = {
  platform_id: '-100123',
  channel_type: 'telegram',
};

/** The row as the container reads it back out of messages_in. */
function asRow(msg: ReturnType<typeof buildClearMessage>): MessageInRow {
  return {
    id: msg.id,
    seq: 2,
    kind: msg.kind,
    timestamp: msg.timestamp,
    status: 'pending',
    process_after: null,
    recurrence: null,
    tries: 0,
    trigger: msg.trigger,
    platform_id: msg.platformId,
    channel_type: msg.channelType,
    thread_id: msg.threadId,
    content: msg.content,
  };
}

describe('selectSessionsToClear', () => {
  it('keeps only the sessions of the requested agent group', () => {
    const sessions = [session('s1'), session('s2', { agent_group_id: 'ag-other' })];
    expect(selectSessionsToClear(sessions, 'ag-luno').map((s) => s.id)).toEqual(['s1']);
  });

  it('returns an empty list when the group has no active session', () => {
    expect(selectSessionsToClear([session('s1', { agent_group_id: 'ag-other' })], 'ag-luno')).toEqual([]);
  });
});

describe('buildClearMessage', () => {
  it('builds a row the runner recognises as the /clear command', () => {
    expect(isClearCommand(asRow(buildClearMessage(session('s1'), telegramGroup)))).toBe(true);
  });

  it('carries the routing the container needs to address its reply', () => {
    const row = asRow(buildClearMessage(session('s1', { thread_id: 'thread-7' }), telegramGroup));
    expect(extractRouting([row])).toMatchObject({
      platformId: '-100123',
      channelType: 'telegram',
      threadId: 'thread-7',
    });
  });

  it('does not strand a real message that lands in the same batch', () => {
    // The container derives one reply address for the whole batch from its
    // oldest row. A routing-less /clear as messages[0] would drop the answer
    // to the user's message with only a log line (src/delivery.ts).
    const clear = asRow(buildClearMessage(session('s1'), telegramGroup));
    const userMessage: MessageInRow = {
      ...clear,
      id: 'msg-user',
      seq: 4,
      content: JSON.stringify({ text: 'wie ist der Stand?' }),
    };
    const routing = extractRouting([clear, userMessage]);
    expect(routing.platformId).not.toBeNull();
    expect(routing.channelType).not.toBeNull();
  });

  it('gives every call its own id so two reloads never collide', () => {
    const a = buildClearMessage(session('s1'), telegramGroup);
    const b = buildClearMessage(session('s1'), telegramGroup);
    expect(a.id).not.toBe(b.id);
  });
});
