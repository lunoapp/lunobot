---
name: build-freie-zeiten
description: >
  Builds the weekly "Freie Zeiten" Instagram story batch for luno: fetches the
  free, bookable slots from hiluno.com, renders one story frame per room plus the
  week's cover, re-checks every slot against the live API, and delivers the frames
  into the chat. Use when someone asks for the free times of a week — "freie
  Zeiten", "Story für nächste Woche", "Wochencharge", "/freie-zeiten".
---

# Freie Zeiten — the weekly story batch

One batch per calendar week: a typographic cover frame plus one story frame per
room that has a free slot that week, 1080×1920 at scale 2. Stories, not feed
posts — a concrete time is stale in a week and must not stay in the profile.

The repo is mounted at `/workspace/extra/social`; everything runs there. The
reasoning behind every rule is `docs/marketing/freie-zeiten.md` in that repo.
**Read it before the first batch of a session.** This file is the procedure, not
the source of truth: where the two disagree, the doc wins and this file is wrong.

## Quick start

```bash
cd /workspace/extra/social
git pull --ff-only
[ -d node_modules ] || pnpm install        # only after a fresh clone
pnpm availability:fetch --city leipzig --lead <days to the target Monday>
```

The lead is not optional thinking: its default of seven days cuts the start off
a week that begins sooner, and what falls out cannot be rendered again.

Then pick the week, render each frame twice through the gate, re-check the slots,
and `mcp__nanoclaw__send_file` them into the chat. Details below.

## Workflow

### 1. Fetch

**Work out the target week first, then the lead.** `--lead` is how many days
ahead the window starts, and its default of seven cuts the beginning off a week
that starts sooner. Building on a Wednesday for the week after next, seven is
right; building on a Wednesday for the *coming* Monday, seven silently drops
Monday and Tuesday.

```bash
pnpm availability:fetch --city leipzig --lead <days until the target week's Monday>
```

**A fetch replaces the whole data stand.** Entries that fall outside the new
window lose their composition and cannot be rendered again — a later fetch will
not bring them back, because their day is by then even closer. The photo
rotation moves with it too, so a re-render after a fetch shows different
pictures than the asset already exported.

Two rules follow, and neither is negotiable:

- **Never fetch again between rendering and delivering.** The check in step 4
  reads the data file; a fetch in between makes it check entries that are not
  the ones on the pictures.
- **Never fetch to re-render a week that has already been exported.** Render
  from the stand that produced it.

The city comes from the request; `leipzig` when none is named.

Report what came back before rendering: how many studios, how many slots, which
weeks. A target week with no entries is the answer, not a failure — say so and
stop.

### 2. Pick the week

Every entry in `src/data/availability.json` carries a `theme` like
`Freie-Zeiten-KW37-7-bis-13-Sep`. That is the week grouping, and it means when the
*slot* is, not when it gets posted. Match the request against it, then take the
cover (`KW<nn>-Cover-Story`) plus every entry whose `theme` is that week.

### 3. Render through the gate

Composition id is the entry `id` plus `-Story`. Two calls per frame:

```bash
pnpm render:still "<id>" output/<id>.png --scale 2
pnpm render:still "<id>" output/<id>.png --scale 2 --safezones-ok
```

The first writes the safe-zone bands to `output/safezones/` and stops. **Read the
band images** — actually look at them — then repeat with `--safezones-ok`. That
flag is a claim that someone looked, and here that someone is you.

What you are judging: no text is cut, no headline runs into the bands.
Photography running into them is fine and expected. A frame that fails leaves the
batch, and you name which and why.

### 4. Re-check every slot

**Before delivering, not while posting.** Between fetch and delivery someone can
book, a studio can pause a room, and a minimum booking duration can change. Run
exactly this, with the week you rendered:

```bash
pnpm availability:verify --theme KW38
```

Read the exit code, not the prose:

| Exit | Meaning | What you do |
|---|---|---|
| 0 | every frame of the week holds | deliver |
| 1 | named frames are booked, or could not be checked | deliver the rest, leave those out, name them and say which of the two they were |
| 2 | the check never ran at all | deliver nothing, say why, try again later |

**Exit 2 is not "free".** An unreachable API says nothing about the booking
situation, and treating it as a pass is the one failure this step exists to
prevent.

**If any frame drops, the cover has to be rendered again.** It carries the times
of the whole week, so leaving out one story still opens the sequence with the
time that just fell out. Re-render `KW<nn>-Cover-Story` after the data file
reflects the drop, or deliver the batch without a cover and say so.

### 5. Deliver

One `mcp__nanoclaw__send_file` per frame, cover first, then the date frames in chronological
order. The accompanying text names the week, how many frames, and what the person
has to decide.

Then the two things the frames cannot carry:

- Each frame's link sticker goes on the green action bar, pointing at the room
  page (`bookingUrl` in the JSON). The cover's sticker points at the city
  overview (`hiluno.com/studios/leipzig`) instead — it announces several studios
  and must not favour one.
- Without a sticker the bar promises an action the image does not have. Posted
  that way it is broken.

## Not yours to decide

- **Never invent a price.** A room without a published price says „Preis auf
  Anfrage". Correct, not a gap.
- **Never drop a room to make the batch prettier.** Every free room appears —
  that is the value the studios are listed for. A room without a free slot is
  simply absent.
- **Never stretch a window past `blockLabel`**, which is how long the room is
  actually free. `timeLabel` is what is advertised. Shortening is fine, stretching
  is a false offer.
