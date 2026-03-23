---
name: log-post
description: >
  Log a social media post to the luno Marketing-Logbuch (Teable Content table on hub.hiluno.com).
  Use when a post has been published or when logging a new draft.
  Usage: "/log-post" (interactive) or "/log-post published Instagram 'Thema'"
---

# Log Post — luno Marketing-Logbuch

Log a social media post to the luno content table in Teable.

**Input:** $ARGUMENTS

## Teable Content Table

- **Base:** Content (`bseCNT001`)
- **Table ID:** `tblh77SllVYtjIYSDsy`
- **API Base URL:** `https://hub.hiluno.com/api`

### Fetch fields (REQUIRED before every write)

**Field names change!** Before the first POST/PATCH in a session, ALWAYS fetch current fields from the API:

```bash
TEABLE_HEADERS=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" -H "Authorization: Bearer $TEABLE_ACCESS_TOKEN" -H "Content-Type: application/json")
TABLE_URL="https://hub.hiluno.com/api/table/tblh77SllVYtjIYSDsy"

curl -s -G "${TEABLE_HEADERS[@]}" "$TABLE_URL/field" \
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

### Known fields (as of 2026-03-19, for orientation only)

| Field          | Teable Type    | Description                             |
| -------------- | -------------- | --------------------------------------- |
| Nr             | number         | Sequential post number                  |
| Gepostet am    | date           | Publication date (ISO 8601)             |
| Plattform      | singleSelect   | Instagram, LinkedIn                     |
| Säule          | singleSelect   | Content pillar (see options from API)    |
| Thema          | singleLineText | Short title (2-5 words)                 |
| Status         | singleSelect   | Idee, Entwurf, Bereit, Geplant, Live    |
| Text / Entwurf | longText       | Post text                               |
| Asset          | singleLineText | Image description or filename           |
| Link           | singleLineText | URL when published                      |
| Likes          | number         | Like count                              |
| Kommentare     | number         | Comment count                           |
| Learning       | longText       | Insights after publication              |
| Geplant für    | date           | Scheduled publication date              |

**This table is orientation only!** The API query above is the source of truth.

### Status values

- `Idee` — topic only, no text
- `Entwurf` — text written, not final
- `Bereit` — text final + asset available
- `Geplant` — scheduled in Meta Business Suite
- `Live` — published, link available

## API Authentication

Every API call needs three headers (values available as environment variables):

```bash
TEABLE_HEADERS=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" -H "Authorization: Bearer $TEABLE_ACCESS_TOKEN" -H "Content-Type: application/json")
TABLE_URL="https://hub.hiluno.com/api/table/tblh77SllVYtjIYSDsy"
```

## Workflow

### Mode 1: Interactive (no argument or topic only)

If no complete input is given, ask step by step:

1. **Plattform?** — Instagram or LinkedIn
2. **Säule?** — one of the 5 content pillars
3. **Thema?** — short title (2-5 words)
4. **Status?** — Idee, Entwurf, Bereit, Geplant, or Live
5. **Text?** — post text (or "noch keinen" for ideas)
6. **Asset?** — image description or file path (or "offen")
7. **Link?** — URL if published (or empty)

### Mode 2: Add metrics

When user says "update #X" or "metrics":

1. Ask which post (number)
2. Ask for Likes, Kommentare
3. Ask for Learning
4. Update the record (PATCH)

### Mode 3: Quick logging

If enough info is in the argument, e.g.:

- `/log-post published Instagram "Wir gehen raus und fragen" https://instagram.com/p/...`
- `/log-post draft LinkedIn "Erste Gespräche"`

Then log directly without asking.

## Technical Implementation

### 1. Find next number

Fetch all records and compute max client-side:

```bash
curl -s -G "${TEABLE_HEADERS[@]}" \
  "$TABLE_URL/record" \
  --data-urlencode 'take=100' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); nrs=[rec['fields'].get('Nr',0) for rec in r['records']]; print(max(nrs)+1 if nrs else 1)"
```

### 2. Create new record (POST)

**IMPORTANT:** Body must contain `records` as array, not `fields` directly.

Generate body via Python (for Unicode encoding):

```python
import json
body = {
    "records": [{
        "fields": {
            "Nr": 17,
            "Plattform": "Instagram",
            "S\u00e4ule": "Origin Story",  # Umlaut!
            "Thema": "Beispiel-Thema",
            "Status": "Entwurf",
            "Text / Entwurf": "Post-Text hier..."
        }
    }]
}
print(json.dumps(body, ensure_ascii=True))
```

```bash
curl -s -X POST "${TEABLE_HEADERS[@]}" "$TABLE_URL/record" -d "$BODY"
```

### 3. Update record (PATCH) — for metrics

**IMPORTANT:** Body is `{"record":{"fields":{...}}}` (singular `record`, not `records`).

```bash
curl -s -X PATCH "${TEABLE_HEADERS[@]}" \
  "$TABLE_URL/record/RECORD_ID" \
  -d '{"record":{"fields":{"Likes":42,"Kommentare":5,"Learning":"..."}}}'
```

### 4. Find record (by Nr)

Use `filterByTql` with Teable Query Language:

```bash
curl -s -G "${TEABLE_HEADERS[@]}" \
  "$TABLE_URL/record" \
  --data-urlencode 'filterByTql={Nr} = 5' \
  --data-urlencode 'take=1'
```

The record ID from the result (`records[0].id`) is needed for PATCH.

### 5. Confirmation

After logging: show summary with Nr, Thema, Status and link if applicable.

## Important

- **Date format:** ISO 8601 with timezone (`2026-03-17T00:00:00.000Z`)
- Post numbers are sequential, never overwrite
- For "Live" status a link MUST be present (ask if not given)
- SingleSelect values must match Teable options exactly
- Field names in API body are the **display names** from the API (e.g. `"Text / Entwurf"`, `"Säule"`)
- **Encoding gotcha on POST:** Umlauts in field names (e.g. `Säule`) must be Unicode-escaped in the JSON string (`S\u00e4ule`), otherwise validation fails with "not null validation failed". Only affects POST (new records), not PATCH. Safest method: generate JSON with `json.dumps(body, ensure_ascii=True)`.
