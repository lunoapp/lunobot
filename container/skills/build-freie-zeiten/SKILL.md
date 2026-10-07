---
name: build-freie-zeiten
description: >
  Builds the weekly "Freie Zeiten" Instagram story batch for luno: fetches the
  free, bookable slots of one week from hiluno.com, renders one story frame per
  studio plus the week's cover, re-checks every slot against the live API, and
  delivers the week into the chat. Also corrects a built week. Use when someone
  asks for the free times of a week — "freie Zeiten", "Story für nächste Woche",
  "Wochencharge", "/freie-zeiten".
---

# Freie Zeiten — the weekly story batch

**The procedure lives in the social repo, not here.** Read it and follow it:

```bash
cat /workspace/extra/social/.claude/skills/social-build-freie-zeiten/SKILL.md
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
