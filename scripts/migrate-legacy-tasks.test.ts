/**
 * scripts/migrate-legacy-tasks.ts against a fixture data directory: a central
 * DB with one chat session and one per-series task session, and inbound
 * mailboxes holding every task state the selection has to tell apart.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_DIR = '/tmp/nanoclaw-test-legacy-tasks';

vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../src/config.js')>('../src/config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-test-legacy-tasks' };
});
vi.mock('../src/log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));
import { log } from '../src/log.js';

import { closeDb, createAgentGroup, initDb, runMigrations } from '../src/db/index.js';
import { createSession } from '../src/db/sessions.js';
import { inboundDbPath } from '../src/mailbox/sqlite/paths.js';
import { ensureSchema } from '../src/mailbox/sqlite/session-db.js';
import type { Session } from '../src/types.js';
import { applyLegacyTaskCancellation, findLegacyTasks } from './migrate-legacy-tasks.js';

const AG = 'ag-luno';
const CHAT = 'sess-chat';
const TASKS = 'sess-series';
// A session folder the central DB knows nothing about.
const ORPHAN = 'sess-orphan';

function session(id: string, threadId: string | null): Session {
  return {
    id,
    agent_group_id: AG,
    messaging_group_id: null,
    thread_id: threadId,
    agent_provider: null,
    status: 'active',
    container_status: 'stopped',
    last_active: null,
    created_at: new Date().toISOString(),
  };
}

let seq = 2;
function task(sessionId: string, row: { id: string; series: string; status: string; recurrence: string | null }) {
  const file = inboundDbPath(AG, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureSchema(file, 'inbound');
  const db = new Database(file);
  db.prepare(
    `INSERT INTO messages_in (id, seq, kind, timestamp, status, process_after, recurrence, series_id, content)
     VALUES (?, ?, 'task', datetime('now'), ?, '2026-10-08T07:00:00.000Z', ?, ?, ?)`,
  ).run(row.id, (seq += 2), row.status, row.recurrence, row.series, JSON.stringify({ prompt: `prompt ${row.id}` }));
  db.close();
}

function rows(sessionId: string) {
  const db = new Database(inboundDbPath(AG, sessionId), { readonly: true });
  try {
    return Object.fromEntries(
      (
        db.prepare('SELECT id, status, recurrence FROM messages_in ORDER BY seq').all() as Array<{
          id: string;
          status: string;
          recurrence: string | null;
        }>
      ).map((r) => [r.id, { status: r.status, recurrence: r.recurrence }]),
    );
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const db = await initDb(path.join(TEST_DIR, 'v2.db'));
  await runMigrations(db);
  await createAgentGroup({ id: AG, name: 'luno', folder: 'telegram_main', agent_provider: null, created_at: '' });
  await createSession(session(CHAT, null));
  await createSession(session(TASKS, 'system:tasks:new-series'));
  await closeDb();

  const daily = '0 9 * * *';
  // Morning check: two completed occurrences and the armed next one.
  task(CHAT, { id: 'mc-1', series: 'mc', status: 'completed', recurrence: daily });
  task(CHAT, { id: 'mc-2', series: 'mc', status: 'completed', recurrence: daily });
  task(CHAT, { id: 'mc-3', series: 'mc', status: 'pending', recurrence: daily });
  // A paused weekly series, a failed one, and one whose latest row completed.
  task(CHAT, { id: 'wk-1', series: 'wk', status: 'paused', recurrence: '0 8 * * 1' });
  task(CHAT, { id: 'fl-1', series: 'fl', status: 'failed', recurrence: daily });
  task(CHAT, { id: 'cl-1', series: 'cl', status: 'completed', recurrence: daily });
  // Not legacy: a one-shot, an already cancelled series, and a new-style task session.
  task(CHAT, { id: 'once', series: 'once', status: 'pending', recurrence: null });
  task(CHAT, { id: 'gone', series: 'gone', status: 'cancelled', recurrence: null });
  task(TASKS, { id: 'new-1', series: 'new-series', status: 'pending', recurrence: daily });
  task(ORPHAN, { id: 'or-1', series: 'or', status: 'pending', recurrence: daily });
});

function setLiveHost(live: boolean) {
  const db = new Database(path.join(TEST_DIR, 'v2.db'));
  try {
    db.prepare('DELETE FROM host_instances').run();
    if (live) {
      db.prepare(
        `INSERT INTO host_instances (instance_id, install_id, hostname, pid, started_at, lease_expires_at)
         VALUES ('h1', 'i1', 'luno', 4242, ?, ?)`,
      ).run(new Date().toISOString(), new Date(Date.now() + 60_000).toISOString());
    }
  } finally {
    db.close();
  }
}

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('findLegacyTasks (dry run)', () => {
  it('lists the live recurring rows of chat sessions, one per state that can re-arm', async () => {
    const found = await findLegacyTasks();
    expect(found.map((t) => [t.sessionId, t.rowId, t.seriesId, t.status]).sort()).toEqual(
      [
        [CHAT, 'cl-1', 'cl', 'completed'],
        [CHAT, 'fl-1', 'fl', 'failed'],
        [CHAT, 'mc-3', 'mc', 'pending'],
        [CHAT, 'wk-1', 'wk', 'paused'],
      ].sort(),
    );
    const morning = found.find((t) => t.rowId === 'mc-3')!;
    expect(morning).toMatchObject({ recurrence: '0 9 * * *', prompt: 'prompt mc-3', agentGroupId: AG });
    expect(morning.processAfter).toBe('2026-10-08T07:00:00.000Z');
  });

  it('changes nothing', () => {
    expect(rows(CHAT)['mc-3']).toEqual({ status: 'pending', recurrence: '0 9 * * *' });
  });

  it('skips a session folder without a central sessions row, and names it', async () => {
    const found = await findLegacyTasks();
    expect(found.some((t) => t.sessionId === ORPHAN)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('no sessions row'),
      expect.objectContaining({ sessionId: ORPHAN }),
    );
  });
});

describe('applyLegacyTaskCancellation while the host runs', () => {
  it('refuses while a host instance holds a live lease, and changes nothing', async () => {
    setLiveHost(true);
    await expect(applyLegacyTaskCancellation()).rejects.toThrow(/host is running/);
    expect(rows(CHAT)['mc-3']).toEqual({ status: 'pending', recurrence: '0 9 * * *' });
    setLiveHost(false);
  });
});

describe('applyLegacyTaskCancellation', () => {
  it('disarms every listed series and leaves everything else alone', async () => {
    const result = await applyLegacyTaskCancellation();
    expect(result.rows).toBe(4);

    const chat = rows(CHAT);
    // Live occurrences: cancelled the way `ncl tasks cancel` does it.
    expect(chat['mc-3']).toEqual({ status: 'cancelled', recurrence: null });
    expect(chat['wk-1']).toEqual({ status: 'cancelled', recurrence: null });
    // Rows that already ran keep their outcome; only the re-arm is removed.
    expect(chat['fl-1']).toEqual({ status: 'failed', recurrence: null });
    expect(chat['cl-1']).toEqual({ status: 'completed', recurrence: null });
    // History and non-legacy rows untouched.
    expect(chat['mc-1']).toEqual({ status: 'completed', recurrence: '0 9 * * *' });
    expect(chat['once']).toEqual({ status: 'pending', recurrence: null });
    expect(rows(TASKS)['new-1']).toEqual({ status: 'pending', recurrence: '0 9 * * *' });
    expect(rows(ORPHAN)['or-1']).toEqual({ status: 'pending', recurrence: '0 9 * * *' });

    expect(await findLegacyTasks()).toEqual([]);
  });
});
