/**
 * skill/github-app — a runner holding a GitHub App token older than the
 * rotation age retires at a turn boundary: when a new message arrives while
 * nothing is being answered or queued, it leaves that message pending and
 * exits, so the host's next spawn answers it with a freshly minted token.
 * The token's age is the file's mtime (the host writes it at mint time).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { GITHUB_TOKEN_ROTATE_AFTER_MS, githubTokenRotationDue } from './github-mcp.js';
import { initTestSessionDb, closeSessionDb, getInboundDb } from './mailbox/sqlite/connection.js';
import { __setRunnerExitForTests, processQuery } from './poll-loop.js';
import type { AgentQuery, ProviderEvent } from './providers/types.js';

const ROUTING = { platformId: 'chan-1', channelType: 'telegram', threadId: null, inReplyTo: 'm1', taskRun: false };
const MIN = 60 * 1000;

let dir: string;
let exits: number;
let savedTokenEnv: string | undefined;

beforeEach(() => {
  initTestSessionDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-retire-'));
  exits = 0;
  __setRunnerExitForTests(() => {
    exits++;
  });
  savedTokenEnv = process.env.GITHUB_TOKEN_FILE;
});

afterEach(() => {
  __setRunnerExitForTests(undefined);
  if (savedTokenEnv === undefined) delete process.env.GITHUB_TOKEN_FILE;
  else process.env.GITHUB_TOKEN_FILE = savedTokenEnv;
  closeSessionDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

function tokenFile(ageMs: number): string {
  const file = path.join(dir, '.github-token');
  fs.writeFileSync(file, 'ghs_x');
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(file, t, t);
  return file;
}

function insertFollowUp(id: string): void {
  getInboundDb()
    .prepare(
      `INSERT INTO messages_in (id, kind, timestamp, status, process_after, trigger, on_wake, content)
       VALUES (?, 'chat', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'pending', NULL, 1, 0, ?)`,
    )
    .run(id, JSON.stringify({ sender: 'Nicole', text: 'follow-up' }));
}

function status(id: string): string {
  return (getInboundDb().prepare('SELECT status FROM messages_in WHERE id = ?').get(id) as { status: string }).status;
}

/**
 * A query that answers its first prompt, then stays open the way a warm
 * container does. `finishTurn: false` keeps the first turn streaming.
 */
function openQuery(opts: { finishTurn: boolean }) {
  const pushes: string[] = [];
  let release!: () => void;
  const closed = new Promise<void>((r) => (release = r));
  async function* events(): AsyncGenerator<ProviderEvent> {
    yield { type: 'init', continuation: 's1' };
    if (opts.finishTurn) yield { type: 'result', text: '' };
    await closed;
  }
  const query: AgentQuery = {
    push: (m: string) => {
      pushes.push(m);
    },
    end: () => release(),
    abort: () => release(),
    events: events(),
  };
  return { query, pushes, release };
}

async function runWhile(query: AgentQuery, release: () => void, ms = 1300): Promise<void> {
  const run = processQuery(query, ROUTING, ['m1'], 'claude', undefined, 'prompt', undefined);
  await new Promise((r) => setTimeout(r, ms));
  release();
  await run;
}

describe('githubTokenRotationDue', () => {
  it('is due only for an existing token file older than the rotation age', () => {
    expect(githubTokenRotationDue({})).toBe(false);
    expect(githubTokenRotationDue({ GITHUB_TOKEN_FILE: path.join(dir, 'missing') })).toBe(false);
    expect(githubTokenRotationDue({ GITHUB_TOKEN_FILE: tokenFile(10 * MIN) })).toBe(false);
    expect(githubTokenRotationDue({ GITHUB_TOKEN_FILE: tokenFile(GITHUB_TOKEN_ROTATE_AFTER_MS + MIN) })).toBe(true);
    expect(GITHUB_TOKEN_ROTATE_AFTER_MS).toBeLessThan(60 * MIN);
  });
});

describe('retiring for a fresh GitHub token', () => {
  it('exits at an idle turn boundary and leaves the new message pending', async () => {
    process.env.GITHUB_TOKEN_FILE = tokenFile(51 * MIN);
    const { query, pushes, release } = openQuery({ finishTurn: true });
    setTimeout(() => insertFollowUp('m2'), 100);
    await runWhile(query, release);
    expect(exits).toBe(1);
    expect(pushes).toEqual([]);
    expect(status('m2')).toBe('pending');
  });

  it('does not exit mid-turn: a follow-up joins the running turn', async () => {
    process.env.GITHUB_TOKEN_FILE = tokenFile(51 * MIN);
    const { query, pushes, release } = openQuery({ finishTurn: false });
    setTimeout(() => insertFollowUp('m2'), 100);
    await runWhile(query, release);
    expect(exits).toBe(0);
    expect(pushes).toHaveLength(1);
  });

  it('does not exit without a token file', async () => {
    delete process.env.GITHUB_TOKEN_FILE;
    const { query, pushes, release } = openQuery({ finishTurn: true });
    setTimeout(() => insertFollowUp('m2'), 100);
    await runWhile(query, release);
    expect(exits).toBe(0);
    expect(pushes).toHaveLength(1);
  });

  it('does not exit while the token is young', async () => {
    process.env.GITHUB_TOKEN_FILE = tokenFile(5 * MIN);
    const { query, pushes, release } = openQuery({ finishTurn: true });
    setTimeout(() => insertFollowUp('m2'), 100);
    await runWhile(query, release);
    expect(exits).toBe(0);
    expect(pushes).toHaveLength(1);
  });
});
