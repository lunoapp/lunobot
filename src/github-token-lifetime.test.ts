/**
 * skill/github-app — a container holding a GitHub App installation token must
 * not outlive the token (1h). The idle ceiling does not ensure that: it keys
 * on heartbeat age, so a busy container can run for hours. decideStuckAction
 * takes an optional lifetime cap that retires such a container between turns.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  GITHUB_TOKEN_CONTAINER_LIFETIME_MS,
  GITHUB_TOKEN_ENV,
  GITHUB_TOKEN_CONTAINER_PATH,
  githubTokenLifetimeCap,
} from './github-app-token.js';
import { decideStuckAction } from './host-sweep.js';

const BASE = Date.parse('2026-10-07T12:00:00.000Z');
const MIN = 60 * 1000;
const LIFETIME = 55 * MIN;

describe('decideStuckAction with a lifetime cap', () => {
  it('retires a busy-but-idle-now container past its lifetime', () => {
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: BASE - MIN, // active a minute ago: the idle ceiling would not fire
      containerStartedAtMs: BASE - 56 * MIN,
      containerState: null,
      claims: [],
      maxLifetimeMs: LIFETIME,
    });
    expect(res).toEqual({ action: 'kill-lifetime', ageMs: 56 * MIN, maxLifetimeMs: LIFETIME });
  });

  it('waits while a message is being processed', () => {
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: BASE - 1000,
      containerStartedAtMs: BASE - 56 * MIN,
      containerState: null,
      claims: [{ messageId: 'm1', statusChanged: new Date(BASE - 10_000).toISOString() }],
      maxLifetimeMs: LIFETIME,
    });
    expect(res).toEqual({ action: 'ok' });
  });

  it('leaves a younger container alone', () => {
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: BASE - MIN,
      containerStartedAtMs: BASE - 54 * MIN,
      containerState: null,
      claims: [],
      maxLifetimeMs: LIFETIME,
    });
    expect(res).toEqual({ action: 'ok' });
  });

  it('has no lifetime cap when none is given', () => {
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: BASE - MIN,
      containerStartedAtMs: BASE - 5 * 60 * MIN,
      containerState: null,
      claims: [],
    });
    expect(res).toEqual({ action: 'ok' });
  });
});

describe('githubTokenLifetimeCap', () => {
  const sessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-cap-'));

  it('caps a spawned container whose spec carries the token path', () => {
    expect(
      githubTokenLifetimeCap({ adopted: false, env: { [GITHUB_TOKEN_ENV]: GITHUB_TOKEN_CONTAINER_PATH }, sessDir }),
    ).toBe(GITHUB_TOKEN_CONTAINER_LIFETIME_MS);
    expect(GITHUB_TOKEN_CONTAINER_LIFETIME_MS).toBeLessThan(60 * MIN);
  });

  it('does not cap a spawned container without a token', () => {
    expect(githubTokenLifetimeCap({ adopted: false, env: { TZ: 'UTC' }, sessDir })).toBeUndefined();
  });

  it('retires an adopted container with a token file at once, since its token age is unknown', () => {
    expect(githubTokenLifetimeCap({ adopted: true, sessDir })).toBeUndefined();
    fs.writeFileSync(path.join(sessDir, path.basename(GITHUB_TOKEN_CONTAINER_PATH)), 'ghs_x');
    expect(githubTokenLifetimeCap({ adopted: true, sessDir })).toBe(0);
    fs.rmSync(sessDir, { recursive: true, force: true });
  });
});
