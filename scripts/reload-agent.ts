/**
 * scripts/reload-agent.ts — make an edited instruction file reach a running agent.
 *
 * Usage (on the server, as the nanoclaw user):
 *   pnpm exec tsx scripts/reload-agent.ts <agent-group-name>
 *
 * Why this exists: `groups/<folder>/CLAUDE.md` is composed from the files on
 * disk at every container start, so a `git pull` plus a container stop puts an
 * edited rule in force. What does NOT change is the conversation the agent is
 * in the middle of — it keeps answering from the
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
import { closeDb, initDb } from '../src/db/connection.js';
import { getMessagingGroup } from '../src/db/messaging-groups.js';
import { getActiveSessions, isTaskThread } from '../src/db/sessions.js';
// Registers the session mailbox writeSessionMessage goes through; the host and
// setup/register.ts import it the same way.
import '../src/mailbox/compose.js';
import { writeSessionMessage } from '../src/session-manager.js';
import type { MessagingGroup, Session } from '../src/types.js';

/**
 * The group's chat sessions. Task sessions are left out: each task series runs
 * in its own session that starts from the composed document anyway, and a
 * `/clear` there would have no chat to answer into.
 */
export function selectSessionsToClear(sessions: Session[], agentGroupId: string): Session[] {
  return sessions.filter((s) => s.agent_group_id === agentGroupId && !isTaskThread(s.thread_id));
}

export function buildClearMessage(
  session: Session,
  messagingGroup: Pick<MessagingGroup, 'platform_id' | 'channel_type'> | undefined,
): {
  id: string;
  kind: 'chat';
  timestamp: string;
  platformId: string | null;
  channelType: string | null;
  threadId: string | null;
  content: string;
  trigger: boolean;
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
    trigger: true,
  };
}

export async function reloadAgent(name: string): Promise<void> {
  await initDb(path.join(DATA_DIR, 'v2.db'));
  try {
    await queueClear(name);
  } finally {
    await closeDb();
  }
}

async function queueClear(name: string): Promise<void> {
  const groups = await getAllAgentGroups();
  const group = groups.find((g) => g.name === name);
  if (!group) {
    const known = groups.map((g) => g.name).join(', ');
    throw new Error(`No agent group named "${name}". Known groups: ${known || '(none)'}`);
  }

  const sessions = selectSessionsToClear(await getActiveSessions(), group.id);
  if (sessions.length === 0) {
    console.log(`No active session for "${name}" — nothing to clear; the next message starts fresh anyway.`);
    return;
  }

  for (const session of sessions) {
    const messagingGroup = session.messaging_group_id ? await getMessagingGroup(session.messaging_group_id) : undefined;
    if (!messagingGroup) {
      // Without an address the container's "Session cleared." goes nowhere, so
      // the operator would never learn the reload silently did half its job.
      console.error(`Session ${session.id} has no messaging group — skipped, clear it from the chat with /clear.`);
      continue;
    }
    await writeSessionMessage(group.id, session.id, buildClearMessage(session, messagingGroup));
    console.log(`Queued /clear for session ${session.id} (${name}).`);
  }
}

// Only run the CLI when invoked directly, so the tests can import the helpers.
if (process.argv[1] && /reload-agent\.ts$/.test(process.argv[1])) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: pnpm exec tsx scripts/reload-agent.ts <agent-group-name>');
    process.exit(2);
  }
  try {
    await reloadAgent(name);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
