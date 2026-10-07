/**
 * skill/voice-transcription — local whisper.cpp transcription of one audio
 * buffer (ogg/opus as Telegram sends it).
 *
 * Bounds per job: audio is cut at MAX_AUDIO_SECONDS before whisper sees it,
 * every job works in its own mkdtemp directory that is removed afterwards, and
 * both tools run under a timeout. Concurrency and which messages get here at
 * all are decided by the caller (voice-transcription.ts).
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { readEnvFile } from './env.js';
import { log } from './log.js';

export type RunFile = (file: string, args: string[], opts: { timeout: number }) => Promise<{ stdout: string }>;

const execFileAsync: RunFile = async (file, args, opts) => {
  const { stdout } = await promisify(execFile)(file, args, { ...opts, maxBuffer: 1024 * 1024 });
  return { stdout: String(stdout) };
};

// v2 does not load .env into process.env (see src/env.ts). Read once at module
// load via the v2 helper. process.env is still consulted as an override so the
// systemd unit / launchd plist can pin paths if needed.
const env = readEnvFile(['WHISPER_BIN', 'WHISPER_MODEL', 'WHISPER_LANGUAGE']);
const WHISPER_BIN = process.env.WHISPER_BIN || env.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL || env.WHISPER_MODEL || path.join(process.cwd(), 'data', 'models', 'ggml-base.bin');
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || env.WHISPER_LANGUAGE || 'de';

/** Longer voice notes are transcribed up to here; the rest is cut. */
const MAX_AUDIO_SECONDS = 300;

/** Transcript, or null when there is nothing to transcribe or a step failed. */
export async function transcribeAudioBuffer(audio: Buffer, run: RunFile = execFileAsync): Promise<string | null> {
  if (!audio || audio.length === 0) return null;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-voice-'));
  const ogg = path.join(dir, 'in.ogg');
  const wav = path.join(dir, 'in.wav');
  try {
    fs.writeFileSync(ogg, audio, { mode: 0o600 });
    // 16 kHz mono WAV is what whisper.cpp reads; -t caps the decoded length.
    await run(
      'ffmpeg',
      ['-i', ogg, '-t', String(MAX_AUDIO_SECONDS), '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', wav],
      {
        timeout: 60_000,
      },
    );
    const { stdout } = await run(
      WHISPER_BIN,
      ['-m', WHISPER_MODEL, '-f', wav, '-l', WHISPER_LANGUAGE, '--no-timestamps', '-nt'],
      { timeout: 180_000 },
    );
    return stdout.trim() || null;
  } catch (err) {
    log.warn('whisper.cpp transcription failed', { err });
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
