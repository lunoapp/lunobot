/**
 * skill/github-app — GitHub App access for selected agent groups.
 *
 * The App private key lives only on the host (`~/agent-keys/github-app.pem`,
 * 0600) and never enters a container. The host signs a JWT, exchanges it for a
 * short-lived (1h) installation token, and hands the agent that token by
 * reference: it is written owner-only into the session directory, which is
 * already mounted at /workspace, and only its path rides the env. The driver's
 * admission policy refuses credential values in env and exempts absolute paths
 * (isSecretShaped, src/drivers/types.ts); this is that sanctioned pattern.
 *
 * Which groups get it is `GITHUB_ENABLED_FOLDERS` in `.env` (group folders,
 * comma-separated); the token is scoped to `GITHUB_REPOSITORIES` and to
 * TOKEN_PERMISSIONS below. The container side reads the file and starts
 * github-mcp-server with it (container/agent-runner/src/github-mcp.ts).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { readEnvFile } from './env.js';
import { log } from './log.js';
import type { AgentGroup } from './types.js';

export const GITHUB_TOKEN_ENV = 'GITHUB_TOKEN_FILE';
const TOKEN_FILE_NAME = '.github-token';
/** Where the session directory's token file appears inside the agent container. */
export const GITHUB_TOKEN_CONTAINER_PATH = `/workspace/${TOKEN_FILE_NAME}`;

/** What github-mcp-server's `repos,issues,context` toolsets need, and nothing more. */
const TOKEN_PERMISSIONS = { issues: 'write', contents: 'read', metadata: 'read' } as const;
const MINT_TIMEOUT_MS = 10_000;
/**
 * Installation tokens expire after an hour. A container holding one is
 * retired between turns once it is this old (host-sweep, `kill-lifetime`), so
 * the next message spawns with a fresh token.
 */
export const GITHUB_TOKEN_CONTAINER_LIFETIME_MS = 55 * 60 * 1000;

interface GithubAppConfig {
  appId: string;
  installationId: string;
  /** Group folders that get the tool. Folders are unique; display names are not. */
  enabledFolders: Set<string>;
  /** Repository names (without owner) the token is scoped to. */
  repositories: string[];
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function readConfig(): GithubAppConfig {
  const env = readEnvFile([
    'GITHUB_APP_ID',
    'GITHUB_APP_INSTALLATION_ID',
    'GITHUB_ENABLED_FOLDERS',
    'GITHUB_REPOSITORIES',
  ]);
  return {
    appId: env.GITHUB_APP_ID ?? '',
    installationId: env.GITHUB_APP_INSTALLATION_ID ?? '',
    enabledFolders: new Set(list(env.GITHUB_ENABLED_FOLDERS)),
    repositories: list(env.GITHUB_REPOSITORIES),
  };
}

/**
 * Mint an installation token narrowed to the configured repositories and to
 * TOKEN_PERMISSIONS — GitHub caps it further at what the App installation
 * itself grants. Returns null (and the tool stays off) when anything is
 * unconfigured or the exchange fails.
 */
async function mintGithubAppToken(config: GithubAppConfig): Promise<string | null> {
  const keyPath = path.join(process.env.HOME || '/home/nanoclaw', 'agent-keys', 'github-app.pem');
  if (!config.appId || !config.installationId || config.repositories.length === 0 || !fs.existsSync(keyPath)) {
    return null;
  }

  try {
    const privateKey = fs.readFileSync(keyPath, 'utf8');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: config.appId })).toString(
      'base64url',
    );
    const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    const jwt = `${header}.${payload}.${signature}`;

    const res = await fetch(`https://api.github.com/app/installations/${config.installationId}/access_tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ repositories: config.repositories, permissions: TOKEN_PERMISSIONS }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
    if (!res.ok) {
      // The status only: an error body can echo request details, and a success
      // body is the credential itself.
      log.warn('GitHub App token mint rejected', { status: res.status });
      return null;
    }
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch (err) {
    log.warn('GitHub App token mint failed', { err });
    return null;
  }
}

/**
 * Remove whatever sits at the token path. The session directory is
 * agent-writable, so it may be a directory or a symlink the agent planted;
 * lstat never follows a link, and removing the link leaves its target alone.
 */
export function clearGithubTokenFile(sessDir: string): void {
  const file = path.join(sessDir, TOKEN_FILE_NAME);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return; // nothing there
  }
  fs.rmSync(file, { recursive: stat.isDirectory(), force: true });
}

/** Write the token owner-only. `wx` refuses to follow or reuse anything at the path. */
export function writeGithubTokenFile(sessDir: string, token: string): void {
  clearGithubTokenFile(sessDir);
  const fd = fs.openSync(path.join(sessDir, TOKEN_FILE_NAME), 'wx', 0o600);
  try {
    fs.writeSync(fd, token);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The env a session needs for the GitHub tool: the token file path when the
 * group's folder is enabled and a token could be minted and written, otherwise
 * nothing. Never throws: a GitHub problem must cost the session its GitHub
 * tool, not its spawn.
 */
export async function githubTokenEnv(agentGroup: AgentGroup, sessDir: string): Promise<Record<string, string>> {
  try {
    clearGithubTokenFile(sessDir);
    const config = readConfig();
    if (!config.enabledFolders.has(agentGroup.folder)) return {};
    const token = await mintGithubAppToken(config);
    if (!token) {
      log.warn('GitHub App token unavailable — github-mcp-server will stay off', { folder: agentGroup.folder });
      return {};
    }
    writeGithubTokenFile(sessDir, token);
    log.info('GitHub App token written for session', { folder: agentGroup.folder });
    return { [GITHUB_TOKEN_ENV]: GITHUB_TOKEN_CONTAINER_PATH };
  } catch (err) {
    log.warn('GitHub App token could not be provided — github-mcp-server will stay off', {
      folder: agentGroup.folder,
      err,
    });
    return {};
  }
}

/**
 * Lifetime cap for a runtime this host just registered. A spawned container
 * holds a token iff its spec carried the path; an adopted one (left by a
 * previous host process) iff the file is still in its session directory, and
 * then its token's age is unknown, so it is retired at the first idle sweep.
 */
export function githubTokenLifetimeCap(opts: {
  adopted: boolean;
  env?: Record<string, string>;
  sessDir: string;
}): number | undefined {
  if (!opts.adopted) return opts.env?.[GITHUB_TOKEN_ENV] ? GITHUB_TOKEN_CONTAINER_LIFETIME_MS : undefined;
  try {
    return fs.lstatSync(path.join(opts.sessDir, TOKEN_FILE_NAME)).isFile() ? 0 : undefined;
  } catch {
    return undefined;
  }
}
