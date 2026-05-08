---
name: add-voice-transcription
description: Local-whisper voice transcription for Telegram. When the bot receives a voice note, it auto-transcribes via whisper.cpp on the host before the agent sees the message. Triggers on "voice transcription", "whisper", "transcribe voice".
---

# /add-voice-transcription

Adds host-side automatic voice-note transcription to the Telegram channel adapter.

## What it does

When a Telegram voice message arrives:
1. `chat-sdk-bridge` downloads the audio as base64 (already part of v2)
2. The transcription interceptor (this skill) decodes the buffer
3. Calls local `whisper-cli` (whisper.cpp) with German by default
4. Prepends `[Voice transcript] <text>` to the message before it reaches the host router
5. The audio attachment is left intact so the agent can still reference the file

Free, local, fast on Apple Silicon / decent CPUs. No third-party service.

## Apply

Skill ships as a git branch `skill/voice-transcription`. Apply with:

```bash
git fetch origin skill/voice-transcription
git merge origin/skill/voice-transcription
```

If main has moved since this skill was last rebased, expect a tiny conflict at the wrap point in `src/channels/telegram.ts` (around `createPairingInterceptor(...)`). Look for the `// skill/voice-transcription` markers — keep the wrap that calls `createTranscriptionInterceptor`.

## Prereqs (host)

```bash
# Linux
sudo apt install -y ffmpeg
# Build whisper.cpp from source
git clone https://github.com/ggerganov/whisper.cpp ~/whisper.cpp
cd ~/whisper.cpp && make && sudo install -m 755 build/bin/whisper-cli /usr/local/bin/
# Download a model (base = ~150 MB, good DE/EN quality)
bash ~/whisper.cpp/models/download-ggml-model.sh base
mkdir -p ~/data/models && cp ~/whisper.cpp/models/ggml-base.bin ~/data/models/
```

Then in `.env`:

```
WHISPER_BIN=whisper-cli
WHISPER_MODEL=/home/<user>/data/models/ggml-base.bin
WHISPER_LANGUAGE=de
```

## Validate

```bash
echo "Hallo das ist ein Test" | espeak -w /tmp/t.wav
ffmpeg -i /tmp/t.wav -ar 16000 -ac 1 /tmp/t16.wav
whisper-cli -m $WHISPER_MODEL -f /tmp/t16.wav -l de --no-timestamps -nt
```

If the transcript prints, you're done. Restart NanoClaw, send a voice note.

## Files touched

| File | Change |
|------|--------|
| `src/transcription.ts` | NEW — whisper.cpp wrapper |
| `src/channels/telegram.ts` | Wraps `onInbound` with `createTranscriptionInterceptor` |
| `.env.example` | Adds `WHISPER_*` vars |

## Update strategy

When upstream NanoClaw moves and you want fresh `main`:

```bash
git checkout skill/voice-transcription
git fetch upstream
git merge upstream/main   # resolve conflicts in telegram.ts wrap point
git push origin skill/voice-transcription
git checkout main
git merge origin/skill/voice-transcription
```

The `// skill/voice-transcription` comment markers in `src/channels/telegram.ts` make conflicts easy to spot.
