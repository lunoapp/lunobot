/**
 * The clones the deploy updates (social, luno, premarising) are mounted into
 * agent containers read-write, `.git` included. Every git call the deploy
 * makes there goes through scripts/clone-git-guard.sh; these cases run it
 * against real repositories an agent could have tampered with.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/clone-git-guard.sh');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** An upstream repo plus a clone of it, like the server's ~/social. */
function cloneFixture(): { clone: string; upstream: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-guard-'));
  dirs.push(root);
  const upstream = path.join(root, 'upstream');
  fs.mkdirSync(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  git(upstream, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', upstream, clone);
  return { clone, upstream, root };
}

function runGuarded(clone: string, body: string) {
  return spawnSync('bash', ['-c', `source "${GUARD}" && guard_clone "${clone}" && cd "${clone}" && ${body}`], {
    encoding: 'utf8',
  });
}

describe('clone-git-guard.sh', () => {
  it('lets a plain clone fetch', () => {
    const { clone } = cloneFixture();
    const res = runGuarded(clone, 'git fetch --quiet origin main && echo fetched');
    expect(res.stderr).toBe('');
    expect(res.stdout.trim()).toBe('fetched');
  });

  it('refuses a clone whose config carries a key outside the allowlist', () => {
    const { clone, root } = cloneFixture();
    const marker = path.join(root, 'pwned');
    git(clone, 'config', 'core.fsmonitor', `touch ${marker}`);
    const res = runGuarded(clone, 'git fetch --quiet origin main');
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/core\.fsmonitor/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses an uploadpack override even though it lives under remote.*', () => {
    const { clone, root } = cloneFixture();
    const marker = path.join(root, 'pwned');
    git(clone, 'config', 'remote.origin.uploadpack', `touch ${marker}; git-upload-pack`);
    const res = runGuarded(clone, 'git fetch --quiet origin main');
    expect(res.status).not.toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses an include that would pull in more config', () => {
    const { clone, root } = cloneFixture();
    fs.writeFileSync(path.join(root, 'extra'), '[core]\n\thooksPath = /tmp\n');
    git(clone, 'config', 'include.path', path.join(root, 'extra'));
    expect(runGuarded(clone, 'true').status).not.toBe(0);
  });

  it('never runs a hook the agent planted', () => {
    const { clone, root } = cloneFixture();
    const marker = path.join(root, 'pwned');
    const hook = path.join(clone, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    const res = runGuarded(clone, 'git fetch --quiet origin main && git merge --ff-only --quiet origin/main');
    expect(res.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses a .git that is not a plain directory', () => {
    const { clone, root } = cloneFixture();
    fs.renameSync(path.join(clone, '.git'), path.join(root, 'moved-git'));
    fs.writeFileSync(path.join(clone, '.git'), `gitdir: ${path.join(root, 'moved-git')}\n`);
    expect(runGuarded(clone, 'true').status).not.toBe(0);
  });

  it('refuses a commondir redirect', () => {
    const { clone, root } = cloneFixture();
    fs.writeFileSync(path.join(clone, '.git', 'commondir'), root);
    expect(runGuarded(clone, 'true').status).not.toBe(0);
  });
});
