# CLAUDE.md composition — which rule layer wins

`src/claude-md-compose.ts` regenerates `groups/<folder>/CLAUDE.md` on **every**
spawn, from `container-runner.buildMounts()`. The file is a list of imports and
nothing else; it carries the header `<!-- Composed at spawn — do not edit. Edit
CLAUDE.local.md for per-group content. -->` because editing it is pointless — the
next spawn overwrites it.

## The layers

In the order they are imported:

| Layer | Source | Scope |
|---|---|---|
| Shared base | `container/CLAUDE.md`, mounted RO at `/app/CLAUDE.md` | every group |
| Skill fragments | `container/skills/<name>/instructions.md` | every group (see caveat) |
| Module fragments | `container/agent-runner/src/mcp-tools/<name>.instructions.md` | every group, not toggleable |
| MCP server fragments | inline `instructions` field in `groups/<folder>/container.json` | that group |
| Per-group memory | `groups/<folder>/CLAUDE.local.md` | that group — auto-loaded by Claude Code, not imported by the composed file |

`CLAUDE.local.md` lives on the server only and is not in the repo. The composed
`CLAUDE.md` next to it is generated; `.claude-fragments/` beside it holds the
symlinks and is reconciled on each spawn (stale fragments are pruned).

**Caveat:** skill fragments are *not* filtered by the group's `container.json`
skill selection — `composeGroupClaudeMd()` walks `container/skills/` and includes
every skill that ships an `instructions.md`, for every group. There is a TODO in
the code for this. Until it is addressed, adding an `instructions.md` to any
skill changes the prompt of *all* agent groups.

## Reload semantics

Editing a skill's `instructions.md` or a group's `CLAUDE.local.md` needs a
`git pull` on the server — no build, no image rebuild, no service restart. The
composed `CLAUDE.md` imports its fragments as symlinks into the read-only
`/app/skills` mount, so the pull alone already changes what the next query reads
from disk.

What the pull does not change is the conversation the agent is in the middle of.
It keeps answering from the rules that were in context when its session started,
which is why an edit that is correct on disk still produces the old behaviour in
chat — the reported symptom is always "I changed it and the bot quotes the old
rule".

Two things end that continuation, and they cost different amounts. **Stopping the
container** makes the next message spawn a fresh one, which builds its system
prompt from the files on disk: the edited rule is then in force, and the
conversation is kept. **Clearing** additionally drops the transcript, which is
what it takes when the running thread itself carries the old rule — quoted back,
already acted on, a habit formed under it. That costs the person in that chat
their context, and there is no way to keep both.

**Deploy an instruction change with `scripts/deploy-lubo.sh`.** It pulls on the
server; `--restart` adds the container stop, which a changed file *set* needs (a
new skill directory, `container.json`, `.env`) and which is also what puts an
edited rule in force; `--clear` wipes the conversation and is deliberately not
the default.

## Style, formatting and language: the persona wins

`container/skills/lubo-persona/instructions.md` is the single source of truth for
lunobot's language (German unless asked otherwise), German typography, and
per-channel formatting. Because it is a skill fragment it lands in every group's
composed `CLAUDE.md`, and in practice it dominates whatever a per-group
`CLAUDE.local.md` says about the same subject.

**When lunobot ignores a formatting, style or language rule, read the persona
skill first** — a stale instruction there silently beats a correct one anywhere
else, and the symptom looks like a broken converter rather than a wrong prompt.
Formatting rules therefore live in the persona and nowhere else; a copy in
`container/CLAUDE.md` or a group's `CLAUDE.local.md` is a bug, not redundancy.

Two rules follow from that:

- **A rule that must always hold does not belong in a skill.** Skills are
  progressive disclosure — the agent may or may not load one. Always-on
  behaviour belongs in a rule layer that is unconditionally in context.
- **A rule that must hold *mechanically* does not belong in a prompt at all.**
  Outbound Telegram typography is enforced on the wire by
  `normalizeTelegramOutbound()` (`src/channels/telegram-normalize.ts`), not by
  instruction, because prompt-level rules lost against the volume of contrary
  modelling in the loaded memories. That file's header documents the three rules
  and why each exists.

## Agent group → folder

| Agent group | Folder |
|---|---|
| `luno` (the lunobot the studios talk to) | `telegram_main` |
| `Jan` | `telegram_jan` |
| `emacs` | `emacs` |
