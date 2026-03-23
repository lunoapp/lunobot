# Lunobot (lubo) — Concept

## Vision

AI-gesteuerter Team-Assistent für luno, erreichbar über Telegram. Unterstützt Jan und Nicole bei Marketing, CRM, Organisation und proaktiven Erinnerungen.

## Architektur

```
Telegram (Jan & Nicole)
    ↓
NanoClaw (Fork, Hetzner VPS via Coolify)
    ├── Claude Agent SDK (AI-Reasoning + Tool Use)
    ├── Memory (per-group CLAUDE.md, SQLite)
    ├── Scheduler (Cron/Interval Tasks)
    └── MCP Tools:
        ├── Teable CRM (Studios-Pipeline)
        ├── Teable Content (Marketing-Logbuch)
        ├── Instagram Graph API
        ├── LinkedIn Share API
        └── (Future: Google Calendar, Replicate/FLUX)
```

## Use Cases

### Marketing

| Use Case | Beispiel |
|----------|----------|
| Content draften | "Schreib einen Instagram-Post zum Thema faire Preisgestaltung" |
| Post reviewen | Bot zeigt Draft → Inline-Keyboard: Posten / Bearbeiten / Verwerfen |
| Post veröffentlichen | Bot postet auf Instagram/LinkedIn nach Approval |
| Post loggen | Bot trägt veröffentlichten Post ins Marketing-Logbuch (Teable) ein |
| Content-Kalender | "Was steht diese Woche an?" → Query Content-Tabelle |
| Content-Ideen | "Gib mir 3 Post-Ideen zur Content-Säule Build-in-Public" |

### CRM

| Use Case | Beispiel |
|----------|----------|
| Lead-Status | "Welche Studios sind offen?" → Query CRM-Tabelle |
| Outreach-Vorlagen | "Erstell eine Kontakt-Mail für Yoga-Studio XY" |
| Proaktive Reminder | Scheduled: "3 Leads seit 5 Tagen nicht kontaktiert — soll ich Vorlagen erstellen?" |
| Status-Update | "Markier Studio XY als kontaktiert" → Update CRM-Tabelle |

### Organisation

| Use Case | Beispiel |
|----------|----------|
| Tages-Briefing | Scheduled (morgens): "Heute: 2 Leads anschreiben, 1 Post geplant, Feature X fertig" |
| Quick-Infos | "Wie viele Studios haben wir insgesamt kontaktiert?" |
| Reminder setzen | "Erinner mich Freitag an den Blog-Post" |

## Phasenplan

### Phase 1: Core Bot

- NanoClaw forken und Telegram-Channel einrichten
- System-Prompt mit luno-Kontext und Brand Voice
- Teable MCP Server anbinden (CRM + Content)
- Approval-Flow für ausgehende Actions (Inline-Keyboards)
- Deploy auf Hetzner via Coolify

**Ergebnis:** Bot kann CRM abfragen, Content draften, und Aktionen nach Approval ausführen.

### Phase 2: Social Media Publishing

- Instagram Graph API Tool
- LinkedIn Share API Tool
- Post-Preview mit Bild in Telegram
- Auto-Logging ins Marketing-Logbuch nach Publish

**Ergebnis:** Kompletter Content-Workflow: Idee → Draft → Review → Publish → Log.

### Phase 3: Proaktive Assistenz

- Scheduled CRM-Checks ("Leads überfällig?")
- Tages-Briefing (morgendliche Zusammenfassung)
- Content-Kalender-Reminder ("Morgen ist ein Post geplant")
- Automatische Follow-up-Vorschläge

**Ergebnis:** Bot agiert proaktiv statt nur reaktiv.

### Phase 4: Mehr Autonomie (optional)

- Konfigurierbares Autonomie-Level pro Action-Typ
- Auto-Post für bestimmte Content-Typen (nach Freigabe des Templates)
- Auto-CRM-Updates basierend auf Interaktionen
- Integration mit weiteren Tools (Google Calendar, Replicate/FLUX)

**Ergebnis:** Bot übernimmt Routine-Aufgaben selbstständig.

## Entscheidungen

| Entscheidung | Gewählt | Alternativen (verworfen) |
|---|---|---|
| Framework | NanoClaw (Fork) | OpenClaw (zu schwer), DIY (zu viel Aufwand), Claudegram (kein Scheduler) |
| Messaging | Telegram | WhatsApp (kein Bot API), Slack (kein privater Kanal), Discord (nicht team-geeignet) |
| AI Backend | Claude Agent SDK | OpenAI (kein MCP), lokale Modelle (zu schwach für Content) |
| CRM/Data | Teable (bestehendes Setup) | Notion (extra Service), Airtable (US, teuer) |
| Hosting | Hetzner VPS / Coolify | Vercel (kein long-running), Railway (US) |
| Workflow Engine | Keine (NanoClaw Scheduler reicht) | n8n (extra Komplexität, bei Bedarf nachrüstbar) |

## Brand Voice (System Prompt)

Der Bot schreibt im luno-Stil:
- Persönlich, nachdenklich, kein Marketing-Sprech
- "luno" immer lowercase
- Keine Emojis in Posts
- Content-Säulen: Origin Story, Marktplatz-Kaltstart, Faire Preisgestaltung, Build-in-Public/AI-Coding, Leipziger Yogaszene
- Post-Framework: Situation → Erkenntnis → Frage

Siehe auch: luno `/write-luno` Skill für Details.

## Referenzen

- [Architecture Comparison](research/architecture-comparison.md)
- [Integration Options](research/integrations.md)
- [Security & Privacy](research/security.md)
