---
name: build-wochenplan
description: >
  Builds Nicole's weekly class plan for Instagram (Prema Rising): writes the
  week file, renders the feed, story and WhatsApp images, checks the story
  against the safe zones, and sends images and caption into the chat. Use when
  Nicole asks for her Wochenplan, Kursplan, the post for next week, or "KW <nr>".
---

# Wochenplan

The repo is mounted at `/workspace/extra/premarising`; everything runs there.
The source of truth is `social/campaigns/wochenplan/Anleitung.txt` — read it
before the first week of a session. Where this file and the Anleitung disagree,
the Anleitung wins.

## 1. Get the week

Never invent a class. For each class you need weekday, time, course and place.
Start from the newest file in `social/campaigns/wochenplan/weeks/` and ask
whether it still holds: "Wie in KW36: Mo 8:30 – 9:30 Hatha Yoga (BGSV) … – gilt
das auch für KW38?" Ask only for what changed.

Places are the ids in `social/campaigns/wochenplan/venues.ts`. A place that is
not in there stops the week: say so. Adding a place is a change made on a
laptop, not here.

Also settle, by proposing and letting Nicole confirm:

- `intro` — the sentence naming the classes. Her editorial call: propose one in
  the style of the last weeks, never finalize it alone.
- `closing` and `hashtags` — reuse last week's unless she changes them.
- `postOn` — Sunday before the week, ISO date. `from`/`to` in the form of the
  last file ("31. August", "2. September").

## 2. Write the file

Copy the newest week to `weeks/<jahr>-kw<NN>.json` — two digits, `kw07` not
`kw7`, the same number as the `kw` field — and edit it. Then:

```bash
cd /workspace/extra/premarising
bun social/campaigns/wochenplan/build.ts
```

`build.ts` validates the newest week — schema, file name, `kw` — and writes
`Caption.txt`, `posts.json` and `week-slide.json`. An error names the file. Fix
it; a week is never skipped silently.

## 3. Render

Three images, the clean variant only:

```bash
for f in 4x5 1x1 9x16; do
  npx remotion still social/remotion/index.ts "Woche-$f" "social/campaigns/wochenplan/slides/wochenplan-$f.png" \
    --public-dir social/assets --port 4573 --scale 1 --log=error --browser-executable=/usr/bin/chromium
done
```

Not `render.sh`: it also renders the photo variants, which are not posted.
`--scale 1`, never larger — the compositions already have Instagram's sizes.

## 4. Safe zones

```bash
bun social/lib/check-safezones.ts Woche-9x16
```

Open `social/safezones/Woche-9x16.f0.png` and look at it. Say in one sentence
what is inside the tinted bands. Text in a band is cut off on some phones: send
Nicole that image and ask. This is a judgement, not a pass/fail — do not make it
alone when text is involved.

## 5. Deliver

Into the chat with `mcp__nanoclaw__send_file`, `to` set to this chat's
destination from the runtime system prompt and `path` absolute:

- `wochenplan-4x5.png` — Feed
- `wochenplan-9x16.png` — Story
- `wochenplan-1x1.png` — WhatsApp

Then the text of `social/campaigns/wochenplan/Caption.txt` as its own message, so
it can be copied in one go. Good posting times: Sunday evening or Monday morning,
11–13 or 17–19 Uhr.

## Limits

- **No health claims.** Before writing `intro` or `closing`, read
  `docs/gesundheitsbezogene-aussagen.md`. Describe what happens in the class,
  never what it does for the body.
- **No prices, no booking paths on the image.** The Anleitung says why.
- **The week stays on the server.** Nothing can be pushed from here. The new
  week file and the regenerated `Caption.txt`, `posts.json` and
  `week-slide.json` exist only in this copy of the repo. Say so once.
