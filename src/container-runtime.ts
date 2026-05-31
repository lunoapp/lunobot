/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';

import { CONTAINER_INSTALL_LABEL } from './config.js';
import { log } from './log.js';

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
export function readonlyMountArgs(hostPath: string, containerPath: string): string[] {
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
    log.debug('Container runtime already running');
  } catch (err) {
    log.error('Failed to reach container runtime', { err });
    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║  FATAL: Container runtime failed to start                      ║');
    console.error('║                                                                ║');
    console.error('║  Agents cannot run without a container runtime. To fix:        ║');
    console.error('║  1. Ensure Docker is installed and running                     ║');
    console.error('║  2. Run: docker info                                           ║');
    console.error('║  3. Restart NanoClaw                                           ║');
    console.error('╚════════════════════════════════════════════════════════════════╝\n');
    throw new Error('Container runtime is required but failed to start', {
      cause: err,
    });
  }
}

// skill/image-self-heal — check if the agent image exists; if not, rebuild
// it synchronously via container/build.sh before the caller spawns a
// container. Coolify's nightly DockerCleanupJob has a known Go-template
// escaping bug (`{{{{...}}}}` instead of `{{...}}`) in its label-check
// command, so `coolify.managed=true` doesn't actually protect the image
// when disk usage crosses the threshold. Without this check, a deleted
// image causes every container spawn to exit with docker code 125 and
// the bot looks dead until someone manually rebuilds. Module-scope memo
// keeps the cost to a single `docker image inspect` per process.
let imageVerifiedThisProcess = false;
export function ensureAgentImage(imageName: string, projectRoot: string = process.cwd()): void {
  if (imageVerifiedThisProcess) return;
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} image inspect ${imageName}`, { stdio: 'pipe', timeout: 5000 });
    imageVerifiedThisProcess = true;
    return;
  } catch {
    log.warn('Agent image missing — rebuilding via container/build.sh', { imageName });
  }
  const buildScript = path.join(projectRoot, 'container', 'build.sh');
  try {
    execSync(`bash ${buildScript}`, { stdio: 'pipe', timeout: 600_000, cwd: projectRoot });
    imageVerifiedThisProcess = true;
    log.info('Agent image rebuilt', { imageName });
  } catch (err) {
    log.error('Agent image rebuild failed', { imageName, err });
    throw new Error(`Agent image ${imageName} missing and rebuild failed`, { cause: err });
  }
}

/**
 * Kill orphaned NanoClaw containers from THIS install's previous runs.
 *
 * Scoped by label `nanoclaw-install=<slug>` so a crash-looping peer install
 * cannot reap our containers, and we cannot reap theirs. The label is
 * stamped onto every container at spawn time — see container-runner.ts.
 */
export function cleanupOrphans(): void {
  try {
    const output = execSync(
      `${CONTAINER_RUNTIME_BIN} ps --filter label=${CONTAINER_INSTALL_LABEL} --format '{{.Names}}'`,
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      },
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
      log.info('Stopped orphaned containers', { count: orphans.length, names: orphans });
    }
  } catch (err) {
    log.warn('Failed to clean up orphaned containers', { err });
  }
}
