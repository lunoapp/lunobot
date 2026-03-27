# Deployment & Infrastructure

## Server

| | |
|---|---|
| **Provider** | Hetzner VPS CX23 (Germany) |
| **IP** | 46.224.6.180 |
| **SSH** | `ssh luno` (alias in ~/.ssh/config, user: root) |
| **NanoClaw user** | `nanoclaw` (systemd user service) |
| **NanoClaw path** | `/home/nanoclaw/nanoclaw` |

## Services

### NanoClaw (Host Process)

NanoClaw läuft als systemd user service, nicht in Coolify/Docker.

```bash
# Status
sudo -u nanoclaw XDG_RUNTIME_DIR=/run/user/$(id -u nanoclaw) systemctl --user status nanoclaw

# Restart
sudo -u nanoclaw XDG_RUNTIME_DIR=/run/user/$(id -u nanoclaw) systemctl --user restart nanoclaw

# Logs
sudo -u nanoclaw bash -c 'tail -50 /home/nanoclaw/nanoclaw/logs/nanoclaw.log'
```

### Coolify (PaaS)

- **URL:** coolify.hiluno.com (hinter Cloudflare Zero Trust)
- **Zugang:** SSH-Tunnel (`ssh -f -N -L 8000:localhost:8000 luno`) + MCP Server
- **Services in Coolify:**
  - `cloudflared` — Cloudflare Tunnel für alle Web-Services
  - `teable` — CRM/Marketing auf hub.hiluno.com
  - `onecli` — OneCLI Agent Vault (Credential-Management)

### OneCLI Agent Vault

Deployed via Coolify als docker-compose Service (Postgres + App).

| | |
|---|---|
| **Dashboard** | http://127.0.0.1:10254 (nur via SSH-Tunnel) |
| **Gateway** | Port 10255 (transparent, für Container-Agent-Traffic) |
| **Coolify UUID** | `aqindq1eq4o81wzb9mfkqcs6` |
| **Secrets** | Anthropic OAuth-Token (aus .env migriert) |

NanoClaw nutzt `@onecli-sh/sdk` um Container-Args zu konfigurieren. OneCLI injiziert API-Credentials transparent in HTTPS-Traffic der Agent-Container.

```bash
# OneCLI CLI auf dem Server
onecli secrets list
onecli agents list
```

## Netzwerk-Architektur

```
Internet → Cloudflare (HTTPS + Zero Trust) → Tunnel → Hetzner Server
                                                         ├── Traefik :80/:443 (Coolify Proxy)
                                                         │   ├── teable → hub.hiluno.com
                                                         │   └── coolify → coolify.hiluno.com
                                                         ├── NanoClaw (Host, Port nicht exponiert)
                                                         │   └── spawnt Docker-Container (Agents)
                                                         │       └── OneCLI Gateway :10254/:10255
                                                         └── Cloudflared (Tunnel-Client)
```

## Channels

| Channel | Status | Bot |
|---------|--------|-----|
| Telegram | Aktiv | @hiluno_bot |
| WhatsApp | Deaktiviert (war kurzes Experiment) | - |

## Deployment-Workflow

```bash
# 1. Lokal: Änderungen committen und pushen
git push origin main

# 2. Server: Pull + Build + Restart
ssh luno "sudo -u nanoclaw bash -c 'cd /home/nanoclaw/nanoclaw && git pull origin main && npm install && npm run build'"
ssh luno "sudo -u nanoclaw XDG_RUNTIME_DIR=/run/user/\$(id -u nanoclaw) systemctl --user restart nanoclaw"

# 3. Container-Image rebuilden (nur wenn container/ geändert)
ssh luno "sudo -u nanoclaw bash -c 'cd /home/nanoclaw/nanoclaw && bash container/build.sh'"
```

## Credentials (.env auf Server)

| Variable | Zweck | Managed by |
|----------|-------|------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Anthropic API | OneCLI (migriert) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot | .env (Host-Prozess) |
| `ASSISTANT_NAME` | Bot-Name | .env |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access für Teable | .env |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access für Teable | .env |
| `TEABLE_ACCESS_TOKEN` | Teable API | .env |
| `REPLICATE_API_TOKEN` | Replicate (Bildgenerierung) | .env |
| `WHISPER_MODEL` | Whisper Modell-Pfad | .env |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Docs MCP | .env |
| `ONECLI_URL` | OneCLI Gateway URL | .env |

## CLAUDE.md Hierarchie

```
groups/
├── global/CLAUDE.md       ← Persönlichkeit + luno-Kontext (alle Gruppen, systemPrompt append)
├── main/CLAUDE.md         ← Upstream NanoClaw Docs (nur main-Gruppe)
├── telegram_jan/CLAUDE.md ← Minimal "Jan (privat)" (nur auf Server, nicht in Git)
└── telegram_main/CLAUDE.md ← Minimal "luno Gruppe"
```

- **global/CLAUDE.md** wird als System-Prompt-Anhang in ALLE Container injiziert
- **{group}/CLAUDE.md** wird als primäre CLAUDE.md im Working Directory geladen
- Gruppen-CLAUDE.md sollte minimal sein, damit global/ den Ton angibt

## Upstream-Updates

Upstream: `git@github.com:qwibitai/nanoclaw.git` (remote: `upstream`)

```bash
# Monatlich: Upstream mergen
git fetch upstream main
# Dann /update-nanoclaw Skill nutzen
```

Siehe [CUSTOMIZATION-STRATEGY.md](CUSTOMIZATION-STRATEGY.md) für Details zu unseren Fork-Anpassungen.
