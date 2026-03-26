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

/** Hostname containers use to reach the host machine. */
export const CONTAINER_HOST_GATEWAY = 'host.docker.internal';

/**
 * Address the credential proxy binds to.
 * Docker Desktop (macOS): 127.0.0.1 — the VM routes host.docker.internal to loopback.
 * Docker (Linux): bind to the docker0 bridge IP so only containers can reach it,
 *   falling back to 0.0.0.0 if the interface isn't found.
 */
export const PROXY_BIND_HOST =
  process.env.CREDENTIAL_PROXY_HOST || detectProxyBindHost();

function detectProxyBindHost(): string {
  if (os.platform() === 'darwin') return '127.0.0.1';

  // WSL uses Docker Desktop (same VM routing as macOS) — loopback is correct.
  // Check /proc filesystem, not env vars — WSL_DISTRO_NAME isn't set under systemd.
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return '127.0.0.1';

  // Bare-metal Linux: bind to the docker0 bridge IP so containers can reach it
  const ifaces = os.networkInterfaces();
  const docker0 = ifaces['docker0'];
  if (docker0) {
    const ipv4 = docker0.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }

  // Fallback to localhost — never bind to 0.0.0.0 (would expose credentials to network)
  logger.warn(
    'docker0 bridge not found, binding credential proxy to 127.0.0.1. ' +
      'Containers may not reach the proxy. Set CREDENTIAL_PROXY_HOST explicitly.',
  );
  return '127.0.0.1';
}

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

/** Returns the shell command to stop a container by name. */
export function stopContainer(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`;
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
    throw new Error('Container runtime is required but failed to start');
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
        execSync(stopContainer(name), { stdio: 'pipe' });
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
