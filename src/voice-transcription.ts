/**
 * skill/voice-transcription — turn inbound voice messages into text before
 * they reach the router.
 *
 * Wraps a channel's `onInbound`. Three rules keep it cheap and correct:
 *
 * - Only chats the router would deliver get transcribed. The router drops a
 *   message whose chat has no wired agent (or was denied) before anything
 *   else; `isWired` asks that same question, so a stranger cannot make the
 *   host run whisper. Per-agent engage and access gates run later, inside the
 *   router, and are not repeated here.
 * - One transcription at a time across all chats: whisper is CPU-bound and
 *   shares the host with every agent container. At most
 *   MAX_PENDING_TRANSCRIPTIONS wait or run; beyond that the fallback text goes
 *   out at once.
 * - Order within a chat is kept. A message from a chat with a transcription in
 *   flight waits for it, so a text sent after a voice note never overtakes it.
 *   Other chats are not held up.
 *
 * A failed transcription still delivers the message, with a fallback text.
 */
import type { ChannelSetup, InboundMessage } from './channels/adapter.js';
import { log } from './log.js';

export const VOICE_FALLBACK_TEXT = '[Voice message — transcription unavailable]';

/**
 * Transcriptions waiting or running, host-wide. Beyond this a voice message is
 * delivered with the fallback text at once: a burst must not queue minutes of
 * whisper work ahead of every chat that sends one.
 */
export const MAX_PENDING_TRANSCRIPTIONS = 5;
let pendingTranscriptions = 0;

export interface VoiceTranscriberDeps {
  /** Transcript, or null when transcription failed. */
  transcribe(audio: Buffer): Promise<string | null>;
  /** Whether the router would deliver a message from this chat at all. */
  isWired(platformId: string): Promise<boolean>;
}

type OnInbound = ChannelSetup['onInbound'];

/** A one-slot mutex: whisper runs for one message at a time, host-wide. */
let transcriptionSlot: Promise<unknown> = Promise.resolve();
function exclusively<T>(job: () => Promise<T>): Promise<T> {
  const run = transcriptionSlot.then(job, job);
  transcriptionSlot = run.catch(() => undefined);
  return run;
}

function voiceAttachment(message: InboundMessage): Buffer | null {
  if (message.kind !== 'chat-sdk' || !message.content || typeof message.content !== 'object') return null;
  const attachments = (message.content as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments as Array<Record<string, unknown>>) {
    if ((a.type === 'audio' || a.type === 'voice') && typeof a.data === 'string') {
      return Buffer.from(a.data, 'base64');
    }
  }
  return null;
}

async function withTranscript(message: InboundMessage, deps: VoiceTranscriberDeps, platformId: string) {
  const audio = voiceAttachment(message);
  if (!audio) return;
  if (!(await deps.isWired(platformId))) return;

  let transcript: string | null = null;
  if (pendingTranscriptions >= MAX_PENDING_TRANSCRIPTIONS) {
    log.warn('Voice transcription queue full — delivering with fallback text', { pending: pendingTranscriptions });
  } else {
    pendingTranscriptions++;
    try {
      transcript = await exclusively(() => deps.transcribe(audio));
    } catch (err) {
      log.warn('Voice transcription failed — delivering with fallback text', { err });
    } finally {
      pendingTranscriptions--;
    }
  }
  const content = message.content as Record<string, unknown>;
  const original = typeof content.text === 'string' ? content.text : '';
  const head = transcript ? `[Voice transcript] ${transcript}` : VOICE_FALLBACK_TEXT;
  content.text = original ? `${head}\n\n${original}` : head;
  if (transcript) log.info('Voice message transcribed', { length: transcript.length });
}

export function createVoiceInterceptor(hostOnInbound: OnInbound, deps: VoiceTranscriberDeps): OnInbound {
  // Tail of each chat's queue; removed once the chat has nothing in flight.
  const chains = new Map<string, Promise<void>>();

  return (platformId, threadId, message) => {
    const previous = chains.get(platformId) ?? Promise.resolve();
    const current = previous.then(async () => {
      try {
        await withTranscript(message, deps, platformId);
      } catch (err) {
        // isWired or the content shape failed; the message still goes through.
        log.warn('Voice preprocessing failed — passing message through', { err });
      }
      await hostOnInbound(platformId, threadId, message);
    });
    const tail = current.catch(() => undefined);
    chains.set(platformId, tail);
    void tail.then(() => {
      if (chains.get(platformId) === tail) chains.delete(platformId);
    });
    return current;
  };
}
