import { marked, type Token } from "marked";

type AnyToken = Token & { items?: AnyToken[]; tokens?: AnyToken[]; task?: boolean; raw?: string };

/**
 * Walks the same token tree `renderBlocks` (lib/markdown.tsx) parses from, collecting the first
 * line of every task-list item's raw markdown, in document order. Using the parser instead of a
 * per-line regex over the raw source means this agrees with what actually renders as a checkbox:
 * a `- [ ]`-looking line inside a fenced code block is just text inside a "code" token (which has
 * no nested tokens to recurse into, so it is never visited), and a task item inside a blockquote
 * is still found, because blockquote content is walked too. Only the item's *first* line is kept
 * (not its full, nesting-inclusive `raw`) so a parent item's search key can never swallow a nested
 * child's line: marked's list_item.raw for a parent spans its whole nested content, but the
 * checkbox marker itself is always on that raw's first line.
 */
function collectTaskFirstLines(markdown: string): string[] {
  const lines: string[] = [];

  function visitList(listToken: AnyToken) {
    for (const item of listToken.items ?? []) {
      if (item.task) lines.push((item.raw ?? "").split("\n", 1)[0]);
      visitTokens(item.tokens);
    }
  }

  function visitTokens(tokens: AnyToken[] | undefined) {
    if (!tokens) return;
    for (const token of tokens) {
      if (token.type === "list") visitList(token);
      else if (token.tokens) visitTokens(token.tokens);
    }
  }

  visitTokens(marked.lexer(markdown, { gfm: true }) as AnyToken[]);
  return lines;
}

// A task item's first line, once located in the source: leading whitespace/blockquote markers
// are whatever precedes it there (indexOf finds the line wherever it sits), then the bullet, the
// `[ ]`/`[x]` marker, and the rest of that line.
const MARKER_LINE = /^(\s*[-*+]\s+)\[([ xX])\](.*)$/;

/**
 * Rewrites the `index`th task-list item (`- [ ]` / `- [x]`, `*` and `+` bullets, nested lists,
 * and blockquoted items too) in a markdown document to `checked`, counting task items in the same
 * document order they render as checkboxes in (see collectTaskFirstLines). Returns the markdown
 * unchanged if `index` names no task item.
 *
 * Locating the target line in the source: each collected first line is searched for with
 * `indexOf` from a cursor that only advances past lines already consumed, so two identical lines
 * (or a parent whose raw would otherwise contain a nested child's text) never collide with each
 * other's match.
 */
export function toggleTaskItem(markdown: string, index: number, checked: boolean): string {
  const lines = collectTaskFirstLines(markdown);
  if (lines[index] === undefined) return markdown;

  let cursor = 0;
  for (let i = 0; i <= index; i++) {
    const line = lines[i];
    const at = markdown.indexOf(line, cursor);
    if (at === -1) return markdown; // the source and the parse disagree; never corrupt the document
    if (i === index) {
      const match = MARKER_LINE.exec(line);
      if (!match) return markdown;
      const [, prefix, , rest] = match;
      const replacement = `${prefix}[${checked ? "x" : " "}]${rest}`;
      return markdown.slice(0, at) + replacement + markdown.slice(at + line.length);
    }
    cursor = at + line.length;
  }
  return markdown;
}
