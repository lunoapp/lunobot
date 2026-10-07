/**
 * skill/voice-transcription — the whisper.cpp pipeline's resource bounds:
 * audio capped at five minutes, one private temp directory per job, nothing
 * left behind.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { transcribeAudioBuffer, type RunFile } from './transcription.js';

function recordingRunner(over: { whisperFails?: boolean } = {}) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run: RunFile = async (file, args) => {
    calls.push({ file, args });
    if (file === 'ffmpeg') {
      fs.writeFileSync(args[args.length - 1], 'wav');
      return { stdout: '' };
    }
    if (over.whisperFails) throw new Error('whisper exited 1');
    return { stdout: '  hallo welt \n' };
  };
  return { run, calls };
}

describe('transcribeAudioBuffer', () => {
  it('caps the audio at five minutes before whisper sees it', async () => {
    const { run, calls } = recordingRunner();
    await transcribeAudioBuffer(Buffer.from('opus'), run);
    const ffmpeg = calls.find((c) => c.file === 'ffmpeg')!;
    expect(ffmpeg.args).toEqual(expect.arrayContaining(['-t', '300']));
    // -t before the output file caps the decoded output.
    expect(ffmpeg.args.indexOf('-t')).toBeLessThan(ffmpeg.args.length - 1);
  });

  it('returns the trimmed transcript', async () => {
    const { run } = recordingRunner();
    expect(await transcribeAudioBuffer(Buffer.from('opus'), run)).toBe('hallo welt');
  });

  it('works in a private temp directory per job and removes it', async () => {
    const { run, calls } = recordingRunner();
    await transcribeAudioBuffer(Buffer.from('opus'), run);
    await transcribeAudioBuffer(Buffer.from('opus'), run);
    const dirs = calls.filter((c) => c.file === 'ffmpeg').map((c) => path.dirname(c.args[c.args.length - 1]));
    expect(new Set(dirs).size).toBe(2);
    for (const dir of dirs) expect(fs.existsSync(dir)).toBe(false);
  });

  it('returns null and still cleans up when whisper fails', async () => {
    const { run, calls } = recordingRunner({ whisperFails: true });
    expect(await transcribeAudioBuffer(Buffer.from('opus'), run)).toBeNull();
    const dir = path.dirname(calls[0].args[calls[0].args.length - 1]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('returns null for empty audio without running anything', async () => {
    const { run, calls } = recordingRunner();
    expect(await transcribeAudioBuffer(Buffer.alloc(0), run)).toBeNull();
    expect(calls).toEqual([]);
  });
});
