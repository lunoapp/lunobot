# Architecture & Framework Comparison

Research date: 2026-03-20

## The "Claw Family"

### OpenClaw

- **Repo:** https://github.com/openclaw/openclaw
- **Stars:** ~134k | **Created:** 2025
- **Author:** Peter Steinberger
- **What:** Full-featured personal AI assistant, 50+ integrations
- **Architecture:** Gateway daemon → Channel adapters → Command queue → Agent containers
- **Channels:** Telegram, WhatsApp, Discord, Slack, Signal, iMessage, IRC, Teams, Matrix, ...
- **Memory:** Multiple backends (ClawMem, MemU, PowerMem)
- **Tools:** MCP-based (file system, web search, code execution, browser, APIs)
- **Privacy:** All data stays on your hardware

**Verdict for lunobot:** Too heavy. Massive codebase, 50+ integrations we don't need. Great reference architecture but overkill for a 2-person team.

### NanoClaw

- **Repo:** https://github.com/qwibitai/nanoclaw
- **Stars:** ~24k | **Created:** January 2026
- **Author:** gavrielc (primary)
- **What:** Lightweight OpenClaw alternative, ~4,000 lines / ~15 TypeScript files
- **Architecture:** Single Node.js process → SQLite → Polling loop → Container (Claude Agent SDK)

**Key files:**

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel self-registration |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/ipc-mcp.ts` | MCP server exposing tools via IPC to containers |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger patterns, file paths, polling intervals |
| `src/container-runner.ts` | Spawns agent containers with filesystem mounts |
| `src/group-queue.ts` | Per-group FIFO queue, concurrency, retry backoff |
| `src/task-scheduler.ts` | Cron, interval, one-shot scheduled tasks |
| `src/db.ts` | SQLite (messages, sessions, groups, tasks, router) |
| `groups/*/CLAUDE.md` | Per-group persistent memory |

**Customization model:** Fork-based. No YAML/JSON config — "customization = code changes." The codebase is small enough that Claude Code itself helps you modify it via `/customize` and `/add-telegram` skills.

**Security:** Container isolation (Docker or Apple Container). Each agent runs as unprivileged user. Sensitive paths blocked via mount allowlist at `~/.config/nanoclaw/mount-allowlist.json`.

**Scheduled jobs:** Built-in `task-scheduler.ts` supports cron, interval, and one-shot. Users specify tasks conversationally.

**What's missing:** No approval/human-in-the-loop flows. Security relies entirely on container isolation.

**Verdict for lunobot:** Best fit. Small enough to understand completely, has scheduler, memory, multi-channel. We'd need to build approval flows on top.

### NemoClaw (NVIDIA)

- **Announced:** GTC 2026, March 16
- **Status:** Alpha
- **What:** Security/governance layer ON TOP of OpenClaw (not a replacement)
- **Components:** OpenShell (governance runtime) + Nemotron (local models)
- **Purpose:** Enterprise-grade guardrails: policy-based security, network controls, privacy routing, sandboxed environments

**Verdict for lunobot:** Irrelevant. Enterprise governance layer, alpha, overkill for our use case.

**References:**
- https://www.nvidia.com/en-us/ai/nemoclaw/
- https://dev.to/mechcloud_academy/architecting-the-agentic-future-openclaw-vs-nanoclaw-vs-nvidias-nemoclaw-9f8
- https://www.akademie-ki.com/openclaw-nanoclaw-nemoclaw-im-vergleich/

---

## Smaller Frameworks

### Claudegram

- **Repo:** https://github.com/NachoSEO/claudegram
- **Stack:** grammY + Claude Agent SDK, TypeScript
- **Features:** MCP routing, streaming responses, session persistence, voice I/O (Groq Whisper + OpenAI TTS)
- **Built-in tools:** Reddit, Medium, YouTube extraction
- **Commits:** ~143

**Verdict:** Good reference for grammY + Agent SDK integration, but developer-focused. No scheduler, no container isolation.

### ClaudeClaw

- **Repo:** https://github.com/earlyaidopters/claudeclaw
- **Stack:** grammY + Claude CLI subprocess, TypeScript
- **Features:** SQLite with FTS5, voice (Groq Whisper, ElevenLabs TTS), cron scheduler, Gmail/Calendar skills

**Verdict:** Interesting FTS5 memory approach, but spawning Claude CLI as subprocess is less clean than Agent SDK.

### claude-code-telegram

- **Repo:** https://github.com/RichardAtCT/claude-code-telegram
- **Stack:** Python + python-telegram-bot + FastAPI
- **What:** Remote Claude Code access via Telegram (not a general agent)
- **Security:** User allowlist, directory sandboxing, rate limiting, audit logging

**Verdict:** Claude Code remote control, not a general-purpose agent. Python, not TypeScript.

### Claude Code Channels (Anthropic, official)

- **Docs:** https://code.claude.com/docs/en/channels
- **Status:** Research preview
- **What:** MCP server that pushes events into running Claude Code sessions
- **Channels:** Telegram, Discord via official plugins
- **Limitations:** Requires persistent terminal session, claude.ai login (not API key), approved plugins only

**Verdict:** Worth watching but not production-ready. Could make other frameworks partially redundant in future.

---

## Claude Agent SDK

- **Docs:** https://platform.claude.com/docs/en/agent-sdk/overview
- **Package:** `@anthropic-ai/claude-agent-sdk`

The SDK itself provides significant framework capabilities:

**Built-in tools:** Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion

**Custom tools:** Via `createSdkMcpServer` + `tool` helper with Zod schemas

**Other features:**
- Sessions (resume with `sessionId`)
- Subagents
- Hooks (PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd)
- MCP server integration
- Permissions (allowedTools whitelist)
- Skills (from `.claude/skills/`)
- Memory (via CLAUDE.md files)
- Streaming (async iterator)

A minimal Telegram bot with grammY + Agent SDK would be ~300 lines. NanoClaw adds container isolation, multi-channel, scheduler, and group queuing on top.

---

## Decision

**NanoClaw fork** — best balance of features, simplicity, and security for our use case.

What we get for free: scheduler, memory, multi-channel, container isolation, MCP tools, ~15 auditable files.

What we need to build: approval flows (Inline Keyboards), Teable MCP integration, Instagram/LinkedIn tools, luno-specific system prompt.
