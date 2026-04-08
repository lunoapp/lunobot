---
name: log-post
description: >
  Log a social media post to the luno Marketing-Logbuch (Teable on hub.hiluno.com).
  Two tables: Themen (content topics) and Posts (individual posts linked to a Thema).
  Use when a post has been published or when logging a new draft.
  Usage: "/log-post" (interactive) or "/log-post published Instagram 'Thema'"
---

# Log Post — luno Marketing-Logbuch

Log a social media post to the luno content tables in Teable.

**Input:** $ARGUMENTS

## Teable Content Tables

- **Base:** Content (`bseCNT001`)
- **Themen-Tabelle:** `tblh77SllVYtjIYSDsy` — Content-Themen (Oberthemen)
- **Posts-Tabelle:** `tblgkzS2CqdPZSX7Ary` — Einzelne Social-Media-Posts
- **API Base URL:** `https://hub.hiluno.com/api`

### Beziehung

Ein **Thema** hat mehrere **Posts**. Jeder Post ist über ein Link-Feld mit einem Thema verknüpft.

- Caption (der Text den Nicole kopiert) lebt am **Post**, nicht am Thema
- Stories haben keine Caption (Instagram Stories haben kein Caption-Feld)
- Das Feld „Text / Entwurf" auf der Themen-Tabelle existiert **nicht mehr**

### Fetch fields (REQUIRED before every write)

**Field names change!** Before the first POST/PATCH in a session, ALWAYS fetch current fields from BOTH tables:

```bash
THEMEN_URL="https://hub.hiluno.com/api/table/tblh77SllVYtjIYSDsy"
POSTS_URL="https://hub.hiluno.com/api/table/tblgkzS2CqdPZSX7Ary"

# Themen fields
curl -s -G -H "Content-Type: application/json" "$THEMEN_URL/field" \
  | python3 -c "
import sys,json
fields = json.load(sys.stdin)
for f in fields:
    opts = ''
    if f.get('type') == 'singleSelect' and f.get('options',{}).get('choices'):
        opts = ' | ' + ', '.join([c['name'] for c in f['options']['choices']])
    print(f'{f[\"name\"]} ({f[\"type\"]}){opts}')
"

# Posts fields
curl -s -G -H "Content-Type: application/json" "$POSTS_URL/field" \
  | python3 -c "
import sys,json
fields = json.load(sys.stdin)
for f in fields:
    opts = ''
    if f.get('type') == 'singleSelect' and f.get('options',{}).get('choices'):
        opts = ' | ' + ', '.join([c['name'] for c in f['options']['choices']])
    print(f'{f[\"name\"]} ({f[\"type\"]}){opts}')
"
```

This gives you the valid field names and SingleSelect options. **Never guess field names from memory.**

### Known fields — Themen (as of 2026-04-08, for orientation only)

| Field   | Teable Type    | Description                          |
| ------- | -------------- | ------------------------------------ |
| Nr      | number         | Sequential topic number              |
| Säule   | singleSelect   | Content pillar (see options from API)|
| Thema   | singleLineText | Short title (2-5 words)              |
| Status  | singleSelect   | Idee, Entwurf, Bereit, Live          |

### Known fields — Posts (as of 2026-04-08, for orientation only)

| Field        | Teable Type    | Description                                              |
| ------------ | -------------- | -------------------------------------------------------- |
| Bezeichnung  | singleLineText | PK, Format: „{Thema} – {Format} {Plattform}"            |
| Format       | singleSelect   | Carousel, Reel, Story, Single                            |
| Plattform    | singleSelect   | Instagram, LinkedIn                                      |
| Caption      | longText       | Post-Text (den Nicole kopiert). Stories haben keine Caption |
| Status       | singleSelect   | Offen, Bereit, Live                                      |
| Geplant für  | date           | Scheduled publication date (ISO 8601)                    |
| Gepostet am  | date           | Actual publication date (ISO 8601)                       |
| Google Drive | singleLineText | URL to asset in Google Drive                             |
| Link         | singleLineText | URL to live post                                         |
| Likes        | number         | Like count                                               |
| Kommentare   | number         | Comment count                                            |
| Template     | singleLineText | Design template used                                     |
| Thema        | link           | Link to Themen-Tabelle                                   |

**These tables are orientation only!** The API query above is the source of truth.

### Link-Feld Format

Link-Felder sind Objects, nicht Arrays:

```json
{"Thema": {"id": "recXXX", "title": "9"}}
```

## API Authentication

Credentials (Cloudflare Access + Teable Token) werden automatisch vom OneCLI Gateway injiziert. Keine manuellen Auth-Header nötig:

```bash
THEMEN_URL="https://hub.hiluno.com/api/table/tblh77SllVYtjIYSDsy"
POSTS_URL="https://hub.hiluno.com/api/table/tblgkzS2CqdPZSX7Ary"
```

## Workflow

### Mode 1: Interactive (no argument or topic only)

If no complete input is given, ask step by step:

1. **Thema?** — Gibt es das Thema schon? (Suche in Themen-Tabelle) Oder neues Thema anlegen?
   - Für neues Thema: Säule, Thema-Titel, Status
2. **Format?** — Carousel, Reel, Story, Single
3. **Plattform?** — Instagram oder LinkedIn
4. **Caption?** — Post-Text (oder „noch keine" für Ideen). Entfällt bei Stories.
5. **Status?** — Offen, Bereit, oder Live
6. **Google Drive?** — URL zum Asset (oder „offen")
7. **Link?** — URL wenn veröffentlicht (oder leer)

### Mode 2: Add metrics

When user says „update" or „metrics":

1. Ask which post (Bezeichnung or search)
2. Ask for Likes, Kommentare
3. Update the Post record (PATCH)

### Mode 3: Quick logging

If enough info is in the argument, e.g.:

- `/log-post published Instagram Carousel "Wir gehen raus und fragen" https://instagram.com/p/...`
- `/log-post draft LinkedIn Single "Erste Gespräche"`

Then log directly without asking.

## Technical Implementation

### 1. Find or create Thema

Search existing Themen:

```bash
curl -s -G -H "Content-Type: application/json" \
  "$THEMEN_URL/record" \
  --data-urlencode 'take=100' \
  | python3 -c "
import sys,json
r=json.load(sys.stdin)
for rec in r['records']:
    f = rec['fields']
    print(f'{rec[\"id\"]} | Nr {f.get(\"Nr\",\"?\")} | {f.get(\"Thema\",\"\")} | {f.get(\"Status\",\"\")}')
"
```

If the Thema doesn't exist, create it:

```bash
# Find next Nr
curl -s -G -H "Content-Type: application/json" \
  "$THEMEN_URL/record" \
  --data-urlencode 'take=100' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); nrs=[rec['fields'].get('Nr',0) for rec in r['records']]; print(max(nrs)+1 if nrs else 1)"
```

```python
import json
body = {
    "records": [{
        "fields": {
            "Nr": 17,
            "S\u00e4ule": "Origin Story",
            "Thema": "Beispiel-Thema",
            "Status": "Idee"
        }
    }]
}
print(json.dumps(body, ensure_ascii=True))
```

```bash
curl -s -X POST -H "Content-Type: application/json" "$THEMEN_URL/record" -d "$BODY"
```

### 2. Create Post (POST)

**IMPORTANT:** Body must contain `records` as array, not `fields` directly.

Generate body via Python (for Unicode encoding):

```python
import json
body = {
    "records": [{
        "fields": {
            "Bezeichnung": "Beispiel-Thema \u2013 Carousel Instagram",
            "Format": "Carousel",
            "Plattform": "Instagram",
            "Caption": "Post-Text hier...",
            "Status": "Offen",
            "Thema": {"id": "recXXX", "title": "17"}
        }
    }]
}
print(json.dumps(body, ensure_ascii=True))
```

**Bezeichnung format:** „{Thema} – {Format} {Plattform}" (mit Halbgeviertstrich `–`, U+2013)

```bash
curl -s -X POST -H "Content-Type: application/json" "$POSTS_URL/record" -d "$BODY"
```

### 3. Update Post (PATCH) — for metrics or status

**IMPORTANT:** Body is `{"record":{"fields":{...}}}` (singular `record`, not `records`).

```bash
curl -s -X PATCH -H "Content-Type: application/json" \
  "$POSTS_URL/record/RECORD_ID" \
  -d '{"record":{"fields":{"Likes":42,"Kommentare":5}}}'
```

### 4. Find Post record

Use `filterByTql` with Teable Query Language:

```bash
curl -s -G -H "Content-Type: application/json" \
  "$POSTS_URL/record" \
  --data-urlencode 'filterByTql={Bezeichnung} = "Beispiel-Thema – Carousel Instagram"' \
  --data-urlencode 'take=1'
```

The record ID from the result (`records[0].id`) is needed for PATCH.

### 5. Confirmation

After logging: show summary with Bezeichnung, Thema, Format, Plattform, Status and link if applicable.

## Important

- **Date format:** ISO 8601 with timezone (`2026-04-08T00:00:00.000Z`)
- **Bezeichnung** is the primary key for Posts — Format: „{Thema} – {Format} {Plattform}"
- For „Live" status a Link MUST be present (ask if not given)
- SingleSelect values must match Teable options exactly
- Field names in API body are the **display names** from the API (e.g. `"Säule"`, `"Plattform"`)
- **Encoding gotcha on POST:** Umlauts in field names (e.g. `Säule`) must be Unicode-escaped in the JSON string (`S\u00e4ule`), otherwise validation fails with „not null validation failed". Only affects POST (new records), not PATCH. Safest method: generate JSON with `json.dumps(body, ensure_ascii=True)`.
- **Link-Felder:** Thema-Link ist ein Object `{"id": "recXXX", "title": "Nr"}`, kein Array
