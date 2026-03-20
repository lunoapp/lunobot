# Security & Privacy

Research date: 2026-03-20

## Telegram Encryption

- **Bot conversations are NOT end-to-end encrypted.** Only "Secret Chats" between users support E2E, and bots cannot participate.
- Message path: User → Telegram servers (HTTPS) → Webhook endpoint (HTTPS)
- Telegram stores bot messages on their servers
- Telegram's legal HQ: Dubai. EU data storage: Netherlands.

**Practical rule:** Telegram is the transport layer, not the security layer. Never send API keys, passwords, or highly sensitive business data through the bot.

## Data Flow

```
What's on Telegram servers:
  → Message text between team and bot (not E2E encrypted)

What's on Hetzner VPS (our infrastructure):
  → Bot logic, memory, tool results, API keys, SQLite

What goes to Anthropic:
  → Conversation context sent to Claude API
  → Covered by Anthropic's data policy (no training on API data)

What stays in Teable (our infrastructure):
  → CRM data, content calendar, marketing logs
```

## NanoClaw Container Isolation

- Each agent runs in its own Docker container (or Apple Container on macOS)
- Unprivileged user inside container
- Sensitive paths blocked: `.ssh`, `.gnupg`, `.aws`, `.env`, `credentials`
- Mount allowlist at `~/.config/nanoclaw/mount-allowlist.json` (outside project dir, so agent can't modify its own permissions)
- Host application code: mounted read-only

## Self-Hosting Strategy (Hetzner VPS)

1. **Bot application:** Docker container on Hetzner VPS (Germany, EU)
2. **Claude API calls:** Direct from VPS to api.anthropic.com (data in transit only)
3. **Memory/state:** Local SQLite + filesystem on VPS. Never leaves server.
4. **API keys:** Environment variables via Docker secrets or Coolify env management
5. **Webhook HTTPS:** Let's Encrypt via Caddy or Coolify's built-in SSL
6. **Container isolation:** NanoClaw's built-in Docker isolation

## GDPR Considerations

- Telegram itself is problematic for GDPR (no DPA, Dubai jurisdiction)
- **Mitigations:**
  - Only used by 2-person internal team (no external user data flows through bot)
  - Minimal data on Telegram's side (just message text)
  - All business data (CRM, content) in self-hosted Teable/PostgreSQL
  - Bot is UI layer; sensitive data lives on our infrastructure
- **Risk assessment:** Minimal, since this is an internal team tool with no customer-facing data

## API Key Management

| Key | Storage | Rotation |
|-----|---------|----------|
| Anthropic API key | Coolify env vars | As needed |
| Telegram Bot Token | Coolify env vars | Via BotFather |
| Teable Personal Access Token | Coolify env vars | Via Teable settings |
| Instagram Graph API Token | Coolify env vars | 60-day expiry, auto-refresh via long-lived token |
| LinkedIn OAuth Token | Coolify env vars | Refresh token flow |

## Approval Flow (to be built)

For outbound actions (posting, emailing leads), the bot MUST ask for confirmation:

```
Bot: "Soll ich das auf Instagram posten?"
     [Bild-Preview]
     [Ja, posten] [Bearbeiten] [Verwerfen]

User: [Ja, posten]

Bot: "Gepostet! Ins Marketing-Logbuch eingetragen."
```

This is the primary safety mechanism beyond container isolation. No autonomous outbound actions in Phase 1.
