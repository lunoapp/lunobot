# Integration Options

Research date: 2026-03-20

## Telegram Bot API

### Bot API vs MTProto

- **Bot API:** HTTP-based, simpler, sufficient for 99% of bot use cases. Supports webhooks and long polling.
- **MTProto:** Telegram's native protocol, needed only for user-account bots (ToS gray area). Overkill.
- **Decision:** Bot API.

### Library: grammY

- **Repo:** https://github.com/grammyjs/grammY (~14k stars)
- **Docs:** https://grammy.dev/
- First-class TypeScript support
- Best documentation of any Telegram bot framework
- Rich plugin ecosystem (sessions, menus, conversations, rate limiting)
- Runs on Node.js, Deno, Cloudflare Workers
- Active community with dedicated Telegram support chat
- Clear winner over Telegraf (aging, lags behind Bot API) and node-telegram-bot-api (minimal maintenance)

### Webhook vs Polling

- **Polling** (`bot.start()`): Simple, great for dev.
- **Webhooks** (`bot.api.setWebhook(url)`): Production-grade, bot can sleep when idle.
- **Plan:** Polling for dev, webhooks for production on Hetzner VPS.

### Key Features for Lunobot

- Inline keyboards (approval flows: "Post this? Yes / No / Edit")
- Commands (`/status`, `/leads`, `/content`)
- File handling (images for social media posts)
- Conversation plugin (multi-step flows like content creation wizards)
- Session plugin (per-user persistent state)

---

## Instagram Graph API

- **Docs:** https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Supports programmatic posting to **Business** accounts (not Creator)
- **Requirements:** Facebook Business Page linked to Instagram Business account, Facebook App with `instagram_content_publish` permission
- **Limits:** 100 published posts per 24 hours
- **Formats:** Images (JPEG, <8MB), videos, carousels, Reels, Stories
- **Not supported:** Instagram TV, Live, shopping tags, filters
- **Flow:** Upload media to publicly accessible URL → Create container → Publish

### luno-specific

- Account: Instagram @hi.luno (Business account needed)
- Media storage: Supabase Storage (already in use for matspace) or a public URL

---

## LinkedIn API

- **Community Management API:** Posting to personal profiles and company pages
- **Access requirement:** Must be a legally registered entity (LLC, Corp, etc.)
- **Alternative:** Basic Share API with simpler OAuth2 scopes for personal profile posting
- **Docs:** https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api

### luno-specific

- Posts go to Jan's personal LinkedIn profile
- Need to check if basic Share API is sufficient (avoids entity requirement)

---

## Teable CRM

- **Docs:** https://help.teable.ai/en/api-doc/overview
- Full REST API: CRUD on records, tables, fields, views
- **Auth:** Personal Access Tokens (ideal for bot) or OAuth2
- **Webhooks:** Supports outgoing webhooks for triggers
- **Existing MCP server:** https://lobehub.com/mcp/ltphat2204-teable-mcp-server (can configure with `TEABLE_API_KEY` and `TEABLE_BASE_URL`)

### luno-specific tables (on hub.hiluno.com)

| Table | ID | Base | Purpose |
|-------|-----|------|---------|
| Content (Marketing-Logbuch) | `tblh77SllVYtjIYSDsy` | `bseCNT001` | All social media posts |
| Studios (CRM) | `tblxjB7THMQtehfBbsc` | `bseCRM001` | Outreach pipeline |

### Bot use cases

- **CRM:** "Welche Leads sind offen?" → Query Studios table, filter by status
- **Content:** "Was haben wir diese Woche gepostet?" → Query Content table
- **Proactive:** Scheduled check → "3 Leads seit 5 Tagen nicht kontaktiert, soll ich Vorlagen erstellen?"
- **Logging:** After posting → Auto-update Content table with post details

---

## Email (Resend)

- Already used in matspace for transactional emails
- Could be used for CRM outreach emails drafted by the bot
- React Email templates for consistent formatting

---

## Potential Future Integrations

| Integration | Purpose | Priority |
|-------------|---------|----------|
| Google Calendar | Content calendar sync, reminders | Medium |
| Canva API | Image generation/editing for posts | Low |
| Replicate (FLUX) | AI image generation (already have `/generate-image` skill) | Medium |
| Google Drive | Access to luno Marketing/Business docs | Low |
