---
name: add-image-self-heal
description: Auto-rebuild the agent container image if it's missing at spawn time. Defends against Coolify's buggy cleanup deleting the image despite the `coolify.managed=true` label. Triggers on "image self-heal", "image disappears", "coolify deletes image", "code 125".
---

# /add-image-self-heal

Adds a `docker image inspect` check before each container spawn. If the agent image is missing, runs `bash container/build.sh` synchronously to rebuild it, then proceeds with the spawn.

## Why

`coolify.managed=true` (skill/coolify-deploy) is supposed to protect our agent image from Coolify's nightly DockerCleanupJob, but Coolify's label-check command has a Go-template escaping bug — `{{{{index .Config.Labels \"coolify.managed\"}}}}` (four braces). The template engine outputs nothing, the `grep -q true` doesn't match, and `docker rmi` runs anyway.

Result: image disappears at random intervals (whenever disk crosses Coolify's cleanup threshold), every subsequent container spawn exits with docker code 125, and the bot looks dead until someone manually runs `bash container/build.sh`.

This skill closes that gap on our side: when the host tries to spawn and the image is missing, it rebuilds first. The first message after a Coolify nuke pays a ~30s latency hit, then everything works again.

## What it does

1. New function `ensureAgentImage(imageName, projectRoot?)` in `src/container-runtime.ts`:
   - `docker image inspect <name>` (fast, ~10ms)
   - If missing: `bash container/build.sh` (synchronous, ~30s when base layers cached)
   - Module-level memo so the first verification per process is the only inspect call
   - Throws on rebuild failure (caller's `spawn` won't run with a missing image)
2. Wired into `spawnContainer` in `src/container-runner.ts` immediately before the `spawn(...)` call

## Apply

```bash
git fetch origin skill/image-self-heal
git merge origin/skill/image-self-heal
pnpm install --frozen-lockfile
pnpm run build
# restart service
```

Conflicts unlikely — patches are bounded by `// skill/image-self-heal` markers in both files.

## Watch list (on upstream re-merge)

| File | Where |
|------|-------|
| `src/container-runtime.ts` | Imports + the `ensureAgentImage` block before `cleanupOrphans` |
| `src/container-runner.ts` | Import line + the call site immediately before `log.info('Spawning container', ...)` |

If upstream restructures `spawnContainer` (the host-side spawn flow), re-target the `ensureAgentImage(...)` call so it still runs before `spawn(CONTAINER_RUNTIME_BIN, args, ...)`.

## Related

- `.claude/skills/add-coolify-deploy/SKILL.md` — the label that Coolify is supposed to honor (and would if not for the bug)
- v1 had an equivalent `ensureContainerImage()` at host startup. v2 dropped it; this skill restores the behavior at the right level (per-spawn, not just at host start, so we catch deletions during long-running host processes).

## Files touched

| File | Change |
|------|--------|
| `src/container-runtime.ts` | NEW `ensureAgentImage()` + `path` import |
| `src/container-runner.ts` | Import `ensureAgentImage` + `getDefaultContainerImage`, call before spawn |
