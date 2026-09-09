---
name: build-raum-vorstellung
description: >
  Builds the Instagram feed post for one named luno room: fetches the live
  listing data from hiluno.com, renders the 1080×1350 frame, puts it into the
  standing Google-Drive folder, logs the post in Teable with a caption draft, and
  delivers it into the chat. Use when someone asks for the post for a specific
  room — "mach den Post für den Studioraum bei Yoga In Harmony",
  "Raumvorstellung für …", "welche Räume fehlen noch?", "/build-raum-vorstellung".
---

# Raum-Vorstellung — one room, on request

**The procedure lives in the social repo, not here.** Read it and follow it:

```bash
cat /workspace/extra/social/.claude/skills/social-build-room-spotlight/SKILL.md
```

It is written to run in both places — on a Mac and in this container — and it
says which of its steps differ here. Everything runs in
`/workspace/extra/social`.

This file is a pointer on purpose. The same skill is used from a laptop, and a
second copy in this repo would be the copy that goes stale: the one that still
names an option the script dropped, or misses a rule the runbook gained. The
repo the pipeline lives in is the repo its procedure lives in.

The reasoning behind the format itself is
`/workspace/extra/social/docs/marketing/freie-zeiten.md`. Where that document and
the procedure disagree, the document wins.
