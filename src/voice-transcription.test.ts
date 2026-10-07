/**
 * skill/voice-transcription — which voice messages get transcribed, in what
 * order they reach the router, and how much of the host they may occupy.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import type { InboundMessage } from './channels/adapter.js';
import { createVoiceInterceptor, MAX_PENDING_TRANSCRIPTIONS, VOICE_FALLBACK_TEXT } from './voice-transcription.js';

function chatMessage(text: string, attachments: Array<Record<string, unknown>> = []): InboundMessage {
  return { id: `m-${text}`, kind: 'chat-sdk', timestamp: new Date().toISOString(), content: { text, attachments } };
}
const voice = (text = '') =>
  chatMessage(text, [{ type: 'audio', mimeType: 'audio/ogg', data: Buffer.from('opus').toString('base64') }]);
const textOf = (m: InboundMessage) => (m.content as { text: string }).text;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(over: { transcribe?: (b: Buffer) => Promise<string | null>; wired?: (p: string) => boolean } = {}) {
  const delivered: Array<{ platformId: string; text: string }> = [];
  const host = vi.fn(async (platformId: string, _threadId: string | null, message: InboundMessage) => {
    delivered.push({ platformId, text: textOf(message) });
  });
  const transcribe = vi.fn(over.transcribe ?? (async () => 'hallo welt'));
  const onInbound = createVoiceInterceptor(host, {
    transcribe,
    isWired: async (p) => (over.wired ? over.wired(p) : true),
  });
  return { onInbound, host, transcribe, delivered };
}

describe('createVoiceInterceptor', () => {
  it('transcribes a voice message from a wired chat', async () => {
    const { onInbound, delivered } = setup();
    await onInbound('tg:1', null, voice());
    expect(delivered).toEqual([{ platformId: 'tg:1', text: '[Voice transcript] hallo welt' }]);
  });

  it('keeps a caption below the transcript', async () => {
    const { onInbound, delivered } = setup();
    await onInbound('tg:1', null, voice('caption'));
    expect(delivered[0].text).toBe('[Voice transcript] hallo welt\n\ncaption');
  });

  it('does not transcribe for a chat the router would drop', async () => {
    const { onInbound, transcribe, delivered } = setup({ wired: () => false });
    await onInbound('tg:stranger', null, voice());
    expect(transcribe).not.toHaveBeenCalled();
    expect(delivered).toEqual([{ platformId: 'tg:stranger', text: '' }]);
  });

  it('does not transcribe non-audio attachments', async () => {
    const { onInbound, transcribe } = setup();
    await onInbound('tg:1', null, chatMessage('pic', [{ type: 'image', mimeType: 'audio/ogg', data: 'eA==' }]));
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('still delivers the message, with a fallback, when transcription fails', async () => {
    const failing = setup({ transcribe: async () => null });
    await failing.onInbound('tg:1', null, voice());
    expect(failing.delivered[0].text).toBe(VOICE_FALLBACK_TEXT);

    const throwing = setup({
      transcribe: async () => {
        throw new Error('whisper died');
      },
    });
    await throwing.onInbound('tg:1', null, voice('caption'));
    expect(throwing.delivered[0].text).toBe(`${VOICE_FALLBACK_TEXT}\n\ncaption`);
  });

  it('keeps a chat in order: a text sent after a voice waits for its transcription', async () => {
    const gate = deferred<string | null>();
    const { onInbound, delivered } = setup({ transcribe: () => gate.promise });
    const first = onInbound('tg:1', null, voice());
    const second = onInbound('tg:1', null, chatMessage('after'));
    await new Promise((r) => setTimeout(r, 10));
    expect(delivered).toEqual([]);
    gate.resolve('erst');
    await Promise.all([first, second]);
    expect(delivered.map((d) => d.text)).toEqual(['[Voice transcript] erst', 'after']);
  });

  it('does not hold other chats behind an in-flight transcription', async () => {
    const gate = deferred<string | null>();
    const { onInbound, delivered } = setup({ transcribe: () => gate.promise });
    const slow = onInbound('tg:1', null, voice());
    await onInbound('tg:2', null, chatMessage('other chat'));
    expect(delivered).toEqual([{ platformId: 'tg:2', text: 'other chat' }]);
    gate.resolve('x');
    await slow;
  });

  it('runs one transcription at a time across all chats', async () => {
    let running = 0;
    let peak = 0;
    const { onInbound } = setup({
      transcribe: async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return 'x';
      },
    });
    await Promise.all([
      onInbound('tg:1', null, voice()),
      onInbound('tg:2', null, voice()),
      onInbound('tg:3', null, voice()),
    ]);
    expect(peak).toBe(1);
  });

  it('beyond the pending cap delivers the fallback at once, keeping chat order', async () => {
    const gate = deferred<string | null>();
    const { onInbound, delivered, transcribe } = setup({ transcribe: () => gate.promise });
    const chats = Array.from({ length: MAX_PENDING_TRANSCRIPTIONS + 2 }, (_, i) => `tg:${i}`);
    const runs = chats.map((chat) => onInbound(chat, null, voice()));
    // The same chat's later text still waits behind its own (fallback) voice.
    const lastChat = chats[chats.length - 1];
    const after = onInbound(lastChat, null, chatMessage('after'));
    await new Promise((r) => setTimeout(r, 20));

    // Only the overflow went through, without waiting for whisper.
    expect(delivered.map((d) => d.platformId)).toEqual([chats[chats.length - 2], lastChat, lastChat]);
    expect(delivered.map((d) => d.text)).toEqual([VOICE_FALLBACK_TEXT, VOICE_FALLBACK_TEXT, 'after']);

    gate.resolve('ok');
    await Promise.all([...runs, after]);
    expect(transcribe).toHaveBeenCalledTimes(MAX_PENDING_TRANSCRIPTIONS);
    expect(delivered.filter((d) => d.text === '[Voice transcript] ok')).toHaveLength(MAX_PENDING_TRANSCRIPTIONS);
  });
});
