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
 * The container side reads the file and starts github-mcp-server with it
 * (container/agent-runner/src/github-mcp.ts).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { readEnvFile } from './env.js';
import { log } from './log.js';

// Agent groups that get the GitHub App tool wired in (luno team chat + Jan's
// private chat). The App is scoped to lunoapp/luno, so this only grants what
// the App already allows. Add a group name here to extend access.
const GITHUB_ENABLED_GROUPS = new Set(['luno', 'Jan']);

export const GITHUB_TOKEN_ENV = 'GITHUB_TOKEN_FILE';
const TOKEN_FILE_NAME = '.github-token';
/** Where the session directory's token file appears inside the agent container. */
export const GITHUB_TOKEN_CONTAINER_PATH = `/workspace/${TOKEN_FILE_NAME}`;

/** Mint an installation token. Returns null (and the tool stays off) when anything is unconfigured. */
async function mintGithubAppToken(): Promise<string | null> {
  const env = readEnvFile(['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID']);
  const appId = env.GITHUB_APP_ID;
  const installationId = env.GITHUB_APP_INSTALLATION_ID;
  const keyPath = path.join(process.env.HOME || '/home/nanoclaw', 'agent-keys', 'github-app.pem');
  if (!appId || !installationId || !fs.existsSync(keyPath)) return null;

  try {
    const privateKey = fs.readFileSync(keyPath, 'utf8');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString('base64url');
    const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    const jwt = `${header}.${payload}.${signature}`;

    const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' },
    });
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch (err) {
    log.warn('GitHub App token mint failed', { err });
    return null;
  }
}

export function writeGithubTokenFile(sessDir: string, token: string): void {
  const file = path.join(sessDir, TOKEN_FILE_NAME);
  // Remove first: writeFileSync's mode applies only on create, and a file left
  // by an older build could carry wider permissions.
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
}

export function clearGithubTokenFile(sessDir: string): void {
  fs.rmSync(path.join(sessDir, TOKEN_FILE_NAME), { force: true });
}

/**
 * The env a session needs for the GitHub tool: the token file path when this
 * group is enabled and a token could be minted, otherwise nothing. A stale
 * token file from an earlier spawn is removed either way.
 */
export async function githubTokenEnv(groupName: string, sessDir: string): Promise<Record<string, string>> {
  clearGithubTokenFile(sessDir);
  if (!GITHUB_ENABLED_GROUPS.has(groupName)) return {};
  const token = await mintGithubAppToken();
  if (!token) {
    log.warn('GitHub App token unavailable — github-mcp-server will stay off', { groupName });
    return {};
  }
  writeGithubTokenFile(sessDir, token);
  log.info('GitHub App token written for session', { groupName });
  return { [GITHUB_TOKEN_ENV]: GITHUB_TOKEN_CONTAINER_PATH };
}
