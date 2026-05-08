# 05 — Server deploy + data migration

After local migration succeeds (Stage A done, code on `main`), deploy to Hetzner server (Stage B).

## Pre-deploy checklist

- [ ] Local `npm run build && npm test` green
- [ ] Local commit on `main` (post worktree-reset)
- [ ] Local pushed to `origin/main`
- [ ] Backup tag exists: `pre-migrate-1c71bed-20260508-105519`
- [ ] **Server-side snapshot taken** (siehe unten — kritisch!)

## Server snapshot (vor jeglichen Aktionen)

SSH zum Server, dann:

```bash
# Service stop
systemctl --user stop nanoclaw

# Snapshot der Daten-Verzeichnisse
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p ~/backups/pre-v2-$TIMESTAMP
cp -r ~/lunobot/groups ~/backups/pre-v2-$TIMESTAMP/
cp -r ~/lunobot/data ~/backups/pre-v2-$TIMESTAMP/
cp -r ~/lunobot/store ~/backups/pre-v2-$TIMESTAMP/ 2>/dev/null || true
cp ~/lunobot/.env ~/backups/pre-v2-$TIMESTAMP/.env

# Verify snapshot
du -sh ~/backups/pre-v2-$TIMESTAMP
ls -la ~/backups/pre-v2-$TIMESTAMP/
```

Außerdem **OneCLI-Vault-Snapshot** (falls OneCLI-Daten persistent gehalten werden — Pfad je nach OneCLI-Install).

## Deploy steps

```bash
cd ~/lunobot

# Pull v2 code
git fetch origin
git reset --hard origin/main

# Install deps (v2 uses pnpm workspace if applicable — check v2's docs)
npm install
# or: pnpm install (falls v2 auf pnpm umgestellt hat)

# Container Image neu bauen
bash container/build.sh

# v1 → v2 Datenmigration
bash scripts/migrate-v2.sh
# (oder wo immer migrate-v2.sh in v2 main liegt — vor Ausführung Pfad verifizieren:
#  find . -name 'migrate-v2.sh' -type f)
```

**Wichtig zur `migrate-v2.sh`:**
- Liest `/workspace/ipc/*` Files und `current_tasks.json` aus `groups/*/`
- Schreibt sie in `inbound.db` / `outbound.db`
- **Destruktiv für v1-Format** — Snapshot vorher zwingend
- Erwartet interactive terminal (laut upstream commit `6a05e41`)
- Health-Check über `/api/health` Endpoint (commit `4d5af78`)

## Post-deploy verify

```bash
# Service starten
systemctl --user start nanoclaw

# Live logs
journalctl --user -u nanoclaw -f
```

**Test message via Telegram:**
- Trigger word an Bot schicken (z.B. `@Lubo ping`)
- Erwartet: Antwort innerhalb ~5-10 sec (Container-Spawn + LLM-Call)

**Falls Voice-Transcription getestet werden soll:**
- Voice-Message an Telegram-Bot
- Erwartet: Bot empfängt, whisper-cli transkribiert, Antwort referenziert den Inhalt

**Falls Image-Vision getestet werden soll:**
- Photo + Caption an Telegram-Bot
- Erwartet: Bot beschreibt das Bild

## Rollback procedure

Falls irgendwas schiefgeht — atomarer Rollback (auf Server):

```bash
# Stop
systemctl --user stop nanoclaw

# Code rollback (lokal: git reset to backup tag, push -f to origin, dann auf Server pull)
# Auf Server direkt:
cd ~/lunobot
git fetch origin
git reset --hard <vorheriger-server-commit-hash>

# Daten rollback aus Snapshot
TIMESTAMP=<wert aus snapshot-step>
rm -rf ~/lunobot/groups ~/lunobot/data ~/lunobot/store
cp -r ~/backups/pre-v2-$TIMESTAMP/groups ~/lunobot/
cp -r ~/lunobot/backups/pre-v2-$TIMESTAMP/data ~/lunobot/
cp -r ~/lunobot/backups/pre-v2-$TIMESTAMP/store ~/lunobot/ 2>/dev/null || true

# Container Image rebuild auf altem Code
bash container/build.sh

# Service starten
systemctl --user start nanoclaw
```

**Lokal Rollback** (falls Stage A fehlschlägt, vor Deploy):

```bash
git reset --hard pre-migrate-1c71bed-20260508-105519
# oder
git reset --hard backup/pre-migrate-1c71bed-20260508-105519
```

## Server credentials checklist

Auf dem Server müssen folgende Files existieren (vor Deploy verifizieren):

- [ ] `~/credentials/google-service-account.json` (Google Service Account JSON, mode 0600)
- [ ] `~/credentials/github-app.pem` (GitHub App Private Key PEM, mode 0600)
- [ ] `~/lunobot/data/models/ggml-base.bin` (Whisper Modell)
- [ ] `whisper-cli` binary in `$PATH` (oder `WHISPER_BIN` env in `.env`)
- [ ] `ffmpeg` installed (`apt install ffmpeg`)
- [ ] `~/lunobot/.env` enthält: `TELEGRAM_BOT_TOKEN`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, OneCLI-Konfig (siehe v2 docs für genaue Vars), `WHISPER_LANGUAGE=de`, plus optionale luno-Marketing-Vars (`LUNO_COOLIFY_*`, etc.)

## OneCLI compatibility

v2 erwartet OneCLI als statisches Container-Skill (`container/skills/onecli-gateway/`). Der laufende OneCLI-Vault auf dem Server bleibt — nur die Container-Side wird durchs neue Skill ersetzt. Vor Deploy einmal sicherstellen:

```bash
# OneCLI-Vault Status checken
onecli status   # oder onecli health
# Beide möglich — siehe onecli --help

# v2 erwartet Health-Endpoint /api/health
curl -s http://localhost:10254/api/health
```

Falls Endpoint anders antwortet als erwartet, OneCLI ggf. erst auf v2-kompatible Version upgraden bevor Bot-Deploy.
