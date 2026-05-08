# LLM Council Review — Docker Image Persistence on Shared Coolify/NanoClaw Server

> Generated: 2026-04-21
> Tier: standard

---

## Context

We run NanoClaw (a Claude Agent SDK bot) on a Hetzner VPS (Linux, Docker). The same server also runs Coolify (self-hosted PaaS) which manages deployments for our web app.

NanoClaw builds its own Docker image ("nanoclaw-agent:latest") locally on the server using `docker build`. This image is never pushed to a registry — it only exists locally. When a message comes in, NanoClaw spawns a container from this image to run the AI agent.

## The Problem

Every 1-2 days, the nanoclaw-agent image disappears. When that happens, the bot stops responding because `docker run` fails with "pull access denied for nanoclaw-agent, repository does not exist". The bot stays broken until someone manually rebuilds the image.

### Root Cause Analysis

Coolify has a `DockerCleanupJob` that runs periodically. Looking at the source code (`CleanupDocker.php`), the cleanup does these steps in order:

1. `docker container prune -f --filter "label=coolify.managed=true"` — prunes stopped containers WITH the coolify label
2. `docker image prune -f` — **prunes ALL dangling (untagged) images unconditionally**
3. `docker builder prune -af` — **prunes ALL build cache unconditionally**
4. A smart image cleanup that checks for `coolify.managed=true` label and skips those images

Our image HAS the `coolify.managed=true` label. Step 4 should protect it. But we suspect the image gets removed by step 2 (if it becomes dangling during a Coolify deployment of our web app) or by some other mechanism we haven't identified.

The image is ~1.9GB and takes ~30 seconds to rebuild (with cache) or ~3 minutes (without cache).

### Current Mitigations

- The Dockerfile includes `LABEL coolify.managed=true`
- NanoClaw has an auto-build mechanism that rebuilds the image if missing, but only at service startup — not at runtime when a message comes in

## Options We've Considered

1. **Disable Coolify Docker Cleanup for this server** — via Coolify settings. Simple but means Docker cruft accumulates (the server also runs other apps via Coolify)
2. **Cron job that rebuilds the image periodically** (e.g. every 6 hours) — brute force but reliable
3. **Push to a local registry** — run a local Docker registry, push the image there, pull from there. Image survives prunes because it's in the registry
4. **Improve NanoClaw's auto-build** — detect missing image at runtime (not just startup) and rebuild before spawning the container
5. **Something else entirely** — e.g. save/load image as tar, use Docker Compose with Coolify, etc.

## What We Need From You

We're a 2-person startup. We need the **simplest, most robust solution** that:

- Prevents the bot from going down when the image gets deleted
- Doesn't require ongoing maintenance or monitoring
- Doesn't break Coolify's ability to clean up its own deployment artifacts
- Works on a single Hetzner VPS running both Coolify and NanoClaw

Please evaluate the options above (and suggest alternatives if you see better ones). For each option, assess:
- Reliability (will it actually prevent downtime?)
- Complexity (how much work to implement and maintain?)
- Side effects (does it break anything else?)

Recommend ONE best approach with implementation details.
