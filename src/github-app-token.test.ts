/**
 * skill/github-app — the installation token reaches the agent by reference.
 *
 * The driver's admission policy refuses credential values in container env
 * (isSecretShaped, src/drivers/types.ts) and exempts absolute paths. These
 * cases pin both halves against the real composer and the real policy: the
 * path env is admitted, and the token itself in env would not be.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const logMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }));
vi.mock('./log.js', () => ({ log: logMock }));

// The .env the token module reads, per test.
const envFile = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock('./env.js', () => ({
  readEnvFile: (keys: string[]) =>
    Object.fromEntries(keys.filter((k) => k in envFile.values).map((k) => [k, envFile.values[k]])),
}));

import type { ContainerConfig } from './container-config.js';
import { composeSessionSpec } from './container-runner.js';
import { mountPolicy } from './drivers/index.js';
import { validateSpec } from './drivers/types.js';
import {
  GITHUB_TOKEN_CONTAINER_PATH,
  GITHUB_TOKEN_ENV,
  clearGithubTokenFile,
  githubTokenEnv,
  writeGithubTokenFile,
} from './github-app-token.js';
import type { AgentGroup, Session } from './types.js';

const agentGroup = { id: 'ag-gh', name: 'luno', folder: 'gh-test' } as AgentGroup;
const session = { id: 'sess-gh', agent_group_id: 'ag-gh', agent_provider: null } as Session;
const containerConfig = {
  mcpServers: {},
  packages: { apt: [], npm: [] },
  additionalMounts: [],
  skills: [],
} as unknown as ContainerConfig;

function compose(extraEnv: Record<string, string>) {
  return composeSessionSpec({
    agentGroup,
    session,
    containerName: 'ncl-gh-test',
    mounts: [],
    containerConfig,
    mailboxEnvironment: {},
    contribution: {} as never,
    gateway: { networkAccess: { endpoint: 'localhost', target: { kind: 'host' } } },
    extraEnv,
  });
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  envFile.values = {};
});

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** A HOME with a real App key, and a .env that enables `folder` for `luno`. */
function configuredApp(folder = 'telegram_main'): void {
  const home = tmpDir('gh-home-');
  fs.mkdirSync(path.join(home, 'agent-keys'));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(
    path.join(home, 'agent-keys', 'github-app.pem'),
    privateKey.export({ type: 'pkcs1', format: 'pem' }),
  );
  vi.stubEnv('HOME', home);
  envFile.values = {
    GITHUB_APP_ID: '123',
    GITHUB_APP_INSTALLATION_ID: '456',
    GITHUB_ENABLED_FOLDERS: `${folder}, telegram_jan`,
    GITHUB_REPOSITORIES: 'luno',
  };
}

function stubFetch(response: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const lunoGroup = { id: 'ag-luno', name: 'luno', folder: 'telegram_main' } as AgentGroup;
const tokenPath = (sessDir: string) => path.join(sessDir, path.basename(GITHUB_TOKEN_CONTAINER_PATH));

describe('GitHub App token by reference', () => {
  it('admits a spec that carries only the token file path', () => {
    const spec = compose({ [GITHUB_TOKEN_ENV]: GITHUB_TOKEN_CONTAINER_PATH });
    const agent = spec.containers.find((c) => c.role === 'agent')!;
    expect(agent.env[GITHUB_TOKEN_ENV]).toBe(GITHUB_TOKEN_CONTAINER_PATH);
    expect(() => validateSpec(spec, mountPolicy())).not.toThrow();
  });

  it('would refuse the token value itself in env (control)', () => {
    const spec = compose({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghs_' + 'a'.repeat(36) });
    expect(() => validateSpec(spec, mountPolicy())).toThrow(/denied-by-policy|secret-shaped/);
  });

  it('points the path into the session directory mounted at /workspace', () => {
    expect(GITHUB_TOKEN_CONTAINER_PATH.startsWith('/workspace/')).toBe(true);
  });

  it('writes the token owner-only into the session directory and clears it again', () => {
    const sessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-token-'));
    tmpDirs.push(sessDir);
    const hostPath = path.join(sessDir, path.basename(GITHUB_TOKEN_CONTAINER_PATH));

    writeGithubTokenFile(sessDir, 'ghs_example');
    expect(fs.readFileSync(hostPath, 'utf8')).toBe('ghs_example');
    expect(fs.statSync(hostPath).mode & 0o777).toBe(0o600);

    clearGithubTokenFile(sessDir);
    expect(fs.existsSync(hostPath)).toBe(false);
  });
});

describe('githubTokenEnv', () => {
  it('gates on the folder from GITHUB_ENABLED_FOLDERS, not on the group name', async () => {
    configuredApp();
    const fetchMock = stubFetch({ status: 201, body: { token: 'ghs_minted' } });
    const sessDir = tmpDir('gh-sess-');

    // Same display name, different folder: no token.
    expect(await githubTokenEnv({ ...lunoGroup, folder: 'telegram_other' }, sessDir)).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();

    expect(await githubTokenEnv(lunoGroup, sessDir)).toEqual({ [GITHUB_TOKEN_ENV]: GITHUB_TOKEN_CONTAINER_PATH });
    expect(fs.readFileSync(tokenPath(sessDir), 'utf8')).toBe('ghs_minted');
  });

  it("mints a token scoped to the configured repositories and the tool's permissions, with a timeout", async () => {
    configuredApp();
    const fetchMock = stubFetch({ status: 201, body: { token: 'ghs_minted' } });
    await githubTokenEnv(lunoGroup, tmpDir('gh-sess-'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/app/installations/456/access_tokens');
    expect(JSON.parse(init.body as string)).toEqual({
      repositories: ['luno'],
      permissions: { issues: 'write', contents: 'read', metadata: 'read' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('logs the HTTP status on a failed mint and never the response body', async () => {
    configuredApp();
    stubFetch({ status: 422, body: { message: 'nope', token: 'ghs_should_not_log' } });
    const sessDir = tmpDir('gh-sess-');

    expect(await githubTokenEnv(lunoGroup, sessDir)).toEqual({});
    expect(fs.existsSync(tokenPath(sessDir))).toBe(false);
    const logged = JSON.stringify(logMock.warn.mock.calls);
    expect(logged).toContain('422');
    expect(logged).not.toContain('ghs_should_not_log');
  });

  it('replaces a directory the agent planted at the token path', async () => {
    configuredApp();
    stubFetch({ status: 201, body: { token: 'ghs_minted' } });
    const sessDir = tmpDir('gh-sess-');
    fs.mkdirSync(path.join(tokenPath(sessDir), 'nested'), { recursive: true });

    expect(await githubTokenEnv(lunoGroup, sessDir)).toEqual({ [GITHUB_TOKEN_ENV]: GITHUB_TOKEN_CONTAINER_PATH });
    expect(fs.lstatSync(tokenPath(sessDir)).isFile()).toBe(true);
    expect(fs.readFileSync(tokenPath(sessDir), 'utf8')).toBe('ghs_minted');
  });

  it('replaces a planted symlink without writing through it', async () => {
    configuredApp();
    stubFetch({ status: 201, body: { token: 'ghs_minted' } });
    const sessDir = tmpDir('gh-sess-');
    const outside = path.join(tmpDir('gh-outside-'), 'target');
    fs.writeFileSync(outside, 'untouched');
    fs.symlinkSync(outside, tokenPath(sessDir));

    await githubTokenEnv(lunoGroup, sessDir);
    expect(fs.readFileSync(outside, 'utf8')).toBe('untouched');
    expect(fs.lstatSync(tokenPath(sessDir)).isSymbolicLink()).toBe(false);
  });

  it('never throws out of the spawn path when the file cannot be written', async () => {
    configuredApp();
    stubFetch({ status: 201, body: { token: 'ghs_minted' } });
    const missing = path.join(tmpDir('gh-sess-'), 'does', 'not', 'exist');

    await expect(githubTokenEnv(lunoGroup, missing)).resolves.toEqual({});
    expect(logMock.warn).toHaveBeenCalled();
  });
});
