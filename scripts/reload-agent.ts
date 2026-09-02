/**
 * scripts/reload-agent.ts — make an edited instruction file reach a running agent.
 *
 * Usage (on the server, as the nanoclaw user):
 *   pnpm exec tsx scripts/reload-agent.ts <agent-group-name>
 *
 * Why this exists: `groups/<folder>/CLAUDE.md` is a list of imports whose skill
 * fragments are symlinks into the read-only `/app/skills` mount, so a `git pull`
 * already changes what the next query reads from disk. What does NOT change is
 * the conversation the agent is in the middle of — it keeps answering from the
 * rules that were in context when the session started. `/clear` drops that
 * continuation, which is why it is the documented way to make an edit visible
 * (docs/claude-md-composition.md, "Reload semantics").
 *
 * The command is injected as an ordinary chat row in inbound.db, which is the
 * same path the router takes for a message arriving from Telegram — including
 * its routing fields, without which the container's reply has no address and
 * `deliverMessage()` drops it. That makes this a second host-side writer on
 * inbound.db while the service runs: deliberate, and safe because both writers
 * are local processes on the same filesystem and `writeSessionMessage()` opens
 * and closes the file per call, which is what the single-writer invariant in
 * docs/db.md is protecting (host vs container across the mount). Nothing here
 * touches outbound.db, which the container owns.
 */
import path from 'path';

import { DATA_DIR } from '../src/config.js';
import { getAllAgentGroups } from '../src/db/agent-groups.js';
import { initDb } from '../src/db/connection.js';
import { getMessagingGroup } from '../src/db/messaging-groups.js';
import { getActiveSessions } from '../src/db/sessions.js';
import { writeSessionMessage } from '../src/session-manager.js';
import type { MessagingGroup, Session } from '../src/types.js';

export function selectSessionsToClear(sessions: Session[], agentGroupId: string): Session[] {
  return sessions.filter((s) => s.agent_group_id === agentGroupId);
}

export function buildClearMessage(
  session: Session,
  messagingGroup: Pick<MessagingGroup, 'platform_id' | 'channel_type'> | undefined,
): {
  id: string;
  kind: string;
  timestamp: string;
  platformId: string | null;
  channelType: string | null;
  threadId: string | null;
  content: string;
  trigger: 0 | 1;
} {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'chat',
    timestamp: new Date().toISOString(),
    // Routing rides on the row itself: the container derives the whole batch's
    // reply address from its oldest message, so a null here would also strand
    // the answer to a real user message that arrives before the container wakes.
    platformId: messagingGroup?.platform_id ?? null,
    channelType: messagingGroup?.channel_type ?? null,
    threadId: session.thread_id,
    content: JSON.stringify({ text: '/clear' }),
    trigger: 1,
  };
}

function main(): void {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: pnpm exec tsx scripts/reload-agent.ts <agent-group-name>');
    process.exit(2);
  }

  initDb(path.join(DATA_DIR, 'v2.db'));

  const group = getAllAgentGroups().find((g) => g.name === name);
  if (!group) {
    const known = getAllAgentGroups()
      .map((g) => g.name)
      .join(', ');
    console.error(`No agent group named "${name}". Known groups: ${known || '(none)'}`);
    process.exit(1);
  }

  const sessions = selectSessionsToClear(getActiveSessions(), group.id);
  if (sessions.length === 0) {
    console.log(`No active session for "${name}" — nothing to clear; the next message starts fresh anyway.`);
    return;
  }

  for (const session of sessions) {
    const messagingGroup = session.messaging_group_id ? getMessagingGroup(session.messaging_group_id) : undefined;
    if (!messagingGroup) {
      // Without an address the container's "Session cleared." goes nowhere, so
      // the operator would never learn the reload silently did half its job.
      console.error(`Session ${session.id} has no messaging group — skipped, clear it from the chat with /clear.`);
      continue;
    }
    writeSessionMessage(group.id, session.id, buildClearMessage(session, messagingGroup));
    console.log(`Queued /clear for session ${session.id} (${name}).`);
  }
}

// Only run the CLI when invoked directly, so the tests can import the helpers.
if (process.argv[1] && /reload-agent\.ts$/.test(process.argv[1])) {
  main();
}
