/**
 * End-to-end half of scripts/reload-agent.ts: the real CLI path against a
 * throwaway DATA_DIR — central DB, session folder, inbound mailbox — so a
 * missing registration (the mailbox, the DB driver) fails here instead of on
 * the server during a deploy.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_DIR = '/tmp/nanoclaw-test-reload-agent';

vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../src/config.js')>('../src/config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-test-reload-agent' };
});
vi.mock('../src/log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { closeDb, initDb, runMigrations, createAgentGroup } from '../src/db/index.js';
import { createMessagingGroup } from '../src/db/messaging-groups.js';
import { createSession } from '../src/db/sessions.js';
import { inboundDbPath } from '../src/mailbox/sqlite/paths.js';
import { initSessionFolder } from '../src/session-manager.js';
import type { Session } from '../src/types.js';
import { reloadAgent, selectSessionsToClear } from './reload-agent.js';

const AG = 'ag-luno';

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    agent_group_id: AG,
    messaging_group_id: 'mg-1',
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'idle',
    last_active: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

beforeAll(async () => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const db = await initDb(path.join(TEST_DIR, 'v2.db'));
  await runMigrations(db);
  const now = new Date().toISOString();
  await createAgentGroup({ id: AG, name: 'luno', folder: 'telegram_main', agent_provider: null, created_at: now });
  await createMessagingGroup({
    id: 'mg-1',
    channel_type: 'telegram',
    platform_id: 'telegram:-100',
    instance: null,
    name: 'luno',
    is_group: 1,
    unknown_sender_policy: 'strict',
    created_at: now,
  } as never);
  await createSession(session('sess-chat'));
  await createSession(session('sess-task', { messaging_group_id: null, thread_id: 'system:tasks:t-1' }));
  initSessionFolder(AG, 'sess-chat');
  initSessionFolder(AG, 'sess-task');
  await closeDb();
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

function inboundRows(sessionId: string): Array<{ kind: string; content: string; platform_id: string | null }> {
  const file = inboundDbPath(AG, sessionId);
  if (!fs.existsSync(file)) return [];
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare('SELECT kind, content, platform_id FROM messages_in').all() as never;
  } finally {
    db.close();
  }
}

describe('reloadAgent', () => {
  it('queues /clear into the chat session through the registered mailbox', async () => {
    await reloadAgent('luno');
    const rows = inboundRows('sess-chat');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].content)).toEqual({ text: '/clear' });
    expect(rows[0].platform_id).toBe('telegram:-100');
  });

  it('leaves system task sessions alone', () => {
    expect(inboundRows('sess-task')).toHaveLength(0);
  });
});

describe('selectSessionsToClear', () => {
  it('skips per-series and legacy task sessions', () => {
    const sessions = [
      session('chat'),
      session('series', { thread_id: 'system:tasks:t-1' }),
      session('legacy', { thread_id: 'system:tasks' }),
    ];
    expect(selectSessionsToClear(sessions, AG).map((s) => s.id)).toEqual(['chat']);
  });
});
