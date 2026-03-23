# Lubo — Backlog

## Geplant

- [ ] Agent Swarm (mehrere Bot-Persönlichkeiten im Team)
- [ ] Deploy-Script (ein Befehl für git pull + build + restart auf Server)

## Ideen

- [ ] WhatsApp-Kanal (falls später gewünscht)
- [ ] Scheduled Tasks (proaktive Erinnerungen, CRM-Checks)
- [ ] MCP-Server Anbindungen (Pipedrive, GitHub)
- [ ] Google Drive: Migration zu Service Account (aktuell OAuth Refresh Token)

## Technical Debt

- [ ] Google OAuth Refresh Token kann langfristig ablaufen — Service Account wäre robuster, braucht aber Google Workspace
- [ ] Shared Skills zwischen luno-Projekt und lunobot (aktuell kopiert, nicht synchronisiert)
- [ ] matspace → luno Umbenennung im luno-Projekt (generate-image Skill referenziert noch alten Memory-Pfad)

## Erledigt (2026-03-23)

- [x] Telegram Bot Setup (`@hiluno_bot`)
- [x] Telegram Gruppe "luno" + Direktchat "Jan" registriert
- [x] Teable API-Zugriff (CF Access + Token)
- [x] Lubos Persönlichkeit + CLAUDE.md (Olli Schulz + Loriot)
- [x] Image Vision — Bilder empfangen und multimodal an Claude
- [x] Voice Transcription — lokaler whisper.cpp (base + medium Modell)
- [x] Bilder senden via `send_image` MCP-Tool + Telegram `sendPhoto`
- [x] Bilder generieren via Replicate FLUX + Real-ESRGAN
- [x] Google Docs MCP-Server (@a-bonus/google-docs-mcp via OAuth Refresh Token)
- [x] luno Marketing-Skills (generate-image, log-post, write-luno)
- [x] Server-Deployment (Hetzner CX23, systemd, 24/7)
- [x] Security-Hardening (Credential Proxy, Netzwerk-Isolation, Shell-Injection Fix)
- [x] Container Env → Credentials File (nicht mehr in docker inspect sichtbar)
- [x] Global CLAUDE.md Fix für Main-Gruppen
- [x] matspace → luno Umbenennung (Verzeichnisse, Docs, CLAUDE.md, Keychain)
- [x] Replicate API Token durchgereicht
- [x] Container Env Passthrough Mechanismus gebaut
- [x] WhatsApp entfernt (instabil, nicht benötigt)
- [x] imagemagick im Container-Image
- [x] IPC Pfad-Übersetzung für send_image (Container → Host)
