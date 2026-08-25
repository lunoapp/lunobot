# Lunobot Fork Maintenance

This is a customized fork of [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw). Upstream is `upstream`, our fork is `origin` (lunoapp/lunobot). Server pulls from `origin`.

This document is the canonical guide for keeping the fork in sync with upstream, deploying changes, and onboarding new customizations.

## What this fork adds on top of upstream

| | Where | What | Lives on |
|---|---|---|---|
| **Lubo persona** | `container/skills/lubo-persona/instructions.md` | Auto-loaded system-prompt fragment with identity, tone, behavior. Slim — no product facts (those come from luno repo mount). | `main` (additive — no upstream conflict) |
| **luno marketing skills** | `container/skills/{write-luno,log-post,generate-image}/SKILL.md` | Slash commands for content drafting, Teable logging, Replicate image generation. | `main` (additive) |
| **Voice transcription** | `src/transcription.ts` + hook in `src/channels/telegram.ts` | Local whisper.cpp on host, transcribes Telegram voice notes pre-router. | Skill branch `skill/voice-transcription` (patches upstream `telegram.ts`) |
| **Coolify deploy** | `container/Dockerfile` | `LABEL coolify.managed=true` — Coolify is *supposed* to honour this; it doesn't always (see image-self-heal). | Skill branch `skill/coolify-deploy` (patches upstream Dockerfile) |
| **Image self-heal** | `src/container-runtime.ts` + call site in `src/container-runner.ts` | `ensureAgentImage()` before each spawn — rebuilds via `container/build.sh` if missing. Defends against Coolify's buggy label-check (`{{{{...}}}}` Go-template over-escape). | Skill branch `skill/image-self-heal` (patches upstream `container-runtime.ts` + `container-runner.ts`) |
| **Google Docs MCP** | `container/Dockerfile` | Installs `@a-bonus/google-docs-mcp@<pinned>` in the agent image. Per-install config wires it through OneCLI Apps Framework with stub credentials (no SA, no plaintext refresh tokens in containers). | Skill branch `skill/google-docs-mcp` (patches upstream `Dockerfile`) |
| **Migration guide (v1→v2)** | `.nanoclaw-migrations/` | Historical reference. The actual migration ran in May 2026 via `migrate-v2.sh`. Keep as documentation. | `main` (additive) |
| **Avatars + research docs** | `assets/avatar-*`, `docs/council/` | Branding + multi-LLM council notes. | `main` (additive) |
| **Diagnostics opt-out** | `.claude/skills/{migrate-nanoclaw,update-nanoclaw}/diagnostics.md` | We don't ship telemetry. | `main` (overrides upstream) |
| **Test type-error patches** | `src/host-core.test.ts`, `src/modules/agent-to-agent/agent-route.test.ts` | Fixes for upstream v2.0.44 test bugs (`in_reply_to`, `archived` enum). Drop when upstream releases the fix. | `main` (patches upstream tests) |

The `// skill/voice-transcription` and `# skill/coolify-deploy` markers in the touch points make conflicts trivial to find on an upstream re-merge.

## Runtime: Docker only — never adopt Apple-container or native-credential-proxy

This fork runs **exclusively on a Linux server (Hetzner) with Docker**. There is no local Apple-container operation. The old dual-runtime idea (Docker on server, Apple container locally) was an early-days mistake and should disappear, not be preserved.

- Container runtime is **Docker**; no runtime detection needed.
- On refactors, **remove** Apple-container code paths in `src/container-runtime.ts` / `src/container-runner.ts` (the `CONTAINER_RUNTIME` env, `host.docker.internal` vs bridge-IP, /dev/null-mount vs entrypoint mount-bind) — don't carry them forward.
- Upstream skill `skill/apple-container`: **never merge.**
- Upstream skill `skill/native-credential-proxy`: **never merge** — it replaces OneCLI entirely, and the server needs OneCLI for credential injection.
- On any upstream pull/merge, drop Apple-container customizations from the migration guide.

## Architecture notes

- **Server is the single deployment** — `ssh luno`, runs as user `nanoclaw` at `/home/nanoclaw/nanoclaw-v2`.
- **The bot on Telegram** is `@hiluno_bot` — DMs plus the luno group.
- **Old v1 install** still lives at `/home/nanoclaw/nanoclaw` (untouched, available for rollback).
- **luno repo mount** — bot reads canonical product docs from `/workspace/extra/luno/` per-group via `container.json` `additionalMounts`. Server has the luno repo cloned at `/home/nanoclaw/luno` via SSH deploy key (`~/.ssh/luno_deploy_key`).
- **Mount allowlist** — `~/.config/nanoclaw/mount-allowlist.json` on server allows `/home/nanoclaw/luno` (read-only).
- **Whisper.cpp on host** — model at `/home/nanoclaw/nanoclaw/data/models/ggml-base.bin`, binary at `/usr/local/bin/whisper-cli`. `WHISPER_*` env vars in v2's `.env`.
- **Owner role**: the operator's Telegram identity is the global owner, via the `user_roles` table. The concrete id lives in the database, not in this repo.
- **Service**: systemd user unit `nanoclaw-v2-1e478a5f` (slug = sha1(project_root)[:8]). Runs with `KillMode=process`, so a restart takes down the host process only — agent containers it spawned stay alive on purpose.

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

## Operating the running service

`XDG_RUNTIME_DIR` is not decoration. Invoking nanoclaw's *user* systemd instance as root
via `su` fails with `Failed to connect to bus: No medium found` unless the variable points
at the user's runtime directory — hence the prefix on every `systemctl --user` call above.

```bash
# Status
ssh luno "XDG_RUNTIME_DIR=/run/user/\$(id -u nanoclaw) su -s /bin/bash nanoclaw -c 'systemctl --user status nanoclaw-v2-1e478a5f --no-pager | head -10'"

# Journal (the app's own logs are the files under logs/, this is the unit's view)
ssh luno "XDG_RUNTIME_DIR=/run/user/\$(id -u nanoclaw) su -s /bin/bash nanoclaw -c 'journalctl --user -u nanoclaw-v2-1e478a5f -n 50'"
```

### Making a `container.json` change take effect

`container-runner.ts` calls `readContainerConfig()` at spawn time, so a **new** container
picks up the edited file and a container that is already up keeps the config it started
with. Restarting the service does not help: `KillMode=process` deliberately leaves the
spawned containers running. Stop them, and the next inbound message spawns fresh:

```bash
ssh luno "docker ps --filter name=nanoclaw-v2 --format '{{.Names}}' | xargs -r docker stop"
```

Containers run with `--rm`, so their logs are gone once they exit — to debug one, `docker
exec` into it while it is still alive.

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

## Integrations wired per group

Two tools reach outside the container without going through the OneCLI proxy.
Both are deliberate exceptions, for the same underlying reason: OneCLI injects
static secrets into HTTP requests it can see, and neither of these fits that.

### GitHub App tool

The bot acts as the `hiluno-bot` GitHub App — it reads the org and opens issues
under its own bot identity rather than as a person. Wiring:

- The App's **private key never enters the container**. `mintGithubAppToken()` in
  `src/container-runner.ts` signs a JWT host-side, exchanges it for a 1-hour
  installation token, and injects only that token as
  `GITHUB_PERSONAL_ACCESS_TOKEN`. App id and installation id come from `.env`.
- The agent-runner enables `github/github-mcp-server` (toolsets `repos`, `issues`,
  `context`) **iff** that variable is present, so an unconfigured install just
  runs without the tool.
- Which groups get it is the `GITHUB_ENABLED_GROUPS` set in `container-runner.ts`.
  The App itself is installed on one repository, so the set can only narrow what
  the App already permits, never widen it.

Not OneCLI, because App auth is private-key JWT crypto rather than a static
secret — the same host-side principle as the IMAP rule in `docs/onecli.md`.

### Supabase read-only MCP

`@supabase/mcp-server-supabase` (pinned in `container/Dockerfile`) gives the bot
read-only queries against the production database. It is wired per group through
`groups/<folder>/container.json` — server-local, `0600`, never in the repo, which
is also where its access token sits.

Not OneCLI, because the server authenticates against the Supabase management API
with its own client that ignores `HTTPS_PROXY` under Node 22, so the gateway
cannot inject into it.

**Caveat worth remembering:** `--read-only` is enforced by the MCP server, not by
the token. The token itself is account-wide management API access, so a leak is
not limited to reading. Treat the `container.json` files as credential files.

The durable domain vocabulary the bot needs for those queries lives in each
group's `CLAUDE.local.md`; the schema itself is not hardcoded anywhere — the bot
introspects it live so it cannot drift. The same vocabulary is written up in the
luno repo under `docs/tech/database.md`, "Domain semantics".

## Server-side state that's NOT in the repo (recreate on fresh install)

| | Where | Purpose |
|---|---|---|
| `~/.ssh/luno_deploy_key`, `~/.ssh/luno_deploy_key.pub`, `~/.ssh/config` (Host `github-luno`) | nanoclaw user | SSH deploy key for the luno repo. Public key registered as deploy key on `lunoapp/luno`. |
| `~/luno` git clone (`github-luno:lunoapp/luno`) | nanoclaw home | Mounted into containers as `/workspace/extra/luno/`. Kept current by `/etc/cron.d/luno-repo-pull` — daily 04:15, `git pull --ff-only` as `nanoclaw`, logged to syslog under tag `luno-pull`. |
| `~/.config/nanoclaw/mount-allowlist.json` | nanoclaw config | Allows `/home/nanoclaw/luno` mount. |
| `~/.local/bin/pnpm`, PATH update in `~/.bashrc` | nanoclaw user-local | pnpm without sudo. Install: `npm config set prefix ~/.local && npm install -g pnpm@<pinned>`. The first install leaves `.pnpm-XXX` symlinks instead of a `pnpm` one — fix with `ln -sf ~/.local/lib/node_modules/pnpm/bin/pnpm.cjs ~/.local/bin/pnpm`. |
| `loginctl enable-linger nanoclaw` (as root) | systemd | Keeps user systemd alive without active login. |
| systemd unit `nanoclaw-v2-1e478a5f` | `~/.config/systemd/user/` | Generated by `pnpm exec tsx setup/index.ts --step service`. |
| `.env` | project root | Channel tokens, OneCLI config, `WHISPER_*` paths, `GITHUB_APP_*`. |
| `~/agent-keys/github-app.pem` | nanoclaw home | **Required** — the GitHub App private key, `0600`. The host mints installation tokens from it on every spawn (see "Integrations wired per group"). Without it the GitHub tool silently stays off. |
| Whisper binary + model | `/usr/local/bin/whisper-cli`, `/home/nanoclaw/nanoclaw/data/models/ggml-base.bin` | Built from whisper.cpp source. See `.claude/skills/add-voice-transcription/SKILL.md`. |
| `data/v2.db`, `data/v2-sessions/`, `groups/` | project root | Runtime state. Backed up via `~/backups/pre-v2-*` snapshots. |
| OneCLI agents in `mode=all` | OneCLI vault on server | Each agent group's OneCLI agent record must be `secretMode=all` so matching secrets and app connections auto-inject. Set via root: `onecli agents set-secret-mode --id <agent-id> --mode all`. Look up agent IDs via `onecli agents list`. |
| OneCLI Apps connected | OneCLI Web UI on server (`127.0.0.1:10254`) | Google Drive / Docs / Sheets connected via Apps Framework as `hallo@hiluno.com` with own developer credentials (GCP OAuth Client, Desktop type). Reach the Web UI from a workstation via SSH tunnel: `ssh -L 10254:127.0.0.1:10254 <host>` then browse `http://localhost:10254`. |
| Google Docs MCP stubs | `~/.config/google-docs-mcp/token.json` on server (mode 600) | Stub file with `"onecli-managed"` placeholders; gateway swaps real Bearer at request time. See `.claude/skills/add-google-docs-mcp/SKILL.md` for the file shape. |
| Coolify `docker_cleanup_threshold=85` | coolify-db `server_settings` | 85% gives buffer for normal deploys without notification spam, while `skill/image-self-heal` ensures nanoclaw's agent image self-rebuilds on the next spawn if Coolify's buggy label-check deletes it (~30s once-off latency). SQL: `UPDATE server_settings SET docker_cleanup_threshold=85 WHERE server_id=0;` |
| systemd timer `docker-builder-prune.timer` | `/etc/systemd/system/` | Weekly `docker builder prune -af` (Sundays 03:00 UTC) keeps BuildKit cache from accumulating GBs. See server install for unit + timer files. |

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
| `skill/image-self-heal` | Auto-rebuild missing agent image at spawn | Forever (re-merge target) |
