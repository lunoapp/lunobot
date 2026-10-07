/**
 * skill/github-app — the installation token reaches the agent by reference.
 *
 * The driver's admission policy refuses credential values in container env
 * (isSecretShaped, src/drivers/types.ts) and exempts absolute paths. These
 * cases pin both halves against the real composer and the real policy: the
 * path env is admitted, and the token itself in env would not be.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import type { ContainerConfig } from './container-config.js';
import { composeSessionSpec } from './container-runner.js';
import { mountPolicy } from './drivers/index.js';
import { validateSpec } from './drivers/types.js';
import {
  GITHUB_TOKEN_CONTAINER_PATH,
  GITHUB_TOKEN_ENV,
  clearGithubTokenFile,
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
});

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
