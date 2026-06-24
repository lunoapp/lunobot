/**
 * Mechanical normalization of outbound Telegram text.
 *
 * The agent does not reliably follow the prompt-level formatting rules (it
 * loads several conflicting CLAUDE.md memories and has its own training
 * defaults), so we enforce the few hard, deterministic constraints on the wire
 * instead. Everything here is a pure text rewrite applied right before the
 * @chat-adapter/telegram MarkdownV2 converter; code spans and fenced blocks are
 * masked so none of the rules touch code. Judgment-level things (whether to link
 * an issue, what to say) are NOT handled here — those stay with the agent.
 *
 * Three rules, each fixing an observed real-world breakage:
 *   1. em-dash → en-dash       — German typography ("—" is a US tell).
 *   2. heading → bold          — Telegram has no headings; "#" renders oversized.
 *   3. "•" bullet → "- " item  — "•" is not Markdown list syntax, so "• a\n• b"
 *                                collapses to one run-on line; "-" is a real
 *                                list (hard breaks → one item per line).
 */
const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/g;
const HEADING_PATTERN = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm;
const BULLET_LINE_PATTERN = /^([ \t]*)•[ \t]+/gm;

export function normalizeTelegramOutbound(text: string): string {
  if (!text) return text;

  // Mask code spans/blocks once so no rule rewrites code.
  const code: string[] = [];
  let out = text.replace(CODE_PATTERN, (m) => `\x00${code.push(m) - 1}\x00`);

  out = out.replace(/—/g, '–'); // 1. em-dash → en-dash
  out = out.replace(HEADING_PATTERN, '**$1**'); // 2. heading → bold
  out = out.replace(BULLET_LINE_PATTERN, '$1- '); // 3. "•" → Markdown list item

  return out.replace(/\x00(\d+)\x00/g, (_, i) => code[Number(i)]);
}
