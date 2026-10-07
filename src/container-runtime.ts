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
import { execSync } from 'child_process';
import path from 'path';

import { log } from './log.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'docker';

// skill/image-self-heal — check if the agent image exists; if not, rebuild
// it synchronously via container/build.sh before the caller spawns a
// container. Coolify's nightly DockerCleanupJob has a known Go-template
// escaping bug (`{{{{...}}}}` instead of `{{...}}`) in its label-check
// command, so `coolify.managed=true` doesn't actually protect the image
// when disk usage crosses the threshold. Without this check, a deleted
// image makes every spawn fail with image-unavailable and the bot looks
// dead until someone manually rebuilds. `docker image inspect` costs a few
// ms per spawn, so we do it every time rather than memo-ing (memoing the
// success case across the host lifetime is the bug this self-heal must
// avoid: image deletion happens AFTER process start, not before).
// Composition owns this, not the driver: drivers never build images.
export function ensureAgentImage(imageName: string, projectRoot: string = process.cwd()): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} image inspect ${imageName}`, { stdio: 'pipe', timeout: 5000 });
    return;
  } catch {
    log.warn('Agent image missing — rebuilding via container/build.sh', { imageName });
  }
  const buildScript = path.join(projectRoot, 'container', 'build.sh');
  try {
    execSync(`bash ${buildScript}`, { stdio: 'pipe', timeout: 600_000, cwd: projectRoot });
    log.info('Agent image rebuilt', { imageName });
  } catch (err) {
    log.error('Agent image rebuild failed', { imageName, err });
    throw new Error(`Agent image ${imageName} missing and rebuild failed`, { cause: err });
  }
}
