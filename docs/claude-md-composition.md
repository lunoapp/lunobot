# CLAUDE.md composition — which rule layer wins

`src/project-doc-compose.ts` regenerates `groups/<folder>/CLAUDE.md` on **every**
container start, from `container-runner.buildMounts()`. It is one flat file:
every source is read on the host and inlined as a `# <name>` section, nothing is
an `@` import. The first line is the marker `<!-- Composed at spawn - do not
edit. … -->`; editing the file is pointless, the next spawn overwrites it.

## The layers

In the order they appear in the file:

| Section | Source | Scope |
|---|---|---|
| `Persona` | `groups/<folder>/instructions.prepend.md` | that group — standing role and behaviour |
| `NanoClaw Runtime Contract` | `container/CLAUDE.md` | every group |
| `NanoClaw Module: <name>` | `container/agent-runner/src/mcp-tools/<name>.instructions.md` | every group; `cli` and `scheduling` drop out when the group's `cli_scope` is `disabled` |
| `NanoClaw Skill: <name>` | `container/skills/<name>/instructions.md` | groups that select the skill (every group on `"skills": "all"`) |
| `MCP Server: <name>` | inline `instructions` of an MCP server in the group's container config | that group |

Durable facts are not a layer of this file. They live in the group's memory tree,
`groups/<folder>/memory/` (mounted at `/workspace/agent/memory/`), which the
runtime loads on its own; see `docs/memory.md`. `instructions.prepend.md` and
`memory/` live on the server only and are not in the repo.

Skill sections follow the group's skill selection, the same one that decides
which skills are linked into the container. A group on `"skills": "all"` gets
every skill that ships an `instructions.md`, so adding one to a skill changes the
prompt of every such group. A group with an explicit list gets only the skills
it names — which is how `telegram_prema` stays out of the Lunobot persona. The
selected credential gateway adds its own agent skill (`onecli-gateway`).

The file has a size cap. Over it, the largest module, skill and MCP sections are
dropped first and an `Omitted for size` section names them; persona and runtime
contract are never dropped.

## Reload semantics

Editing a skill's `instructions.md`, `container/CLAUDE.md` or a group's
`instructions.prepend.md` needs a `git pull` (or, for the server-only file, the
edit itself) — no build, no image rebuild, no service restart. Because every
source is inlined at spawn, the change reaches an agent when its container next
starts, not before.

What a new file on disk does not change is the conversation the agent is in the
middle of. It keeps answering from the rules that were in context when its
session started, which is why an edit that is correct on disk still produces the
old behaviour in chat — the reported symptom is always "I changed it and the bot
quotes the old rule".

Two things end that continuation, and they cost different amounts. **Stopping the
container** makes the next message spawn a fresh one, which composes its document
from the files on disk: the edited rule is then in force, and the conversation is
kept. **Clearing** additionally drops the transcript, which is what it takes when
the running thread itself carries the old rule — quoted back, already acted on, a
habit formed under it. That costs the person in that chat their context, and
there is no way to keep both.

Scheduled tasks are not affected by either: each task series runs in its own
session, which starts from the composed document and no chat history.

**Deploy an instruction change with `scripts/deploy-lunobot.sh`.** It pulls on the
server; `--restart` adds the container stop, which a changed file *set* needs (a
new skill directory, `container.json`, `.env`) and which is also what puts an
edited rule in force; `--clear` wipes the conversation and is deliberately not
the default. It also updates the clones mounted into containers; exit 1 with
"Not updated on …" means the bot is deployed and a clone is not.

## Style, formatting and language: the persona wins

`container/skills/lunobot-persona/instructions.md` is the single source of truth for
lunobot's language (German unless asked otherwise), German typography, and
per-channel formatting. It lands as a skill section in the composed `CLAUDE.md` of every
group that selects it, and in practice it dominates whatever a group's
`instructions.prepend.md` says about the same subject.

**When lunobot ignores a formatting, style or language rule, read the persona
skill first** — a stale instruction there silently beats a correct one anywhere
else, and the symptom looks like a broken converter rather than a wrong prompt.
Formatting rules therefore live in the persona and nowhere else; a copy in
`container/CLAUDE.md` or a group's `instructions.prepend.md` is a bug, not redundancy.

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
| `prema` (Nicole's Prema Rising bot) | `telegram_prema` |
| `emacs` | `emacs` |
