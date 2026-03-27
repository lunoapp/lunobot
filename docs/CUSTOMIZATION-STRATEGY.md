# Customization Strategy

How we keep our NanoClaw fork maintainable while staying close to upstream.

## Upstream Merge (2026-03-26)

Merged 171 upstream commits (v1.2.14 → v1.2.35). 10 conflicts resolved.
Backup tag: `pre-update-a4532bd-20260326-212453`

### Key upstream changes adopted
- **OneCLI Agent Vault** — replaces our manual credential proxy
- **Task Scripts** — `wakeAgent` pattern for scheduled tasks
- **Agent-runner caching** — only re-syncs when source changes
- **Channel formatting docs** — Slack/WhatsApp/Telegram/Discord formatting in global CLAUDE.md

## Our Customizations vs Upstream

### Core changes (stay in our fork)

| Feature | Files | Why it must stay |
|---------|-------|-----------------|
| Image Vision (multimodal) | agent-runner/index.ts, container-runner.ts, ipc.ts, image.ts, types.ts | Adds `imageAttachments` to ContainerInput, multimodal content blocks — type/interface changes can't be externalized |
| Voice Transcription | transcription.ts | Standalone module, called from Telegram channel |
| Global CLAUDE.md for all groups | container-runner.ts, agent-runner/index.ts | Architecture decision: main group also reads global memory |
| Container auto-build | container-runtime.ts | UX improvement: auto-builds image if missing |
| Network isolation | container-runtime.ts | Security: `nanoclaw-internal` Docker network |
| thread_id on NewMessage | types.ts | Telegram topic/forum support |

### Already cleanly externalized

| Feature | Mechanism | Conflict risk |
|---------|-----------|--------------|
| Google Docs MCP | ENV-conditional in agent-runner (`SERVICE_ACCOUNT_PATH`) | Low — only a few lines |
| Telegram channel | Skill branch (`telegram/main`) | None — upstream deleted Telegram from core |
| luno persona/skills | `groups/global/CLAUDE.md` + `.claude/skills/` | Low — upstream rarely touches these |

### Upstream PR candidates

These features would benefit other users and eliminate our merge conflicts:

1. **Image Vision** — multimodal image input for agents (biggest conflict source)
2. **Voice Transcription** — local whisper.cpp transcription
3. **Container auto-build** — auto-build image on first startup
4. **Network isolation** — isolated Docker network for containers

## Reducing future merge conflicts

### Current strategy
- **Monthly upstream sync** — don't let >50 commits accumulate
- **Use `/update-nanoclaw`** skill for guided merges
- **Keep customizations minimal** — prefer upstream patterns

### groups/global/CLAUDE.md
- Our luno-specific content lives here (upstream doesn't touch this file often)
- Upstream generic docs (channel formatting, task scripts) were merged in during the 2026-03-26 update
- If upstream starts writing more to this file, consider splitting: upstream content → `groups/main/CLAUDE.md`, our content → `groups/global/CLAUDE.md`

### Package.json
- Channel dependencies (grammy for Telegram) come via skill branch merges — that's correct
- Version bumps from upstream will always cause trivial conflicts — accept `--theirs` for version

## OneCLI Setup (pending)

OneCLI needs to be deployed on the Hetzner server (via Coolify). Until then, containers won't have credentials injected.

See: `.claude/skills/init-onecli/SKILL.md`
