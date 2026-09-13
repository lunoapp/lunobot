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

Work out the target week from today's date, not from the last plan: "die
kommende Woche" on a Sunday is the week starting tomorrow. The last plan is only
the template for its classes, and its `kw` says nothing about which week comes
next.

Never invent a class. For each class you need weekday, time, course and place.
Start from the last plan you built, `/workspace/agent/wochenplan/letzte-woche.json`,
and ask whether it still holds: "Wie in KW36: Mo 8:30 – 9:30 Hatha Yoga (BGSV)
… – gilt das auch für KW38?" Ask only for what changed. Without that file,
start from `social/campaigns/wochenplan/week.example.json` and say that it is
an example, not her last week.

Places are the ids in `social/campaigns/wochenplan/venues.ts`. A place that is
not in there stops the week: say so. Adding a place is a change made on a
laptop, not here.

Also settle, by proposing and letting Nicole confirm:

- `intro` — the sentence naming the classes. Her editorial call: propose one in
  the style of the last weeks, never finalize it alone.
- `closing` and `hashtags` — reuse last week's unless she changes them.
- `postOn` — Sunday before the week, ISO date.
- `from`/`to` — the month only once when both days share it: `from` "14.",
  `to` "16. September". Only a week across two months names both ("31. August",
  "2. September"). The range is the slide's headline, and a repeated month
  breaks it over two lines.

## 2. Write the file

The newest file in `weeks/` is the one that renders, so it must be the only
one. Anything already there is left over from an interrupted run: move it
aside first, never delete it.

```bash
cd /workspace/extra/premarising/social/campaigns/wochenplan
mkdir -p weeks /workspace/agent/wochenplan/liegengeblieben
for f in weeks/*.json; do [ -e "$f" ] && mv "$f" /workspace/agent/wochenplan/liegengeblieben/; done
```

If that moved something, mention it once. Then write the week to
`weeks/<jahr>-kw<NN>.json` — two digits, `kw07` not `kw7`, the same number as
the `kw` field — and build:

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
    --public-dir social/assets --port 4573 --props=social/campaigns/wochenplan/week-slide.json \
    --scale 1 --log=error --browser-executable=/usr/bin/chromium
done
```

`--props` is how the week reaches the slides. Without it they render the
example week and look finished — check the headline dates before delivering.
Not `render.sh`: it also renders the photo variants, which are not posted.
`--scale 1`, never larger — the compositions already have Instagram's sizes.

## 4. Safe zones

```bash
bun social/lib/check-safezones.ts Woche-9x16 --props social/campaigns/wochenplan/week-slide.json
```

Open `social/safezones/Woche-9x16.f0.png` and look at it yourself. This check
is yours, not Nicole's.

- **Headline, a class, a time or a place inside a tinted band:** that one is
  cut off on some phones. Send Nicole the image, name the line, and ask.
- **Anything else in a band** — the `@premarising` handle, the flower, the
  background: that is the template, the same every week. Do not mention it and
  do not ask.

What changes from week to week is the number of classes, so a long week is
where a question can arise. A normal week delivers without one.

## 5. Deliver

Into the chat with `mcp__nanoclaw__send_file`, `to` set to this chat's
destination from the runtime system prompt and `path` absolute:

- `wochenplan-4x5.png` — Feed
- `wochenplan-9x16.png` — Story
- `wochenplan-1x1.png` — WhatsApp

Then the text of `social/campaigns/wochenplan/Caption.txt` as its own message,
inside a fenced code block (three backticks on the line before and after) and
nothing else — no note, no separator, no sign-off. Telegram renders plain
paragraphs without their blank lines, and Instagram needs them; a code block
keeps the text byte for byte and gives Nicole a copy button. Anything else you
want to say goes into a separate message. Good posting times: Sunday evening or Monday morning, 11–13 or
17–19 Uhr.

## 6. Clean up

A week is the input of one run, not an archive. Once everything is delivered:

```bash
set -e
cd /workspace/extra/premarising/social/campaigns/wochenplan
WEEK=weeks/<jahr>-kw<NN>.json   # the file from step 2, by name
mkdir -p /workspace/agent/wochenplan
cp "$WEEK" /workspace/agent/wochenplan/letzte-woche.json
rm -f "$WEEK" Caption.txt posts.json week-slide.json slides/*.png
rm -rf /workspace/extra/premarising/social/safezones
```

The copy comes first and `set -e` stops the block if it fails: the week is only
deleted once it is saved.

The copy in your workspace is next week's starting point, nothing more. If
Nicole asks for a change after delivery, build the week again from that copy.

## Limits

- **No health claims.** Before writing `intro` or `closing`, read
  `docs/gesundheitsbezogene-aussagen.md`. Describe what happens in the class,
  never what it does for the body.
- **No prices, no booking paths on the image.** The Anleitung says why.
- **Do not talk about files.** Week files, the repo and pushing are not
  Nicole's concern. None of them belongs in the chat.
