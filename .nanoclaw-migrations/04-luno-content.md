# 04 — luno content (skills, group memory, docs, assets)

This section covers user-content that's copied verbatim — no code adaptation needed.

---

## C16. luno-eigene Skills

**Action:** `cp -r` von v1 nach v2-Worktree, ins `.claude/skills/`-Verzeichnis (oder dem v2-Pendant — v2 main hat `.claude/skills/` unverändert).

| Skill path | Purpose |
|---|---|
| `.claude/skills/write-luno/` | Social-Media-Content für luno (Instagram/LinkedIn) — Brand-Voice, Content-Pillars, Beispiele. Tied to luno persona. |
| `.claude/skills/log-post/` | Posts ins Marketing-Logbuch (Teable) loggen. Zwei Tabellen: Themen + Posts. **Enthält hardcoded Teable-Tabellen-IDs** — mit migriere als-is. |
| `.claude/skills/generate-image/` | Marketing-Images via Replicate (FLUX Schnell + Real-ESRGAN). Brand-Guidelines, Format-Spezifikationen. |

**Verification:** Nach Copy `ls .claude/skills/{write-luno,log-post,generate-image}/SKILL.md` zeigt alle drei.

---

## C17. groups/global/CLAUDE.md (Lubo-Persona)

**File:** `groups/global/CLAUDE.md` — 241 Zeilen.

**Intent:** Persistent agent memory/persona für **alle Gruppen** (system prompt append). Definiert "Lubo" als luno's AI-Assistent (Olli Schulz + Loriot Tone), liefert Produkt/Markt-Kontext, dokumentiert CRM-Setup (Teable), Channel-Formatting-Regeln, luno-Skills-Verweise.

**Action:** **1:1 kopieren** — keine Adaption nötig. v2 lädt `groups/global/CLAUDE.md` automatisch (in v2's CLAUDE.md-Hierarchie ist `/workspace/global/CLAUDE.md` Standard).

**Critical hardcoded data (must preserve verbatim):**

| Wert | Wo | Zweck |
|---|---|---|
| `tblh77SllVYtjIYSDsy` | Teable Themen-Tabellen-ID | Themen-Tabelle in Marketing-Logbuch |
| `tblgkzS2CqdPZSX7Ary` | Teable Posts-Tabellen-ID | Posts-Tabelle |
| `bseCNT001` | Teable Content Base ID | Content Base |
| `bseCRM001` / `tblxjB7THMQtehfBbsc` | Teable Studios CRM Base/Tabelle | Studios CRM |
| `https://hub.hiluno.com/api` | Teable API Base URL | API endpoint |
| `hiluno.com` / `@hi.luno` | luno Web/Instagram | Brand-Refs |
| `#F7F7F5` (Loft), `#3C4F4A` (Studio), `#B4856C` (Brass), `#2E2E2C` (Ink) | Studio Design-Farben | Brand-Colors für Bild-Generation |
| `Plus Jakarta Sans` | Brand Font | Typography |

**Verification:** `wc -l groups/global/CLAUDE.md` ergibt 241. Stichprobe: `grep tblh77SllVYtjIYSDsy groups/global/CLAUDE.md` matched.

---

## C18. .mcp.json (Coolify MCP server)

**File:** `.mcp.json`

**Intent:** Lokales MCP-Server-Setup (Claude Code in dieser Repo) — Coolify-MCP für Hetzner-VPS-Verwaltung.

**Action:** 1:1 kopieren. Inhalt:

```json
{
  "mcpServers": {
    "coolify": {
      "command": "npx",
      "args": ["-y", "@masonator/coolify-mcp"],
      "env": {
        "COOLIFY_ACCESS_TOKEN": "${LUNO_COOLIFY_ACCESS_TOKEN}",
        "COOLIFY_BASE_URL": "${LUNO_COOLIFY_BASE_URL}"
      }
    }
  }
}
```

**Note:** Nur für Claude Code in der Repo, nicht für den Bot selbst. Env vars `LUNO_COOLIFY_*` müssen lokal gesetzt sein (entweder in `.env` oder shell).

---

## C19. Documentation (docs/)

Zwei Gruppen:

### Local-only (1:1 kopieren — gibt's in v2 main nicht)

| File | Purpose |
|---|---|
| `docs/concept.md` | Lunobot Vision, Architektur, Use Cases (Marketing CRM, Organization), Phasen, Brand-Voice |
| `docs/CUSTOMIZATION-STRATEGY.md` | Fork-Maintenance-Strategie, OneCLI-Setup-Notes, CLAUDE.md-Hierarchie |
| `docs/DEPLOYMENT.md` | Hetzner CX23 Setup, systemd, Coolify Services, OneCLI Vault, Network, Credentials |
| `docs/DEBUG_CHECKLIST.md` | Debug-Checkliste |
| `docs/telegram-media.md` | Voice-Transcription + Image-Vision Architektur (warum auf Host, Dependencies, Implementation-Details) |
| `docs/TODO.md` | Backlog, Ideen, completed items |
| `docs/research/architecture-comparison.md` | OpenClaw vs NanoClaw Eval |
| `docs/research/integrations.md` | Telegram Bot API vs MTProto, grammY-Begründung |
| `docs/research/secrets-management.md` | OneCLI-Begründung |
| `docs/research/security.md` | Security-Notes (Telegram nicht E2E etc.) |
| `docs/council/docker-image-persistence/` | Multi-LLM Council Research (4 files) |

### Locally-modified upstream docs (drop unsere Mods, v2-Version übernehmen)

`docs/BRANCH-FORK-MAINTENANCE.md`, `docs/docker-sandboxes.md`, `docs/README.md`, `docs/SECURITY.md`, `docs/SPEC.md` — wurden lokal angepasst, aber für v2 nehmen wir die v2-main-Version. Falls dort noch was Wertvolles drin steckt: vor Drop einmal `git diff upstream/main -- docs/<file>` durchgehen.

**Verification:** `find docs -type f` und Vergleich mit Source-Liste oben.

---

## C20. assets/

**Action:** 1:1 kopieren.

| File | Purpose |
|---|---|
| `assets/avatar-luno-dev.png` (19 KB) | Lubo dev avatar |
| `assets/avatar-luno-dev.svg` (3 KB) | Vector |
| `assets/avatar-lunobot.png` (54 KB) | Lubo prod avatar |
| `assets/avatar-lunobot.svg` (3 KB) | Vector |

---

## C21. Config files (small additions)

| File | Custom changes |
|---|---|
| `.gitignore` | luno-spezifische Einträge: `groups/*` (außer global+CLAUDE.md), `store/`, `data/`, `logs/`, `.nanoclaw/`, `.claude/settings.local.json`. **Action:** v2's `.gitignore` als Basis nehmen, unsere Einträge hinzufügen falls nicht schon drin. |
| `.tool-versions` | `nodejs 22.18.0`. **Action:** prüfen welche v2 nutzt — falls Node 22 weiterhin OK, lassen. v2 nutzt evtl. lts (siehe upstream commit `948a0dc fix: use nodeenv lts instead of pinned node 22`). |
| `.env.example` | minimal, nur `OLLAMA_HOST=`. **Action:** v2's `.env.example` nehmen, `OLLAMA_HOST` weglassen (kein Ollama). Whisper-Vars hinzufügen: `WHISPER_BIN=`, `WHISPER_MODEL=`, `WHISPER_LANGUAGE=de`, plus `GITHUB_APP_ID=`, `GITHUB_APP_INSTALLATION_ID=`. |
| `setup/verify.ts` | Prüft Service, Container-Runtime, Credentials, Channels, Groups. **Action:** v2 hat eigene `setup/verify.ts`. Custom-Diff prüfen — wahrscheinlich `git status` saubere Übernahme von v2. |
| `package.json` | Wichtige zusätzliche deps: `sharp@^0.34.5` (für image.ts). Andere (`grammy/files`, `@onecli-sh/sdk`, `pino`, `zod`, `cron-parser`, `better-sqlite3`, `yaml`) sind in v2 main bereits enthalten oder werden über v2 abgedeckt. **Action:** v2's package.json + nur sharp ergänzen. |
