/**
 * skill/github-app — GitHub's official MCP server, enabled only when the host
 * left a GitHub App installation token for this session (src/github-app-token.ts).
 *
 * The token arrives by reference: GITHUB_TOKEN_FILE names a file in the
 * session directory, because the host's admission policy keeps credential
 * values out of container env. It is read here and handed to the MCP server's
 * own process env. The host mints the token scoped to the configured
 * repositories with issues:write, contents:read and metadata:read, so the
 * toolset list is only an ergonomic default; a call beyond that scope fails at
 * GitHub. The OneCLI proxy and CA env are
 * forwarded so api.github.com calls pass the gateway and trust its MITM cert
 * (Go honours SSL_CERT_FILE).
 */
import fs from 'fs';

import type { McpServerConfig } from './providers/types.js';

export function githubMcpServer(
  env: Record<string, string | undefined>,
): (McpServerConfig & { env: Record<string, string> }) | undefined {
  const file = env.GITHUB_TOKEN_FILE;
  if (!file) return undefined;
  let token: string;
  try {
    token = fs.readFileSync(file, 'utf8').trim();
  } catch {
    return undefined;
  }
  if (!token) return undefined;

  const ghEnv: Record<string, string> = {
    GITHUB_PERSONAL_ACCESS_TOKEN: token,
    GITHUB_TOOLSETS: 'repos,issues,context',
  };
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE']) {
    const value = env[k];
    if (value) ghEnv[k] = value;
  }
  return { command: 'github-mcp-server', args: ['stdio'], env: ghEnv };
}

/**
 * Installation tokens expire after an hour. Past this age the runner retires
 * at the next idle turn boundary (poll-loop.ts), so the host's next spawn
 * answers with a freshly minted token. The age is the file's mtime, which the
 * host sets when it writes the token at mint time.
 */
export const GITHUB_TOKEN_ROTATE_AFTER_MS = 50 * 60 * 1000;

export function githubTokenRotationDue(env: Record<string, string | undefined>, now = Date.now()): boolean {
  const file = env.GITHUB_TOKEN_FILE;
  if (!file) return false;
  try {
    return now - fs.statSync(file).mtimeMs > GITHUB_TOKEN_ROTATE_AFTER_MS;
  } catch {
    return false;
  }
}
