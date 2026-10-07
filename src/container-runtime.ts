/**
 * Container runtime constants.
 *
 * This file used to claim that "all runtime-specific logic lives here so
 * swapping runtimes means changing one file" while the actual runtime logic —
 * spawn argv, mounts, hardening, kill/stop, orphan reaping — lived in
 * `container-runner.ts` and the egress module. That logic now lives behind the
 * driver seam (`src/drivers/`), which is what makes the claim true.
 *
 * What is left is the binary name, still needed by the few paths that shell
 * Docker for something that is not a session: per-group image builds and the
 * egress lockdown network.
 */
import { execFile, spawn } from 'child_process';
import path from 'path';

import { readEnvFile } from './env.js';
import { getContainerImageBase } from './install-slug.js';
import { log } from './log.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'docker';

// Captured at load, the same way config.ts derives the install's paths.
const PROJECT_ROOT = process.cwd();
const INSPECT_TIMEOUT_MS = 5_000;
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;

export type ImagePresence = 'present' | 'missing' | 'unknown';

export interface ImageSelfHealDeps {
  inspect(image: string): Promise<ImagePresence>;
  /** Build `<defaultImageBase>:<tag>` the way an operator would. */
  build(tag: string): Promise<void>;
  /** This install's own image name; only it is ever rebuilt. */
  defaultImageBase: string;
  /** CONTAINER_IMAGE / CONTAINER_IMAGE_BASE set: the image is someone else's to provide. */
  imageOverridden: boolean;
  /** NANOCLAW_HARDENED_IMAGE=true: the image is pulled, never built locally. */
  hardenedImage: boolean;
}

function inspectImage(image: string): Promise<ImagePresence> {
  return new Promise((resolve) => {
    execFile(
      CONTAINER_RUNTIME_BIN,
      ['image', 'inspect', '--format', '{{.Id}}', image],
      { timeout: INSPECT_TIMEOUT_MS },
      (err, _stdout, stderr) => {
        if (!err) return resolve('present');
        // Only Docker's own answer counts as "missing". A timeout or a daemon
        // error says nothing about the image, and rebuilding on it would turn a
        // slow daemon into a 10-minute build on every spawn.
        resolve(/no such (image|object)/i.test(String(stderr)) ? 'missing' : 'unknown');
      },
    );
  });
}

function buildImage(tag: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Output goes to the service log as it streams, not into host memory.
    const child = spawn('bash', [path.join(PROJECT_ROOT, 'container', 'build.sh'), 'build', tag], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), BUILD_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`container/build.sh exited ${code ?? signal}`));
    });
  });
}

function defaultDeps(): ImageSelfHealDeps {
  const hardened = (
    process.env.NANOCLAW_HARDENED_IMAGE ??
    readEnvFile(['NANOCLAW_HARDENED_IMAGE']).NANOCLAW_HARDENED_IMAGE ??
    ''
  )
    .trim()
    .toLowerCase();
  return {
    inspect: inspectImage,
    build: buildImage,
    defaultImageBase: getContainerImageBase(PROJECT_ROOT),
    imageOverridden: Boolean(process.env.CONTAINER_IMAGE || process.env.CONTAINER_IMAGE_BASE),
    hardenedImage: hardened === 'true',
  };
}

/** One rebuild at a time: concurrent spawns wait on the same build. */
const inFlight = new Map<string, Promise<void>>();

// skill/image-self-heal — check if the agent image exists; if not, rebuild
// it via container/build.sh before the caller spawns a container. Coolify's
// nightly DockerCleanupJob has a known Go-template escaping bug
// (`{{{{...}}}}` instead of `{{...}}`) in its label-check command, so
// `coolify.managed=true` doesn't actually protect the image when disk usage
// crosses the threshold. Without this check, a deleted image makes every spawn
// fail with image-unavailable and the bot looks dead until someone manually
// rebuilds. The inspect runs on every spawn rather than being memoised: image
// deletion happens AFTER process start, not before.
// Composition owns this, not the driver: drivers never build images.
export async function ensureAgentImage(image: string, deps: ImageSelfHealDeps = defaultDeps()): Promise<void> {
  const presence = await deps.inspect(image);
  if (presence === 'present') return;
  if (presence === 'unknown') {
    log.warn('Agent image state unknown (inspect failed or timed out) — not rebuilding', { image });
    return;
  }

  const [base, tag = 'latest'] = image.split(/:(?=[^:/]+$)/);
  if (deps.imageOverridden || deps.hardenedImage || base !== deps.defaultImageBase) {
    log.error('Agent image missing and self-heal does not build it — provide the image', {
      image,
      imageOverridden: deps.imageOverridden,
      hardenedImage: deps.hardenedImage,
    });
    return;
  }

  let build = inFlight.get(image);
  if (!build) {
    log.warn('Agent image missing — rebuilding via container/build.sh', { image });
    build = deps
      .build(tag)
      .then(() => log.info('Agent image rebuilt', { image }))
      .finally(() => inFlight.delete(image));
    inFlight.set(image, build);
  }
  try {
    await build;
  } catch (err) {
    log.error('Agent image rebuild failed', { image, err });
    throw new Error(`Agent image ${image} missing and rebuild failed`, { cause: err });
  }
}

/** Test-only: forget an in-flight build left by a failing case. */
export function _resetSelfHealForTests(): void {
  inFlight.clear();
}
