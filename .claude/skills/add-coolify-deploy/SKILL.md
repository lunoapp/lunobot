---
name: add-coolify-deploy
description: Protect the NanoClaw agent container image from Coolify's nightly cleanup. Adds `coolify.managed=true` label to the Dockerfile so DockerCleanupJob skips it. Triggers on "coolify", "image cleanup", "image prune".
---

# /add-coolify-deploy

Adds the `coolify.managed=true` Docker label to the NanoClaw agent container image so Coolify's nightly DockerCleanupJob doesn't garbage-collect it.

## Why

If your NanoClaw host also runs Coolify (managed Docker host with a cleanup cron), Coolify will prune any image that isn't currently in a running container OR labelled `coolify.managed=true`. Bot containers spawn on demand and exit when idle, so they regularly look "unused" at prune time.

Without the label, you'll wake up one day and the agent image is gone — next bot message tries to spawn → image not found → host rebuilds (slow) or errors.

With the label, Coolify ignores the image. Cleanup still works for everything else.

## Apply

```bash
git fetch origin skill/coolify-deploy
git merge origin/skill/coolify-deploy
./container/build.sh   # rebuild so the label sticks
```

Conflicts unlikely — the patch lives in `container/Dockerfile` immediately after `FROM node:22-slim`. Marked with `# skill/coolify-deploy` comment.

## Verify

```bash
docker image inspect nanoclaw-agent-v2-<slug>:latest --format '{{.Config.Labels}}'
# Should contain: coolify.managed:true
```

## Files touched

| File | Change |
|------|--------|
| `container/Dockerfile` | `LABEL coolify.managed=true` after FROM |

## Update strategy

When upstream `container/Dockerfile` changes:

```bash
git checkout skill/coolify-deploy
git fetch upstream
git merge upstream/main   # resolve conflict at the LABEL line if upstream restructures
git push origin skill/coolify-deploy
git checkout main
git merge origin/skill/coolify-deploy
```

The `# skill/coolify-deploy` marker makes the conflict trivial.
