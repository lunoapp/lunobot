# Lunobot — NanoClaw v1 → v2 Migration Guide

**Generated:** 2026-05-08
**Base (merge-base):** `934f063aff5c30e7b49ce58b53b41901d3472a3e`
**HEAD at generation:** `1c71bedce2874100523b31200254efa5b4c8db5b`
**Upstream HEAD:** `6e9f35a646ad0042b5b3fdef8bc9a7718229ae04`
**Backup tag:** `pre-migrate-1c71bed-20260508-105519`
**Backup branch:** `backup/pre-migrate-1c71bed-20260508-105519`

## Context

Lunobot is a fork of NanoClaw (`upstream/main` = qwibitai/nanoclaw). Local fork is 173 commits ahead of merge-base. Upstream is 807 commits ahead and underwent a complete v2 architectural rewrite (provider interface, Chat-SDK channel adapters, SQLite-based inbound/outbound IPC, OneCLI gateway as static skill). A merge-based update would conflict in every core file. This guide drives an intent-based re-application instead.

The bot runs **only** on a Linux server (Hetzner) with **Docker only** — no Apple-Container. All apple-container-related customizations from v1 are dropped, not migrated.

## Migration Plan (Tier 3)

### Order of operations

1. Worktree on `upstream/main`.
2. Copy luno user content (skills, group memory, .mcp.json, docs, assets).
3. Reapply functional customizations to source + container.
4. Build + tests in worktree.
5. Local commit on main via `git reset --hard` to worktree commit.
6. Server: snapshot data, stop service, pull, run `migrate-v2.sh` for v1→v2 data conversion, rebuild container, start service, send Telegram test.

### Staging

- **Stage A (lokal, code-only):** worktree → reapply → npm test → main reset. No service touched yet.
- **Stage B (server, data + deploy):** snapshot → stop → pull → migrate-v2.sh → rebuild → start → verify.

### Risk areas

- **`/workspace/ipc/*` → `inbound.db` / `outbound.db`:** Strukturwechsel. `migrate-v2.sh` erledigt das, läuft destruktiv auf v1-Format. Server-Snapshot vorher zwingend.
- **`src/session-commands.ts` /compact handler:** v2 hat zentralen Host-Router; unser Inline-Intercept muss in v2 anders verdrahtet werden (siehe 02-source-customizations.md).
- **`src/image.ts` Bind:** v2 nutzt Chat-SDK-Adapter mit File-Discovery via `additionalDirectories`; unser Param-basierter Pfad (`imageAttachments` in ContainerInput) braucht Adapter-Hooks statt Param-Pipeline.
- **OneCLI auf Server:** v2 erwartet OneCLI als statisches Gateway-Skill. Server-OneCLI-Config muss kompatibel sein.

### Skill Interactions

Wir mergen keine `skill/*`-Branches mehr — alle dropped. v2 hat ihre Funktionalität nativ oder via opt-in Container-Skills. Keine Inter-Skill-Konflikte zu erwarten.

## Sections

- [01 — Applied skills (status: alle gedropped)](01-applied-skills.md)
- [02 — Source customizations (`src/`)](02-source-customizations.md)
- [03 — Container customizations](03-container-customizations.md)
- [04 — luno content (skills, group memory, docs, assets)](04-luno-content.md)
- [05 — Server deploy + Datenmigration](05-server-deploy.md)
