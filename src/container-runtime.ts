/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { CONTAINER_IMAGE } from './config.js';
import { logger } from './logger.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'docker';

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // On Linux, host.docker.internal isn't built-in — add it explicitly
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Stop a container by name. Uses execFileSync to avoid shell injection. */
export function stopContainer(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  execSync(`${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`, { stdio: 'pipe' });
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, {
      stdio: 'pipe',
      timeout: 10000,
    });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Container runtime failed to start                      ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without a container runtime. To fix:        ║',
    );
    console.error(
      '║  1. Ensure Docker is installed and running                     ║',
    );
    console.error(
      '║  2. Run: docker info                                           ║',
    );
    console.error(
      '║  3. Restart NanoClaw                                           ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Container runtime is required but failed to start', {
      cause: err,
    });
  }
}

/** Ensure the agent container image exists, auto-building if missing. */
export function ensureContainerImage(): void {
  try {
    const output = execSync(
      `${CONTAINER_RUNTIME_BIN} image inspect ${CONTAINER_IMAGE} --format '{{.Id}}'`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    if (output.trim()) {
      logger.debug({ image: CONTAINER_IMAGE }, 'Container image found');
      return;
    }
  } catch {
    // image not found
  }

  // Auto-build the container image
  const buildScript = path.join(process.cwd(), 'container', 'build.sh');
  if (fs.existsSync(buildScript)) {
    logger.warn(
      { image: CONTAINER_IMAGE },
      'Container image not found — auto-building',
    );
    try {
      execSync(`bash ${buildScript}`, {
        stdio: 'pipe',
        timeout: 600_000,
        cwd: process.cwd(),
      });
      logger.info(
        { image: CONTAINER_IMAGE },
        'Container image built successfully',
      );
      return;
    } catch (buildErr) {
      logger.error({ err: buildErr }, 'Auto-build failed');
    }
  }

  throw new Error(
    `Container image '${CONTAINER_IMAGE}' not found and auto-build failed. Run: bash container/build.sh`,
  );
}

/** Docker network name for NanoClaw containers (isolates from other services). */
export const CONTAINER_NETWORK = 'nanoclaw-internal';

/** Ensure the isolated Docker network exists, creating it if needed. */
export function ensureContainerNetwork(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} network inspect ${CONTAINER_NETWORK}`, {
      stdio: 'pipe',
    });
  } catch {
    try {
      execSync(
        `${CONTAINER_RUNTIME_BIN} network create --driver bridge ${CONTAINER_NETWORK}`,
        { stdio: 'pipe' },
      );
      logger.info(
        { network: CONTAINER_NETWORK },
        'Created isolated container network',
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to create container network, using default');
    }
  }
}

/** Clean up stale credentials temp files from previous runs. */
export function cleanupStaleCredentials(): void {
  try {
    const tmpDir = os.tmpdir();
    const files = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith('nanoclaw-creds-'));
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(tmpDir, file));
      } catch {
        /* best effort */
      }
    }
    if (files.length > 0) {
      logger.info(
        { count: files.length },
        'Cleaned up stale credentials files',
      );
    }
  } catch {
    /* ignore */
  }
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    const output = execSync(
      `${CONTAINER_RUNTIME_BIN} ps --filter name=nanoclaw- --format '{{.Names}}'`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const orphans = output.trim().split('\n').filter(Boolean);
    for (const name of orphans) {
      try {
        stopContainer(name);
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
