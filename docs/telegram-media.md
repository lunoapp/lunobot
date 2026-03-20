# Telegram Media Support: Voice Transcription & Image Vision

## Architektur

NanoClaw verarbeitet Medien auf dem **Host** (nicht im Container):

```
Telegram → Host (Download + Vorverarbeitung) → Container (Claude Agent)
```

- **Voice:** Download → ffmpeg (OGG → WAV) → whisper.cpp → Text an Agent
- **Bilder:** Download → sharp (Resize auf max 1024px JPEG) → Base64 an Agent (multimodal)

### Warum auf dem Host?

Container sind **ephemeral** — sie starten pro Nachricht und werden danach gelöscht. Das Whisper-Modell (148MB) bei jedem Start zu laden wäre ineffizient. Der Host macht die "dumme" Vorverarbeitung (Resize, Transkription), der Container die "intelligente" Arbeit (Claude).

## Abhängigkeiten

### Host (macOS)

```bash
brew install whisper-cpp ffmpeg
```

### Host (Linux/Server)

```bash
apt install ffmpeg
# whisper.cpp: aus Source bauen oder als Binary installieren
# Siehe: https://github.com/ggerganov/whisper.cpp
```

### Whisper-Modell

```bash
mkdir -p data/models
curl -L -o data/models/ggml-base.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
```

Modelle: `tiny` (75MB, schneller), `base` (148MB, besser), `small` (466MB, noch besser). `base` ist ein guter Kompromiss.

### npm-Pakete

- `sharp` — Bild-Resize und -Konvertierung
- `@grammyjs/files` — Telegram File-Download (optional, aktuell via fetch gelöst)

### launchd PATH (macOS)

`/opt/homebrew/bin` muss im PATH der `com.nanoclaw.plist` stehen, damit der Service `whisper-cli` und `ffmpeg` findet.

## Konfiguration

Optionale Umgebungsvariablen in `.env`:

```bash
WHISPER_BIN=whisper-cli           # Default: whisper-cli
WHISPER_MODEL=data/models/ggml-base.bin  # Default: data/models/ggml-base.bin
```

## Implementierung

### Dateien

| Datei | Zweck |
|-------|-------|
| `src/transcription.ts` | Channel-agnostische Whisper-Transkription (nimmt Buffer) |
| `src/image.ts` | Channel-agnostische Bildverarbeitung (nimmt Buffer) |
| `src/channels/telegram.ts` | Telegram-spezifischer Download + Integration |
| `container/agent-runner/src/index.ts` | Multimodal-Support (Base64 → Claude) |

### Voice-Pipeline

1. Telegram sendet `message:voice` Event
2. `downloadTelegramFile()` holt OGG-Datei via Bot API
3. `transcribeAudioBuffer()` schreibt Buffer als temp OGG
4. ffmpeg konvertiert zu 16kHz mono WAV
5. whisper-cli transkribiert
6. Transkript wird als `[Voice: <text>]` an den Agent weitergereicht
7. Temp-Dateien werden aufgeräumt

### Bild-Pipeline

1. Telegram sendet `message:photo` Event (mehrere Größen)
2. Größte Version wird via Bot API heruntergeladen
3. `processImage()` resized auf max 1024x1024 und konvertiert zu JPEG (85%)
4. Bild wird in `groups/{name}/attachments/` gespeichert
5. Referenz `[Image: attachments/img-XXX.jpg]` wird an den Agent gesendet
6. Agent-Runner liest Bild als Base64 und sendet es multimodal an Claude

## Anpassung für andere Kanäle

`transcription.ts` und `image.ts` sind **channel-agnostisch** — sie akzeptieren Buffer. Für einen neuen Kanal muss nur der Download implementiert werden:

```typescript
// Beispiel für einen neuen Kanal
const buffer = await downloadFromMyChannel(fileId);
const transcript = await transcribeAudioBuffer(buffer);
const image = await processImage(buffer, groupDir, caption);
```

## Herkunft

Basiert auf den WhatsApp-Skills (`whatsapp/skill/image-vision`, `whatsapp/skill/local-whisper`), adaptiert für Telegram mit grammy. Die WhatsApp-Implementierungen nutzen Baileys-spezifische Downloads, die Telegram-Version nutzt die Telegram Bot API.
