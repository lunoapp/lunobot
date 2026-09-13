/**
 * Mechanical normalization of outbound Telegram text.
 *
 * The agent does not reliably follow the prompt-level formatting rules (it
 * loads several conflicting CLAUDE.md memories and has its own training
 * defaults), so we enforce the few hard, deterministic constraints on the wire
 * instead. Everything here is a pure text rewrite applied before
 * @chat-adapter/telegram sends the text — either through its MarkdownV2
 * converter or, on the rich-message path, as Markdown that Telegram parses
 * itself, so every rule has to hold for both; code spans and fenced blocks are
 * masked so none of the rules touch code. Judgment-level things (whether to link
 * an issue, what to say) are NOT handled here — those stay with the agent.
 *
 * Four rules, each fixing an observed real-world breakage:
 *   1. em-dash → en-dash       — German typography ("—" is a US tell).
 *   2. heading → bold          — Telegram has no headings; "#" renders oversized.
 *   3. "•" bullet → "- " item  — "•" is not Markdown list syntax, so "• a\n• b"
 *                                collapses to one run-on line; "-" is a real
 *                                list (hard breaks → one item per line).
 *   4. line-leading "#word" → "\#word" — the adapter's rich-message path hands
 *                                the Markdown to Telegram unconverted, and
 *                                Telegram reads "#yogaleipzig" at a line start as
 *                                a heading: bold, with the "#" gone. A caption's
 *                                hashtag line is exactly that.
 */
const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/g;
const HEADING_PATTERN = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm;
const BULLET_LINE_PATTERN = /^([ \t]*)•[ \t]+/gm;
// At most three spaces: four make an indented code block, where "\#" would show.
const LINE_HASHTAG_PATTERN = /^( {0,3})#(?=[^\s#])/gm;

export function normalizeTelegramOutbound(text: string): string {
  if (!text) return text;

  // Mask code spans/blocks once so no rule rewrites code.
  const code: string[] = [];
  let out = text.replace(CODE_PATTERN, (m) => `\x00${code.push(m) - 1}\x00`);

  out = out.replace(/—/g, '–'); // 1. em-dash → en-dash
  out = out.replace(HEADING_PATTERN, '**$1**'); // 2. heading → bold
  out = out.replace(BULLET_LINE_PATTERN, '$1- '); // 3. "•" → Markdown list item
  out = out.replace(LINE_HASHTAG_PATTERN, '$1\\#'); // 4. hashtag at line start → escaped

  return out.replace(/\x00(\d+)\x00/g, (_, i) => code[Number(i)]);
}
