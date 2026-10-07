/**
 * skill/image-self-heal — rebuild the default agent image when it is gone,
 * without blocking the event loop, without two concurrent builds, and without
 * mistaking a slow or unknown answer for "missing".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const logMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }));
vi.mock('./log.js', () => ({ log: logMock }));

import { _resetSelfHealForTests, ensureAgentImage, type ImageSelfHealDeps } from './container-runtime.js';

const BASE = 'nanoclaw-agent-v2-abcd1234';
const IMAGE = `${BASE}:latest`;

function deps(over: Partial<ImageSelfHealDeps> = {}): ImageSelfHealDeps & {
  inspect: ReturnType<typeof vi.fn>;
  build: ReturnType<typeof vi.fn>;
} {
  return {
    inspect: vi.fn(async () => 'present' as const),
    build: vi.fn(async () => {}),
    defaultImageBase: BASE,
    imageOverridden: false,
    hardenedImage: false,
    ...over,
  } as never;
}

afterEach(() => {
  _resetSelfHealForTests();
  vi.clearAllMocks();
});

describe('ensureAgentImage', () => {
  it('does nothing when the image is present', async () => {
    const d = deps();
    await ensureAgentImage(IMAGE, d);
    expect(d.build).not.toHaveBeenCalled();
  });

  it('rebuilds exactly the missing tag', async () => {
    const d = deps({ inspect: vi.fn(async () => 'missing' as const) });
    await ensureAgentImage(`${BASE}:canary`, d);
    expect(d.build).toHaveBeenCalledWith('canary');
  });

  it('shares one build between concurrent spawns', async () => {
    let finish!: () => void;
    const d = deps({
      inspect: vi.fn(async () => 'missing' as const),
      build: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    const first = ensureAgentImage(IMAGE, d);
    const second = ensureAgentImage(IMAGE, d);
    await vi.waitFor(() => expect(d.build).toHaveBeenCalled());
    finish();
    await Promise.all([first, second]);
    expect(d.build).toHaveBeenCalledTimes(1);
  });

  it('treats an unknown inspect result (timeout, daemon error) as not missing', async () => {
    const d = deps({ inspect: vi.fn(async () => 'unknown' as const) });
    await ensureAgentImage(IMAGE, d);
    expect(d.build).not.toHaveBeenCalled();
    expect(logMock.warn).toHaveBeenCalled();
  });

  it('refuses to build an overridden image and says so loudly', async () => {
    const d = deps({ inspect: vi.fn(async () => 'missing' as const), imageOverridden: true });
    await ensureAgentImage(IMAGE, d);
    expect(d.build).not.toHaveBeenCalled();
    expect(logMock.error).toHaveBeenCalled();
  });

  it('refuses to build over a hardened (pulled) image', async () => {
    const d = deps({ inspect: vi.fn(async () => 'missing' as const), hardenedImage: true });
    await ensureAgentImage(IMAGE, d);
    expect(d.build).not.toHaveBeenCalled();
    expect(logMock.error).toHaveBeenCalled();
  });

  it("refuses an image outside this install's base", async () => {
    const d = deps({ inspect: vi.fn(async () => 'missing' as const) });
    await ensureAgentImage('someone-else:latest', d);
    expect(d.build).not.toHaveBeenCalled();
    expect(logMock.error).toHaveBeenCalled();
  });

  it('propagates a failed build so the spawn fails visibly, then allows a retry', async () => {
    const d = deps({
      inspect: vi.fn(async () => 'missing' as const),
      build: vi.fn(async () => {
        throw new Error('build failed');
      }),
    });
    await expect(ensureAgentImage(IMAGE, d)).rejects.toThrow(/missing and rebuild failed/);
    await expect(ensureAgentImage(IMAGE, d)).rejects.toThrow(/missing and rebuild failed/);
    expect(d.build).toHaveBeenCalledTimes(2);
  });
});

describe('runBuildScript', () => {
  it('kills the whole build process group on timeout, grandchildren included', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { runBuildScript } = await import('./container-runtime.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-heal-'));
    const pidFile = path.join(dir, 'grandchild.pid');
    const script = path.join(dir, 'build.sh');
    // Like docker build under build.sh: the real work is a grandchild.
    fs.writeFileSync(script, `#!/bin/bash\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`, { mode: 0o755 });

    await expect(
      runBuildScript({ script, tag: 'latest', cwd: dir, timeoutMs: 300, stdio: 'ignore' }),
    ).rejects.toThrow();
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 200));
    const alive = (() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    })();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(alive).toBe(false);
  });
});
