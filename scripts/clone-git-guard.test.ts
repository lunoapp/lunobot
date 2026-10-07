/**
 * The clones the deploy updates (social, luno, premarising) are mounted into
 * agent containers read-write, `.git` included. Every git call the deploy
 * makes there goes through scripts/clone-git-guard.sh; these cases run it
 * against real repositories an agent could have tampered with.
 *
 * Fetches go over the real ssh transport: a fake `ssh` on PATH serves the
 * fixture's upstream repo, the way the server's ~/.ssh/config alias serves
 * GitHub.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/clone-git-guard.sh');
const ORIGIN_URL = 'git@github-luno:lunoapp/fixture.git';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// Fixture setup runs without the developer's global config and hooks.
const plainEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe', env: plainEnv });
}

interface Fixture {
  root: string;
  upstream: string;
  clone: string;
  bin: string;
  marker: string;
}

/** An upstream repo, a fake ssh that serves it, and a clone with an ssh origin. */
function cloneFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-guard-'));
  dirs.push(root);
  const upstream = path.join(root, 'upstream');
  fs.mkdirSync(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(upstream, 'a.txt'), 'one\n');
  git(upstream, 'add', 'a.txt');
  git(upstream, 'commit', '-q', '-m', 'init');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // ssh <options…> <host> "git-upload-pack 'lunoapp/fixture.git'"
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nexec git-upload-pack "${upstream}"\n`, { mode: 0o755 });
  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', upstream, clone);
  git(clone, 'config', 'remote.origin.url', ORIGIN_URL);
  return { root, upstream, clone, bin, marker: path.join(root, 'pwned') };
}

function runGuarded(f: Fixture, body: string) {
  return spawnSync('bash', ['-c', `source "${GUARD}" && guard_clone "${f.clone}" && cd "${f.clone}" && ${body}`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}` },
  });
}

function advanceUpstream(f: Fixture) {
  fs.writeFileSync(path.join(f.upstream, 'a.txt'), 'two\n');
  git(f.upstream, 'commit', '-q', '-am', 'second');
}

describe('clone-git-guard.sh', () => {
  it('fetches and fast-forwards a plain clone over ssh', () => {
    const f = cloneFixture();
    advanceUpstream(f);
    const res = runGuarded(f, 'fetch_main && git merge --ff-only --quiet origin/main && cat a.txt');
    expect(res.stderr).toBe('');
    expect(res.stdout.trim()).toBe('two');
  });

  it('accepts the keys the server checkouts carry today', () => {
    const f = cloneFixture();
    git(f.clone, 'config', 'core.hooksPath', '.husky');
    git(f.clone, 'config', 'remote.upstream.url', 'https://github.com/qwibitai/nanoclaw.git');
    git(f.clone, 'config', 'remote.upstream.fetch', '+refs/heads/*:refs/remotes/upstream/*');
    git(f.clone, 'config', 'user.name', 'nanoclaw');
    git(f.clone, 'config', 'user.email', 'bot@example.com');
    expect(runGuarded(f, 'true').status).toBe(0);
  });

  it('refuses a clone whose config carries a key outside the allowlist', () => {
    const f = cloneFixture();
    git(f.clone, 'config', 'core.fsmonitor', `touch ${f.marker}`);
    const res = runGuarded(f, 'fetch_main');
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/core\.fsmonitor/);
    expect(fs.existsSync(f.marker)).toBe(false);
  });

  it('refuses an uploadpack override even though it lives under remote.*', () => {
    const f = cloneFixture();
    git(f.clone, 'config', 'remote.origin.uploadpack', `touch ${f.marker}; git-upload-pack`);
    expect(runGuarded(f, 'fetch_main').status).not.toBe(0);
    expect(fs.existsSync(f.marker)).toBe(false);
  });

  it('refuses to fetch from an origin that is not an expected ssh GitHub URL', () => {
    for (const url of [
      '/tmp/elsewhere',
      'file:///tmp/x',
      'ext::sh -c touch% /tmp/x',
      'git@evil.example:lunoapp/x.git',
      'git@github:someone/x.git',
    ]) {
      const f = cloneFixture();
      git(f.clone, 'config', 'remote.origin.url', url);
      const res = runGuarded(f, 'fetch_main');
      expect(res.status, url).not.toBe(0);
      expect(res.stderr).toMatch(/not an expected ssh GitHub URL/);
    }
  });

  it('refuses an include that would pull in more config', () => {
    const f = cloneFixture();
    fs.writeFileSync(path.join(f.root, 'extra'), '[core]\n\thooksPath = /tmp\n');
    git(f.clone, 'config', 'include.path', path.join(f.root, 'extra'));
    expect(runGuarded(f, 'true').status).not.toBe(0);
  });

  it('never runs a hook the agent planted', () => {
    const f = cloneFixture();
    advanceUpstream(f);
    const hook = path.join(f.clone, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(hook, `#!/bin/sh\ntouch ${f.marker}\n`, { mode: 0o755 });
    const res = runGuarded(f, 'fetch_main && git merge --ff-only --quiet origin/main');
    expect(res.status).toBe(0);
    expect(fs.existsSync(f.marker)).toBe(false);
  });

  it("ignores the caller's GIT_* environment", () => {
    const f = cloneFixture();
    const res = spawnSync(
      'bash',
      [
        '-c',
        `source "${GUARD}" && guard_clone "${f.clone}" && cd "${f.clone}" && git status --porcelain --ignore-submodules=all`,
      ],
      { encoding: 'utf8', env: { ...process.env, GIT_DIR: '/nonexistent', GIT_SSH_COMMAND: `touch ${f.marker}` } },
    );
    expect(res.status).toBe(0);
    expect(fs.existsSync(f.marker)).toBe(false);
  });

  it('never runs a filter driver configured in a nested repository', () => {
    const f = cloneFixture();
    // A nested repo recorded as a gitlink, with a clean filter on a file whose
    // stat no longer matches the index: plain `git status` recurses into it
    // and runs the filter to recheck the file.
    const sub = path.join(f.clone, 'sub');
    fs.mkdirSync(sub);
    git(sub, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(sub, '.gitattributes'), '*.txt filter=evil\n');
    fs.writeFileSync(path.join(sub, 'b.txt'), 'x\n');
    git(sub, 'add', '.');
    git(sub, 'commit', '-q', '-m', 'sub');
    git(sub, 'config', 'filter.evil.clean', `sh -c 'touch ${f.marker}; cat'`);
    git(f.clone, 'add', 'sub');
    git(f.clone, 'commit', '-q', '-m', 'gitlink');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(sub, 'b.txt'), later, later);

    const res = runGuarded(f, 'git status --porcelain --ignore-submodules=all');
    expect(res.status).toBe(0);
    expect(fs.existsSync(f.marker)).toBe(false);

    // Control: unguarded, the same status does execute it.
    spawnSync('git', ['status', '--porcelain'], { cwd: f.clone, env: plainEnv });
    expect(fs.existsSync(f.marker)).toBe(true);
  });

  it('refuses a .git that is not a plain directory', () => {
    const f = cloneFixture();
    fs.renameSync(path.join(f.clone, '.git'), path.join(f.root, 'moved-git'));
    fs.writeFileSync(path.join(f.clone, '.git'), `gitdir: ${path.join(f.root, 'moved-git')}\n`);
    expect(runGuarded(f, 'true').status).not.toBe(0);
  });

  it('refuses a commondir redirect', () => {
    const f = cloneFixture();
    fs.writeFileSync(path.join(f.clone, '.git', 'commondir'), f.root);
    expect(runGuarded(f, 'true').status).not.toBe(0);
  });
});
