/**
 * When a container ends on its own — the runner retiring for a fresh GitHub
 * token leaves the message that arrived pending — the session is handed to
 * the sweep's reconcile right away, instead of waiting for the next periodic
 * pass. Reconcile is level-triggered: it wakes only when messages are due and
 * no container runs, so the enqueue must happen after the runtime is gone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { SupervisedHandle, SupervisedSnapshot } from './drivers/session-events.js';

const snapshots: SupervisedSnapshot[] = [];
vi.mock('./drivers/index.js', () => ({
  getSessionDriver: () => ({
    listSessions: async () => snapshots,
    capabilities: () => ({}),
  }),
  isSessionEventsDriver: () => false,
}));

const enqueued: Array<{ sessionId: string; runningAtEnqueue: boolean }> = [];
vi.mock('./reconcile-feeds.js', () => ({
  enqueueSessionReconcile: (sessionId: string) => {
    enqueued.push({ sessionId, runningAtEnqueue: isRunningRef.fn(sessionId) });
  },
  registerReconcileEnqueue: () => {},
}));
const isRunningRef = vi.hoisted(() => ({ fn: (_id: string): boolean => false }));

import { adoptRunningSessions, isContainerRunning, killContainer } from './container-runner.js';
import { resetGatewayProvider } from './gateway-providers/index.js';
import { initTestDb, closeDb, runMigrations, createAgentGroup, createSession } from './db/index.js';

isRunningRef.fn = isContainerRunning;

function now(): string {
  return new Date().toISOString();
}

let endContainer: ((failure?: unknown) => void) | undefined;
function fakeHandle(sessionId: string, name: string): SupervisedHandle {
  const terminalCallbacks: Array<(failure?: unknown) => void> = [];
  endContainer = (failure?: unknown) => {
    for (const callback of terminalCallbacks) callback(failure);
  };
  return {
    key: { installSlug: 'test-install', agentGroupId: 'ag-1', sessionId },
    name,
    async start() {},
    async stop() {},
    async status() {
      return { phase: 'running' };
    },
    onTerminal(callback: (failure?: unknown) => void) {
      terminalCallbacks.push(callback);
    },
  } as unknown as SupervisedHandle;
}

beforeEach(async () => {
  snapshots.length = 0;
  enqueued.length = 0;
  resetGatewayProvider({
    kind: 'test-lifecycle',
    agentSkills: [],
    sessions: {
      ensure: async () => ({
        contribution: {
          networkAccess: { endpoint: 'http://proxy:8080', target: { kind: 'runtime' as const, identity: 'proxy' } },
        },
        release: async () => {},
      }),
      reapOrphans: async () => {},
    },
    approvals: { subscribe: async () => {} },
  });
  const db = await initTestDb();
  await runMigrations(db);
  await createAgentGroup({
    id: 'ag-1',
    name: 'Test Agent',
    folder: 'test-agent',
    agent_provider: null,
    created_at: now(),
  });
  await createSession({
    id: 'sess-1',
    agent_group_id: 'ag-1',
    messaging_group_id: null,
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'running',
    last_active: now(),
    created_at: now(),
  });
});

afterEach(async () => {
  if (isContainerRunning('sess-1')) {
    killContainer('sess-1', 'test-teardown');
    await vi.waitFor(() => expect(isContainerRunning('sess-1')).toBe(false));
  }
  resetGatewayProvider();
  await closeDb();
});

describe('container exit hands the session to reconcile', () => {
  it('enqueues a reconcile once the runtime is gone', async () => {
    snapshots.push({ handle: fakeHandle('sess-1', 'container-a'), phase: 'running' } as SupervisedSnapshot);
    await adoptRunningSessions();
    expect(isContainerRunning('sess-1')).toBe(true);

    endContainer!();

    await vi.waitFor(() => expect(enqueued.map((e) => e.sessionId)).toContain('sess-1'));
    expect(enqueued.find((e) => e.sessionId === 'sess-1')!.runningAtEnqueue).toBe(false);
  });

  it('does not hurry a container that died: the periodic sweep keeps pacing a crash loop', async () => {
    snapshots.push({ handle: fakeHandle('sess-1', 'container-a'), phase: 'running' } as SupervisedSnapshot);
    await adoptRunningSessions();

    endContainer!({ kind: 'started-then-died', retryable: false, exitCode: 1 });

    await vi.waitFor(() => expect(isContainerRunning('sess-1')).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(enqueued.map((e) => e.sessionId)).not.toContain('sess-1');
  });

  it('does not hurry a container the host stopped itself', async () => {
    snapshots.push({ handle: fakeHandle('sess-1', 'container-a'), phase: 'running' } as SupervisedSnapshot);
    await adoptRunningSessions();

    killContainer('sess-1', 'test-stop');
    endContainer!();

    await vi.waitFor(() => expect(isContainerRunning('sess-1')).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(enqueued.map((e) => e.sessionId)).not.toContain('sess-1');
  });
});
