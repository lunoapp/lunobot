# 01 — Applied Skills

Six upstream skill branches were merged in v1. None are reapplied in v2 — either dropped on user instruction or replaced by v2's native implementation.

| Skill branch | v1 merge | v2 action |
|---|---|---|
| `skill/apple-container` | `b993218` | **Drop** — Linux-server-only, Docker only. v2 ist Docker-nativ. |
| `skill/native-credential-proxy` | `11a4e1f` | **Drop** — User nutzt OneCLI, nicht den nativen Proxy. |
| `skill/emacs` | `d182f2a` | **Drop** — User nutzt Emacs nicht. |
| `skill/channel-formatting` | `fded980` | **Drop merge, keep custom code** — `src/text-styles.ts` als Code-Carry (v2 hat nur `container/skills/slack-formatting/SKILL.md` Anweisungen, keine Code-Pipeline). |
| `skill/compact` | `572fc74` | **Drop merge, keep custom code** — v2's `providers/claude.ts` hat `createPreCompactHook` bereits. Aber unser **Host-Intercept** in `src/session-commands.ts` ist in v2 nicht vorhanden → carry. |
| `skill/ollama-tool` | `b90d522` | **Drop komplett** — User nutzt Ollama nicht. `container/agent-runner/src/ollama-mcp-stdio.ts` wird gelöscht. |

## Custom skills (.claude/skills/)

Viele Skills im `.claude/skills/`-Verzeichnis kamen vom Ausführen upstream-Operational-Skills (`/add-telegram` usw.). Bei v2 verbleiben sie oder werden durch v2-Pendants ersetzt:

- **luno-eigene Skills** (carry verbatim, siehe 04-luno-content.md): `write-luno`, `log-post`, `generate-image`
- **Operational skills von upstream** (kommen mit v2-Worktree mit, kein Action nötig): `setup`, `update-nanoclaw`, `init-onecli`, `customize`, `debug`, `update-skills`, `qodo-pr-resolver`, `get-qodo-rules`, `migrate-from-openclaw`, `migrate-nanoclaw`
- **Channel/Tool-Add-Skills** die nur lokal lagen (kein Apply nötig — v2 hat eigene Versionen oder integrierte Channels): `add-telegram`, `add-whatsapp`, `add-slack`, `add-discord`, `add-gmail`, `add-image-vision`, `add-voice-transcription`, `add-reactions`, `add-telegram-swarm`, `add-karpathy-llm-wiki`, `add-parallel`, `add-pdf-reader`, `add-macos-statusbar`, `add-ollama-tool`, `add-compact`, `channel-formatting`, `convert-to-apple-container`, `use-local-whisper`, `use-native-credential-proxy`, `x-integration`, `claw`

**Action für v2:** Nach Worktree-Checkout sind alle Upstream-Skills in v2 main bereits da. Nur die drei luno-Skills aus dem alten `.claude/skills/` ins neue kopieren.
