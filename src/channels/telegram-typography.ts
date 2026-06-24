/**
 * Mechanical German-typography enforcement for outbound Telegram text.
 *
 * The agent's training default — and several CLAUDE.md memory files mounted
 * into the container (the persona, the luno product repo) — model US em-dashes
 * heavily. A prompt-level instruction does not reliably win against that, so we
 * rewrite em-dashes to en-dashes on the wire. This is model-independent and
 * cannot be overridden by any memory file.
 *
 * `—` (U+2014) becomes `–` (U+2013). Surrounding spaces are preserved, so a
 * spaced "Gedankenstrich" (" — " → " – ") and a rare unspaced one both come out
 * correct. An en-dash is a normal character and survives the adapter's
 * MarkdownV2 round-trip unchanged. Code spans and fenced blocks are left alone.
 */
const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/g;

export function enforceGermanTypography(text: string): string {
  if (!text) return text;
  const code: string[] = [];
  const masked = text.replace(CODE_PATTERN, (m) => `\x00${code.push(m) - 1}\x00`);
  const fixed = masked.replace(/—/g, '–');
  return fixed.replace(/\x00(\d+)\x00/g, (_, i) => code[Number(i)]);
}
