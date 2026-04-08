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
export const CONTAINER_RUNTIME_BIN = 'container';

/**
 * IP address containers use to reach the host machine.
 * Apple Container VMs use a bridge network (192.168.64.x); the host is at the gateway.
 * Detected from the bridge0 interface, falling back to 192.168.64.1.
 */
export const CONTAINER_HOST_GATEWAY = detectHostGateway();

function detectHostGateway(): string {
  // Apple Container on macOS: containers reach the host via the bridge network gateway
  const ifaces = os.networkInterfaces();
  const bridge = ifaces['bridge100'] || ifaces['bridge0'];
  if (bridge) {
    const ipv4 = bridge.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  // Fallback: Apple Container's default gateway
  return '192.168.64.1';
}

/**
 * Address the credential proxy binds to.
 * Must be set via CREDENTIAL_PROXY_HOST in .env — there is no safe default
 * for Apple Container because bridge100 only exists while containers run,
 * but the proxy must start before any container.
 * The /convert-to-apple-container skill sets this during setup.
 */
export const PROXY_BIND_HOST = process.env.CREDENTIAL_PROXY_HOST;
if (!PROXY_BIND_HOST) {
  throw new Error(
    'CREDENTIAL_PROXY_HOST is not set in .env. Run /convert-to-apple-container to configure.',
  );
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
  return [
    '--mount',
    `type=bind,source=${hostPath},target=${containerPath},readonly`,
  ];
}

/** Stop a container by name. Uses execFileSync to avoid shell injection. */
export function stopContainer(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  execSync(`${CONTAINER_RUNTIME_BIN} stop ${name}`, { stdio: 'pipe' });
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} system status`, { stdio: 'pipe' });
    logger.debug('Container runtime already running');
  } catch {
    logger.info('Starting container runtime...');
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} system start`, {
        stdio: 'pipe',
        timeout: 30000,
      });
      logger.info('Container runtime started');
    } catch (err) {
      logger.error({ err }, 'Failed to start container runtime');
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
        '║  1. Ensure Apple Container is installed                        ║',
      );
      console.error(
        '║  2. Run: container system start                                ║',
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
    const output = execSync(`${CONTAINER_RUNTIME_BIN} ls --format json`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const containers: { status: string; configuration: { id: string } }[] =
      JSON.parse(output || '[]');
    const orphans = containers
      .filter(
        (c) =>
          c.status === 'running' && c.configuration.id.startsWith('nanoclaw-'),
      )
      .map((c) => c.configuration.id);
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
