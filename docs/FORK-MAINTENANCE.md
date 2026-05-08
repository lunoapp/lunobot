# Lunobot Fork Maintenance

This is a customized fork of [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw). Upstream is `upstream`, our fork is `origin` (lunoapp/lunobot). Server pulls from `origin`.

This document is the canonical guide for keeping the fork in sync with upstream, deploying changes, and onboarding new customizations.

## What this fork adds on top of upstream

| | Where | What | Lives on |
|---|---|---|---|
| **Lubo persona** | `container/skills/lubo-persona/instructions.md` | Auto-loaded system-prompt fragment with identity, tone, behavior. Slim — no product facts (those come from luno repo mount). | `main` (additive — no upstream conflict) |
| **luno marketing skills** | `container/skills/{write-luno,log-post,generate-image}/SKILL.md` | Slash commands for content drafting, Teable logging, Replicate image generation. | `main` (additive) |
| **Voice transcription** | `src/transcription.ts` + hook in `src/channels/telegram.ts` | Local whisper.cpp on host, transcribes Telegram voice notes pre-router. | Skill branch `skill/voice-transcription` (patches upstream `telegram.ts`) |
| **Coolify deploy** | `container/Dockerfile` | `LABEL coolify.managed=true` — protects image from Coolify cleanup cron. | Skill branch `skill/coolify-deploy` (patches upstream Dockerfile) |
| **Migration guide (v1→v2)** | `.nanoclaw-migrations/` | Historical reference. The actual migration ran in May 2026 via `migrate-v2.sh`. Keep as documentation. | `main` (additive) |
| **Avatars + research docs** | `assets/avatar-*`, `docs/council/` | Branding + multi-LLM council notes. | `main` (additive) |
| **Diagnostics opt-out** | `.claude/skills/{migrate-nanoclaw,update-nanoclaw}/diagnostics.md` | We don't ship telemetry. | `main` (overrides upstream) |
| **Test type-error patches** | `src/host-core.test.ts`, `src/modules/agent-to-agent/agent-route.test.ts` | Fixes for upstream v2.0.44 test bugs (`in_reply_to`, `archived` enum). Drop when upstream releases the fix. | `main` (patches upstream tests) |

The `// skill/voice-transcription` and `# skill/coolify-deploy` markers in the touch points make conflicts trivial to find on an upstream re-merge.

## Architecture notes

- **Server is the single deployment** — `ssh luno`, runs as user `nanoclaw` at `/home/nanoclaw/nanoclaw-v2`.
- **Old v1 install** still lives at `/home/nanoclaw/nanoclaw` (untouched, available for rollback).
- **luno repo mount** — bot reads canonical product docs from `/workspace/extra/luno/` per-group via `container.json` `additionalMounts`. Server has the luno repo cloned at `/home/nanoclaw/luno` via SSH deploy key (`~/.ssh/luno_deploy_key`).
- **Mount allowlist** — `~/.config/nanoclaw/mount-allowlist.json` on server allows `/home/nanoclaw/luno` (read-only).
- **Whisper.cpp on host** — model at `/home/nanoclaw/nanoclaw/data/models/ggml-base.bin`, binary at `/usr/local/bin/whisper-cli`. `WHISPER_*` env vars in v2's `.env`.
- **Owner role**: `telegram:496249047` (Jan) is global owner via `user_roles` table.
- **Service**: systemd user unit `nanoclaw-v2-1e478a5f` (slug = sha1(project_root)[:8]).

## Routine update from upstream

```bash
# 1. Fetch upstream
git fetch upstream

# 2. Preview what's coming
git log --oneline main..upstream/main | head -20
git diff main..upstream/main --stat | tail -5

# 3. Backup
git branch backup/pre-update-$(date +%Y%m%d) main

# 4. Merge into main
git merge upstream/main
# Conflicts likely in:
#   - src/channels/telegram.ts (look for // skill/voice-transcription markers — keep our wrap)
#   - container/Dockerfile (look for # skill/coolify-deploy marker — keep LABEL)
#   - test files we patched (drop our patches if upstream fixed them)

# 5. Build + test locally
pnpm install
pnpm run build

# 6. Rebase skill branches onto new main (so they stay current)
for branch in skill/voice-transcription skill/coolify-deploy; do
  git checkout $branch
  git merge main
  # resolve conflicts at the marker comments
  git push origin $branch
done

# 7. Push main
git checkout main
git push origin main

# 8. Deploy to server
ssh luno "su - nanoclaw -c 'export PATH=\$HOME/.local/bin:\$PATH && cd ~/nanoclaw-v2 && git pull && pnpm install --frozen-lockfile && pnpm run build && bash container/build.sh'"
ssh luno "XDG_RUNTIME_DIR=/run/user/\$(id -u nanoclaw) su -s /bin/bash nanoclaw -c 'systemctl --user restart nanoclaw-v2-1e478a5f'"

# 9. Verify
ssh luno "tail -20 /home/nanoclaw/nanoclaw-v2/logs/nanoclaw.log"
# Send a Telegram test message — text, voice, photo — confirm responses.
```

## Adding a new customization

**If the change is additive** (new files, no upstream-file modifications) — commit straight to `main`. Examples: new container skill, new doc, new asset.

**If the change patches an upstream file** — create a feature skill branch:

```bash
git checkout -b skill/<name>
# ... make changes, mark with `// skill/<name>` comments at touch points
git commit -m "skill/<name>: <what>"
git push origin skill/<name>
git checkout main
git merge --no-ff skill/<name>
git push origin main
```

Always include a `.claude/skills/add-<name>/SKILL.md` documenting:
- what it does
- which files it touches
- conflict-resolution notes for upstream re-merge
- prereqs (host setup, env vars)

## Server-side state that's NOT in the repo (recreate on fresh install)

| | Where | Purpose |
|---|---|---|
| `~/.ssh/luno_deploy_key`, `~/.ssh/luno_deploy_key.pub`, `~/.ssh/config` (Host `github-luno`) | nanoclaw user | SSH deploy key for the luno repo. Public key registered as deploy key on `lunoapp/luno`. |
| `~/luno` git clone (`github-luno:lunoapp/luno`) | nanoclaw home | Mounted into containers as `/workspace/extra/luno/`. Refresh manually with `git -C ~/luno pull`. |
| `~/.config/nanoclaw/mount-allowlist.json` | nanoclaw config | Allows `/home/nanoclaw/luno` mount. |
| `~/.local/bin/pnpm`, PATH update in `~/.bashrc` | nanoclaw user-local | pnpm without sudo. Install: `npm config set prefix ~/.local && npm install -g pnpm@<pinned>` plus symlink fix to `~/.local/bin/pnpm`. |
| `loginctl enable-linger nanoclaw` (as root) | systemd | Keeps user systemd alive without active login. |
| systemd unit `nanoclaw-v2-1e478a5f` | `~/.config/systemd/user/` | Generated by `pnpm exec tsx setup/index.ts --step service`. |
| `.env` | project root | Channel tokens, OneCLI config, `WHISPER_*` paths, `GITHUB_APP_*`. |
| `~/credentials/google-service-account.json`, `~/credentials/github-app.pem` | nanoclaw home | Per the v1 setup. (v2 may not need these — verify before reinstalling.) |
| Whisper binary + model | `/usr/local/bin/whisper-cli`, `/home/nanoclaw/nanoclaw/data/models/ggml-base.bin` | Built from whisper.cpp source. See `.claude/skills/add-voice-transcription/SKILL.md`. |
| `data/v2.db`, `data/v2-sessions/`, `groups/` | project root | Runtime state. Backed up via `~/backups/pre-v2-*` snapshots. |

## Rollback

If an update breaks, the cleanest rollback:

```bash
# Lokal:
git reset --hard backup/pre-update-<timestamp>
git push origin main --force-with-lease

# Auf Server:
ssh luno "su - nanoclaw -c 'cd ~/nanoclaw-v2 && git pull && pnpm install --frozen-lockfile && pnpm run build && bash container/build.sh'"
ssh luno "XDG_RUNTIME_DIR=/run/user/\$(id -u nanoclaw) su -s /bin/bash nanoclaw -c 'systemctl --user restart nanoclaw-v2-1e478a5f'"
```

For nuclear rollback (back to v1):
```bash
ssh luno "XDG_RUNTIME_DIR=/run/user/\$(id -u nanoclaw) su -s /bin/bash nanoclaw -c '
  systemctl --user stop nanoclaw-v2-1e478a5f &&
  systemctl --user start nanoclaw    # the legacy v1 unit, still installed
'"
```

The v1 install at `/home/nanoclaw/nanoclaw` is preserved untouched.

## Watch list

Things to verify on each upstream sync, because they touch our customizations or runtime expectations:

- `src/channels/telegram.ts` — voice-transcription wrap point
- `src/channels/chat-sdk-bridge.ts` — attachment shape (we depend on `att.data` being base64-encoded)
- `src/modules/mount-security/index.ts` — mount allowlist schema
- `container/Dockerfile` — coolify-deploy LABEL line
- `src/host-core.test.ts`, `src/modules/agent-to-agent/agent-route.test.ts` — drop our type-error patches when upstream fixes them (currently v2.0.44)
- `groups/global/CLAUDE.md` — v2 deletes this on startup. If upstream changes that behavior, our state will diverge. The Lubo persona doesn't depend on this file (it's at `container/skills/lubo-persona/`).

## Backup state on origin

| Branch | Purpose | Keep until |
|---|---|---|
| `backup/v1-final` | v1 fork's final state before v2 migration | At least one full upstream cycle proves v2 is stable on this install |
| `skill/voice-transcription` | Voice-transcription skill | Forever (re-merge target) |
| `skill/coolify-deploy` | Coolify-deploy skill | Forever (re-merge target) |
