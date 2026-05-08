# 02 — Source customizations (`src/`)

This section lists every customization carried forward into v2. v2-builtins are dropped on the way (see [index.md](index.md) "Drop list").

---

## C1. Image vision pipeline

**Files:** `src/image.ts` (new file), plus host wiring (channel adapter for Telegram on receive, agent-runner for forward to SDK)

**Intent:** Telegram (or any channel) receives an image attachment → resize via `sharp` (max 1024×1024, JPEG q85) → store in group's `attachments/` dir → reference as `[Image: attachments/img-...jpg]` markdown token in message text → host extracts references with `parseImageReferences()` and forwards files to agent → agent loads as multimodal `ImageContentBlock`.

**Why v2 doesn't have this:** v2's Chat-SDK adapter delivers messages as text, but does not include an image-resize/store pipeline. v2 expects images via files in `additionalDirectories` mounted into the container; we keep our resize-and-reference flow on top.

**Implementation:**

1. Copy `src/image.ts` verbatim (70 lines) — full source:

```typescript
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const MAX_DIMENSION = 1024;
const IMAGE_REF_PATTERN = /\[Image: (attachments\/[^\]]+)\]/g;

export interface ProcessedImage {
  content: string;
  relativePath: string;
}

export interface ImageAttachment {
  relativePath: string;
  mediaType: string;
}

/**
 * Check if a WhatsApp message contains an image.
 * Accepts any object with the Baileys WAMessage shape.
 */
export function isImageMessage(msg: any): boolean {
  return !!msg.message?.imageMessage;
}

export async function processImage(
  buffer: Buffer,
  groupDir: string,
  caption: string,
): Promise<ProcessedImage | null> {
  if (!buffer || buffer.length === 0) return null;

  const resized = await sharp(buffer)
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  const attachDir = path.join(groupDir, 'attachments');
  fs.mkdirSync(attachDir, { recursive: true });

  const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
  const filePath = path.join(attachDir, filename);
  fs.writeFileSync(filePath, resized);

  const relativePath = `attachments/${filename}`;
  const content = caption
    ? `[Image: ${relativePath}] ${caption}`
    : `[Image: ${relativePath}]`;

  return { content, relativePath };
}

export function parseImageReferences(
  messages: Array<{ content: string }>,
): ImageAttachment[] {
  const refs: ImageAttachment[] = [];
  for (const msg of messages) {
    let match: RegExpExecArray | null;
    IMAGE_REF_PATTERN.lastIndex = 0;
    while ((match = IMAGE_REF_PATTERN.exec(msg.content)) !== null) {
      // Always JPEG — processImage() normalizes all images to .jpg
      refs.push({ relativePath: match[1], mediaType: 'image/jpeg' });
    }
  }
  return refs;
}
```

2. Add dependency: `npm install sharp@^0.34.5`

3. **Adapter binding (v2-spezifisch):** v2's Telegram adapter lebt in `src/channels/adapter.ts` und Chat-SDK-bridge. In dem Pfad, in dem eingehende Photo-Messages des Telegram-Bots verarbeitet werden, muss ein Hook auf `processImage()` eingebaut werden:
   - Telegram-Bot-Photo-Event → herunterladen → `await processImage(buffer, groupDir, caption)` → den zurückgegebenen `content` in die NewMessage als `content`-Feld schreiben.
   - **Konkret untersuchen:** `src/channels/chat-sdk-bridge.ts` und `setup/channels/telegram.ts` in v2 main, dort den Hook andocken.

4. **Forward zur Agent-Pipeline:** Vor dem Agent-Spawn `parseImageReferences(missedMessages)` aufrufen, das Ergebnis als ContainerInput-Feld an den Agent-Runner durchreichen. v2's `ContainerInput` muss um `imageAttachments?: Array<{ relativePath: string; mediaType: string }>` erweitert werden — der Agent-Runner reads die Files dann via `path.join('/workspace/group', img.relativePath)` und sendet als `ImageContentBlock` an die SDK (siehe 03-container-customizations.md, Abschnitt C13).

---

## C2. Voice transcription (whisper.cpp)

**Files:** `src/transcription.ts` (new file). 94 lines. Whisper.cpp lokal auf dem Server, kein Cloud-Service.

**Intent:** Telegram-Voice-Message kommt als ogg/opus rein → ffmpeg konvertiert nach 16 kHz mono WAV → `whisper-cli` mit deutschem Modell läuft → Transkript wird in den Message-Text gerendert (`[Voice: <transkript>]`-artig). Falls fehlschlägt: Fallback `[Voice Message - transcription unavailable]`.

**Implementation:**

1. Copy `src/transcription.ts` verbatim (94 lines) — full source:

```typescript
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  path.join(process.cwd(), 'data', 'models', 'ggml-base.bin');
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || 'de';

const FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]';

async function transcribeWithWhisperCpp(
  audioBuffer: Buffer,
): Promise<string | null> {
  const tmpDir = os.tmpdir();
  const id = `nanoclaw-voice-${Date.now()}`;
  const tmpOgg = path.join(tmpDir, `${id}.ogg`);
  const tmpWav = path.join(tmpDir, `${id}.wav`);

  try {
    fs.writeFileSync(tmpOgg, audioBuffer);

    // Convert ogg/opus to 16kHz mono WAV (required by whisper.cpp)
    await execFileAsync(
      'ffmpeg',
      ['-i', tmpOgg, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', tmpWav],
      { timeout: 30_000 },
    );

    const { stdout } = await execFileAsync(
      WHISPER_BIN,
      [
        '-m',
        WHISPER_MODEL,
        '-f',
        tmpWav,
        '-l',
        WHISPER_LANGUAGE,
        '--no-timestamps',
        '-nt',
      ],
      { timeout: 60_000 },
    );

    const transcript = stdout.trim();
    return transcript || null;
  } catch (err) {
    console.error('whisper.cpp transcription failed:', err);
    return null;
  } finally {
    for (const f of [tmpOgg, tmpWav]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* best effort cleanup */
      }
    }
  }
}

/**
 * Transcribe an audio buffer using local whisper.cpp.
 * Channel-agnostic: accepts a raw audio buffer (ogg/opus format).
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
): Promise<string | null> {
  try {
    if (!audioBuffer || audioBuffer.length === 0) {
      console.error('Empty audio buffer');
      return FALLBACK_MESSAGE;
    }

    console.log(`Transcribing audio: ${audioBuffer.length} bytes`);

    const transcript = await transcribeWithWhisperCpp(audioBuffer);

    if (!transcript) {
      return FALLBACK_MESSAGE;
    }

    console.log(`Transcribed voice message: ${transcript.length} chars`);
    return transcript.trim();
  } catch (err) {
    console.error('Transcription error:', err);
    return FALLBACK_MESSAGE;
  }
}
```

2. **Server-Side dependencies (already installed on Hetzner, document for future):**
   - `ffmpeg` (apt: `apt install ffmpeg`)
   - `whisper-cli` binary (built from whisper.cpp source: `git clone https://github.com/ggerganov/whisper.cpp && make` — binary muss in PATH liegen oder via `WHISPER_BIN` env var)
   - Model file: `data/models/ggml-base.bin` (download mit `bash whisper.cpp/models/download-ggml-model.sh base`)

3. **Env vars (add to `.env.example` and document in DEPLOYMENT.md):**
   - `WHISPER_BIN` (default `whisper-cli`)
   - `WHISPER_MODEL` (default `<cwd>/data/models/ggml-base.bin`)
   - `WHISPER_LANGUAGE` (default `de`)

4. **Adapter binding (v2-spezifisch):** Im Telegram-Voice-Receive-Pfad `await transcribeAudioBuffer(buffer)` aufrufen, Result in NewMessage.content als `[Voice: <transcript>]`. Gleicher Hook-Pfad wie Image (siehe C1.3).

---

## C3. Channel-aware text formatting

**Files:** `src/text-styles.ts` (new file, 337 lines), plus router-Hook für outbound formatting.

**Intent:** Claude gibt Standard-Markdown aus. Jeder Channel hat seine eigene Syntax. Das Modul konvertiert Markdown channel-spezifisch:
- **Signal:** richtige Rich-Text-Styles via JSON-RPC (BOLD/ITALIC/STRIKETHROUGH/MONOSPACE/SPOILER) als Range-Liste mit UTF-16-Offsets
- **WhatsApp/Telegram/Slack:** Marker-Substitution (`**bold**` → `*bold*`, `*italic*` → `_italic_`, Headings → `*Title*`, Links → `text (url)` oder `<url|text>` für Slack, `---` entfernen)
- **Discord:** passthrough (Markdown-nativ)
- Code blocks (fenced + inline) sind protected — werden NIE transformiert

**Why v2 doesn't have this:** v2 hat nur `container/skills/slack-formatting/SKILL.md` mit Anweisungen für den Agent ("schreib Slack-Markdown so"). Das ist fragil. Unsere Code-Pipeline ist deterministisch und arbeitet als Post-Processor auf jeglichem Output.

**Implementation:**

1. Copy `src/text-styles.ts` verbatim from v1 (337 lines). The file has two exports:
   - `parseTextStyles(text, channel)` — Marker-Subst für WhatsApp/Telegram/Slack, passthrough für Discord/Signal
   - `parseSignalStyles(rawText)` — strips Markdown, returns `{ text, textStyle: SignalTextStyle[] }` für Signal-Channel (verwendet UTF-16-Offsets)
   - Type export: `ChannelType = 'signal' | 'whatsapp' | 'telegram' | 'slack' | 'discord'`

2. **Router binding:** In v2's `src/router.ts` (oder dem äquivalenten Modul, das outbound-Text formatiert) `formatOutbound(rawText, channel?)` mit Channel-Argument aufrufen:

```typescript
import { parseTextStyles, type ChannelType } from './text-styles.js';

export function formatOutbound(rawText: string, channel?: ChannelType): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return channel ? parseTextStyles(text, channel) : text;
}
```

3. **Channel-Adapter binding:** Bevor Outbound-Text an Telegram (oder einen anderen Channel) geht, mit `parseTextStyles` durchschicken und das Resultat als `Markdown`-Mode-Text senden. Für Signal: `parseSignalStyles()` aufrufen und das `textStyle`-Array an signal-cli's JSON-RPC `textStyle`-Param geben.

4. **Channel-Identifier:** v2's adapter weiß den Channel-Namen (telegram/discord/etc.) — in der ChannelType-enum mappen.

---

## C4. /compact session command

**Files:** `src/session-commands.ts` (new file, 163 lines), plus index/router wiring.

**Intent:** Wenn ein User `/compact` ins Chat schreibt (mit oder ohne Trigger-Prefix), wird das **vor** dem normalen Agent-Aufruf abgefangen, autorisiert (nur Main-Group ODER `is_from_me`), die noch ungelesenen Vor-Messages werden in einer Pre-Compact-Runde an den Agent geschickt, dann wird `/compact` als literal Slash-Command an die SDK durchgereicht. Das löst die SDK-native Kompaktierung aus, ohne den User-Trigger zu kosten.

**Why v2 doesn't have this:** v2 hat `/compact` als ADMIN_COMMAND in `src/router/formatter.ts`, aber **keinen Host-Side-Intercept**, der vor dem Agent-Spawn eingreift und Pre-Compact-Messages getrennt verarbeitet. Unsere `handleSessionCommand`-Logik ist eine Layer darüber.

**Implementation:**

1. Copy `src/session-commands.ts` verbatim (163 lines). Exports:
   - `extractSessionCommand(content, triggerPattern): string | null`
   - `isSessionCommandAllowed(isMainGroup, isFromMe): boolean`
   - `handleSessionCommand(opts): { handled: boolean; success?: boolean }`
   - Interfaces: `AgentResult`, `SessionCommandDeps`

2. **Wiring in v2 — KOMPLEX**, weil v2's Architektur strukturell anders ist (zentraler Host-Router statt Inline-Polling-Loop):
   - In v2's `src/host/router.ts` (oder wo v2 incoming Messages dispatched), **bevor** der normale Agent-Dispatch passiert, `handleSessionCommand` aufrufen mit den passenden Deps.
   - Falls v2 keinen passenden Hook bietet: in den Adapter-Layer (`src/channels/chat-sdk-bridge.ts`?) einbauen, vor `enqueueMessage`.
   - **Schwerer Teil:** v2's session/agent-spawn-API muss aufgerufen werden für die Pre-Compact-Runde — ältere Messages durchlaufen den Agent zur Antwort, danach erst kommt das eigentliche `/compact`.

3. **Container-Side:** `container/agent-runner/src/index.ts` muss `/compact`-Slash-Commands erkennen und an SDK durchgeben (siehe 03-container-customizations.md, C9). v2 hat das vermutlich ähnlich; im Worktree direkt prüfen ob `KNOWN_SESSION_COMMANDS = new Set(['/compact'])` und der frühe Exit-Pfad bereits da sind.

4. **Validation:** `src/session-commands.test.ts` mitübernehmen (Tests sind Verhaltensspezifikation).

---

## C5. Telegram channel — keep functionality, drop our adapter

**Files (in v1):** `src/channels/telegram.ts` (grammy-basiert), `src/channels/telegram.test.ts`

**v2 status:** Telegram ist als Chat-SDK-Adapter in v2 main eingebaut (`src/channels/adapter.ts`, `src/channels/chat-sdk-bridge.ts`, `setup/channels/telegram.ts`).

**Action:**
1. Unsere `src/channels/telegram.ts` und `.test.ts` werden **nicht migriert**.
2. **Aber:** Voice + Image-Hooks (siehe C1.3, C2.4) müssen in v2's Telegram-Adapter eingebaut werden.
3. Nach Worktree-Build: `setup/channels/telegram.ts` von v2 inspizieren — möglicherweise ist es konfigurierbar via Setup-Skill `/add-telegram` oder läuft direkt aus `.env` (`TELEGRAM_BOT_TOKEN`).
4. Keine grammy-Dependency direkt in `package.json` einfügen — v2 zieht es über Chat-SDK rein.

**Risk:** Falls v2's Telegram-Adapter Voice/Image nur passthrough'ed (Datei-Verweis ohne Buffer), müssen unsere Resize+Transkriptions-Hooks am richtigen Punkt eingreifen. Im Worktree konkret das Adapter-Code lesen, dann entscheiden ob Hook-Patch oder Wrapper-Modul.

---

## C6. Drop list (Source files NOT migrated)

| File | Grund |
|---|---|
| `src/credential-proxy.ts` + `.test.ts` | OneCLI ist v2-Default, kein Native-Proxy. |
| `src/container-runtime.ts` + `.test.ts` | v2 hat eigenes (ohne Apple-Container-Conditionals). |
| `src/container-runner.ts` Custom-Anteil (Apple-Container, /dev/null mount, Bridge-IP-Detection) | Apple-Container droppen, Linux-Docker-baseline aus v2 nehmen. **Aber:** Google-SA-Mount + GitHub-App-Key-Mount + .env-Shadowing müssen in v2's container-runner gepatcht werden, siehe 03-container. |
| `src/channels/emacs.ts` + `.test.ts` + `emacs/nanoclaw.el` | User nutzt Emacs nicht. |
| `src/channels/telegram.ts` + `.test.ts` | v2 hat eigenen Adapter (siehe C5). |
| Test files für oben gelistete drops | Mit den Files entsprechend droppen. |

## C7. Cross-cutting source changes (v1 → v2 mapping)

Diese Customizations sind über mehrere Files verstreut und müssen in v2 an äquivalenten Stellen reapplied werden:

| v1 Custom | v2 Ziel |
|---|---|
| `src/index.ts` startCredentialProxy() startup call | **Drop** (kein Native-Proxy) |
| `src/index.ts` handleSessionCommand() in processGroupMessages | In v2's Host-Router-Pendant einbauen (siehe C4.2) |
| `src/index.ts` parseImageReferences() vor runAgent + imageAttachments param | In v2's Agent-Spawn-Pfad einbauen, ContainerInput erweitern (siehe C1.4) |
| `src/index.ts` IPC sendImage callback wiring | v2 hat send_image als MCP-Tool nativ — **drop** |
| `src/router.ts` formatOutbound(rawText, channel?) | Mit text-styles.ts wiederbauen (siehe C3.2) |
| `src/types.ts` Channel.sendImage | v2 hat eigenes Adapter-Interface — **drop** unsere Type-Erweiterung |
| `src/config.ts` CREDENTIAL_PROXY_PORT, PROXY_BIND_HOST | **Drop** (kein Proxy) |
| `src/config.ts` OLLAMA_ADMIN_TOOLS | **Drop** (kein Ollama) |
| `src/config.ts` ONECLI_URL fallback | v2 hat eigenes Default — bei abweichendem Wert in `.env` setzen statt Code |
| `src/config.ts` process.env.TZ if missing | v2 setzt TZ in `src/config.ts` — **drop** |

**Verification after reapply:**
- `npm run build` erfolgreich
- `npm test` grün (mit beibehaltenen `image.test.ts`, `transcription.test.ts` falls vorhanden, `text-styles`-Tests, `session-commands.test.ts`, `formatting.test.ts`)
- `grep -r "credential-proxy\|emacs\|apple-container\|CONTAINER_RUNTIME ===" src/` — sollte leer sein
