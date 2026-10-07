/**
 * scripts/migrate-legacy-tasks.ts — find and disarm scheduled tasks that still
 * live in chat sessions.
 *
 * Usage (on the server, as the nanoclaw user; --apply needs the service stopped):
 *   pnpm exec tsx scripts/migrate-legacy-tasks.ts           # dry run: list them
 *   pnpm exec tsx scripts/migrate-legacy-tasks.ts --apply   # disarm them
 *
 * Tasks created before `ncl tasks` were stored in the chat session that asked
 * for them, and they keep firing there: into a long conversation whose
 * compacted history can revive old topics. `ncl tasks` puts each series in its
 * own session. This script lists the old series so they can be recreated with
 * `ncl tasks create`, then disarms the old ones.
 *
 * A series is legacy when its latest row sits in a session that is not a task
 * session and still carries a recurrence that can fire or re-arm: pending,
 * paused, failed, or completed. Disarming reuses the mailbox's own cancel
 * (status 'cancelled', recurrence cleared) for the live pending/paused rows; a
 * row that already ran keeps its failed/completed outcome and only loses its
 * recurrence, so run history stays true.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { DATA_DIR } from '../src/config.js';
import { log } from '../src/log.js';
import { isTaskThread } from '../src/db/sessions.js';
import { cancelTask } from '../src/mailbox/sqlite/tasks.js';

export interface LegacyTask {
  agentGroupId: string;
  sessionId: string;
  seriesId: string;
  rowId: string;
  status: string;
  recurrence: string;
  processAfter: string | null;
  prompt: string;
}

interface SessionDir {
  agentGroupId: string;
  sessionId: string;
  inbound: string;
}

function sessionDirs(): SessionDir[] {
  const root = path.join(DATA_DIR, 'v2-sessions');
  if (!fs.existsSync(root)) return [];
  const out: SessionDir[] = [];
  for (const agentGroupId of fs.readdirSync(root)) {
    const groupDir = path.join(root, agentGroupId);
    if (agentGroupId.startsWith('.') || !fs.statSync(groupDir).isDirectory()) continue;
    for (const sessionId of fs.readdirSync(groupDir)) {
      const inbound = path.join(groupDir, sessionId, 'inbound.db');
      if (fs.existsSync(inbound)) out.push({ agentGroupId, sessionId, inbound });
    }
  }
  return out;
}

/** Session id → thread id, from the central DB. */
function sessionThreads(): Map<string, string | null> {
  const db = new Database(path.join(DATA_DIR, 'v2.db'), { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare('SELECT id, thread_id FROM sessions').all() as Array<{
      id: string;
      thread_id: string | null;
    }>;
    return new Map(rows.map((r) => [r.id, r.thread_id]));
  } finally {
    db.close();
  }
}

// The latest row of each series (highest seq), when it can still fire or re-arm.
const LEGACY_ROWS = `
  SELECT m.id, COALESCE(m.series_id, m.id) AS series_id, m.status, m.recurrence, m.process_after, m.content
    FROM messages_in m
   WHERE m.kind = 'task'
     AND m.recurrence IS NOT NULL
     AND m.status IN ('pending', 'paused', 'failed', 'completed')
     AND m.seq = (SELECT MAX(o.seq) FROM messages_in o
                   WHERE o.kind = 'task' AND COALESCE(o.series_id, o.id) = COALESCE(m.series_id, m.id))
   ORDER BY m.seq`;

function promptOf(content: string): string {
  try {
    const parsed = JSON.parse(content) as { prompt?: unknown };
    return typeof parsed.prompt === 'string' ? parsed.prompt : content;
  } catch {
    return content;
  }
}

function legacyIn(db: Database.Database, dir: SessionDir): LegacyTask[] {
  const rows = db.prepare(LEGACY_ROWS).all() as Array<{
    id: string;
    series_id: string;
    status: string;
    recurrence: string;
    process_after: string | null;
    content: string;
  }>;
  return rows.map((r) => ({
    agentGroupId: dir.agentGroupId,
    sessionId: dir.sessionId,
    seriesId: r.series_id,
    rowId: r.id,
    status: r.status,
    recurrence: r.recurrence,
    processAfter: r.process_after,
    prompt: promptOf(r.content),
  }));
}

/**
 * Session folders that belong to a known chat session. A folder without a
 * central `sessions` row is skipped: whether it was a chat or a task session
 * cannot be told, and an unknown series is not this script's to cancel.
 */
function chatSessionDirs(): SessionDir[] {
  const threads = sessionThreads();
  return sessionDirs().filter((d) => {
    if (!threads.has(d.sessionId)) {
      log.warn('Skipping session folder with no sessions row in the central DB', {
        agentGroupId: d.agentGroupId,
        sessionId: d.sessionId,
      });
      return false;
    }
    return !isTaskThread(threads.get(d.sessionId) ?? null);
  });
}

/**
 * A running host writes these mailboxes and re-arms recurring tasks as they
 * complete, so --apply would race it. The host's own liveness record is the
 * check: a `host_instances` row with a lease still ahead and no stop mark
 * (the same rule as listLiveHostInstances in src/db/coordination.ts).
 */
function assertHostStopped(): void {
  const db = new Database(path.join(DATA_DIR, 'v2.db'), { readonly: true, fileMustExist: true });
  try {
    const live = db
      .prepare('SELECT instance_id, pid FROM host_instances WHERE stopped_at IS NULL AND lease_expires_at > ?')
      .all(new Date().toISOString()) as Array<{ instance_id: string; pid: number | null }>;
    if (live.length > 0) {
      const who = live.map((h) => `${h.instance_id}${h.pid ? ` (pid ${h.pid})` : ''}`).join(', ');
      throw new Error(`The NanoClaw host is running (${who}). Stop the service, then rerun --apply.`);
    }
  } finally {
    db.close();
  }
}

export async function findLegacyTasks(): Promise<LegacyTask[]> {
  const found: LegacyTask[] = [];
  for (const dir of chatSessionDirs()) {
    const db = new Database(dir.inbound, { readonly: true });
    try {
      found.push(...legacyIn(db, dir));
    } finally {
      db.close();
    }
  }
  return found;
}

export async function applyLegacyTaskCancellation(): Promise<{ rows: number; tasks: LegacyTask[] }> {
  assertHostStopped();
  const tasks: LegacyTask[] = [];
  let changed = 0;
  for (const dir of chatSessionDirs()) {
    const db = new Database(dir.inbound);
    try {
      const legacy = legacyIn(db, dir);
      db.transaction(() => {
        for (const t of legacy) {
          if (t.status === 'pending' || t.status === 'paused') {
            changed += cancelTask(db, t.seriesId);
          } else {
            changed += db.prepare('UPDATE messages_in SET recurrence = NULL WHERE id = ?').run(t.rowId).changes;
          }
        }
      })();
      tasks.push(...legacy);
    } finally {
      db.close();
    }
  }
  return { rows: changed, tasks };
}

function print(tasks: LegacyTask[]): void {
  for (const t of tasks) {
    console.log(
      [
        `session ${t.agentGroupId}/${t.sessionId}`,
        `  series   ${t.seriesId}`,
        `  status   ${t.status}`,
        `  schedule ${t.recurrence}`,
        `  next     ${t.processAfter ?? '-'}`,
        `  prompt   ${t.prompt.replace(/\n/g, '\n           ')}`,
        '',
      ].join('\n'),
    );
  }
}

if (process.argv[1] && /migrate-legacy-tasks\.ts$/.test(process.argv[1])) {
  if (process.argv.includes('--apply')) {
    try {
      const { rows, tasks } = await applyLegacyTaskCancellation();
      print(tasks);
      console.log(`Disarmed ${tasks.length} legacy series (${rows} rows changed).`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  } else {
    const tasks = await findLegacyTasks();
    print(tasks);
    console.log(`${tasks.length} legacy series found. Dry run — nothing changed; rerun with --apply.`);
  }
}
