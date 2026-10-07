import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { githubMcpServer } from './github-mcp.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tokenFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-mcp-'));
  dirs.push(dir);
  const file = path.join(dir, '.github-token');
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

describe('githubMcpServer', () => {
  it('enables github-mcp-server with the token read from GITHUB_TOKEN_FILE', () => {
    const server = githubMcpServer({ GITHUB_TOKEN_FILE: tokenFile('ghs_example\n'), HTTPS_PROXY: 'http://gw:1' });
    expect(server).toBeDefined();
    expect(server!.command).toBe('github-mcp-server');
    expect(server!.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghs_example');
    expect(server!.env.HTTPS_PROXY).toBe('http://gw:1');
  });

  it('stays off without GITHUB_TOKEN_FILE', () => {
    expect(githubMcpServer({})).toBeUndefined();
  });

  it('stays off when the file is missing', () => {
    expect(githubMcpServer({ GITHUB_TOKEN_FILE: '/nonexistent/.github-token' })).toBeUndefined();
  });

  it('stays off when the file is empty', () => {
    expect(githubMcpServer({ GITHUB_TOKEN_FILE: tokenFile('  \n') })).toBeUndefined();
  });
});
