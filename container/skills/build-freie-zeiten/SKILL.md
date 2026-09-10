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
room that has a free slot that week, 1080×1920 at scale 1. Stories, not feed
posts — a concrete time is stale in a week and must not stay in the profile.

The repo is mounted at `/workspace/extra/social`; everything runs there. The
reasoning behind every rule is `docs/marketing/freie-zeiten.md` in that repo.
**Read it before the first batch of a session.** This file is the procedure, not
the source of truth: where the two disagree, the doc wins and this file is wrong.

## Quick start

```bash
cd /workspace/extra/social
pnpm run availability:fetch --city leipzig --lead <days to the target Monday>
```

The repo is kept up to date from outside — there is no key in here to pull
with, and no need: what changes between batches is the data, not the pipeline.

**It is a deploy target, not a workspace.** Every deploy resets it to what is on
GitHub, and nothing can be pushed from here. An edit to a tracked file made in
this container does not survive: it looks like a fix, reports as one, and is
silently gone at the next deploy. Anything that has to last gets reported, not
edited.

The lead is not optional thinking: its default of seven days cuts the start off
a week that begins sooner, and what falls out cannot be rendered again.

Then pick the week, render each frame twice through the gate, re-check the
slots, put the week into the team drive, and `mcp__nanoclaw__send_file` the
frames into the chat. Details below.

## Workflow

### 1. Fetch

**Work out the target week first, then the lead.** `--lead` is how many days
ahead the window starts, and its default of seven cuts the beginning off a week
that starts sooner. Building on a Wednesday for the week after next, seven is
right; building on a Wednesday for the *coming* Monday, seven silently drops
Monday and Tuesday.

```bash
pnpm run availability:fetch --city leipzig --lead <days until the target week's Monday>
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

Composition id is the entry `id` plus `-Story`. **Render into the week's own
directory**, `output/<Wochenordner>/` — the one named by the entry's `theme`.
`output/` itself is a scrap heap: the gate writes its safe-zone bands there on
every call, and earlier batches left their frames behind. Step 5 mirrors the
directory it is given, so it has to hold this week and nothing else.

Two calls per frame:

```bash
pnpm run render:still "<id>" output/<Wochenordner>/<id>.png --scale 1
pnpm run render:still "<id>" output/<Wochenordner>/<id>.png --scale 1 --safezones-ok
```

**`--scale 1`, never larger.** The composition is 1080 x 1920, which is what
Instagram wants for a story. Rendering bigger does not make it sharper: Meta
scales anything wider than 1440 px down itself and compresses it harder than a
file that arrives at target size, and it refuses anything over 8 MB. Step 5
rejects frames outside those limits, so a bigger render costs the batch.

**The file name is a contract**, not a label: `<id>-Story.png` for a room and
`KW<nn>-Cover-Story.png` for the cover. Step 5 matches on it and refuses
anything else.

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
pnpm run availability:verify --theme KW38
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

**A frame that drops has to leave the directory.** The check reads the data
file; it does not touch what step 3 rendered. So delete the PNG yourself:

```bash
rm output/<Wochenordner>/<id>-Story.png
```

Skip this and the booked slot is still a file, step 5 uploads it, and the one
thing this check exists to prevent is what gets posted. Once it is gone, step 5
sees the frame as missing and asks for `--force` — that question is the
confirmation that dropping it was deliberate.

**If any frame drops, the cover has to be rendered again.** It carries the times
of the whole week, so leaving out one story still opens the sequence with the
time that just fell out. Re-render `KW<nn>-Cover-Story` after the data file
reflects the drop, or deliver the batch without a cover and say so.

### 5. Put the week into the team drive

The frames that survived step 4 are already in `output/<Wochenordner>/` from
step 3, and that directory holds nothing else. Then:

```bash
pnpm run availability:publish --theme KW38
```

`--dir` defaults to `output/<Wochenordner>`; pass it only to publish from
somewhere else. Use `pnpm run <script>`: the bare shorthand works too, but it
falls through to npm whenever a script name collides with a pnpm command, and
`pnpm run` never does.

It mirrors the directory into
`Marketing/Inhalte/<Wochenordner>/Instagram/01-Story/` and prints the folder's
share link. The folder is the only record that a week ran, so what lies in it is
exactly what gets posted — nothing beside it.

It refuses to run when the week is not complete — frames missing locally, or
frames already in the drive that the upload would delete. From outside, that is
what a half-finished render looks like, and the folder is the record. Read what
it names: if a frame was genuinely withdrawn in step 4, repeat with `--force`;
if the render simply is not finished, finish it.

Nothing is deleted outright: a withdrawn frame goes to the drive's trash, and a
subfolder is never touched at all, `--force` included. A file somebody put into
the folder by hand cannot be moved from here either — the bot may only touch what
it uploaded itself. The frames still go up and the link still comes back; the
script names what it could not clear away, and that one gets taken out in the
drive.

Read the exit code, the same three meanings as in step 4:

| Exit | Meaning | What you do |
|---|---|---|
| 0 | the week is in the drive | pass the link on in step 6 — and if it names something left behind in the drive, pass that on too |
| 1 | something about the content — read the message | fix what it names, then run again |
| 2 | the step never ran (drive, gateway, network) | deliver nothing from here, say why, try again later |

### 6. Deliver

**The drive link, not the frames.** One message: the cover as a single image,
the link to the week's folder, and the text. Nicole runs the free times and
sorts the week in the folder before posting, so ten separate images in the chat
are ten notifications and no help.

**Do not ask about this again** — it is settled. Send the frames individually
only if somebody asks for them in that batch, and even then the folder stays the
record.

The accompanying text names the week, how many frames, what dropped out and why,
and what the person has to decide.

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
