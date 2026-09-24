// Matches one task-list line: leading whitespace and bullet marker, the `[ ]`/`[x]` marker
// itself, then the rest of the line untouched. A plain bullet with no marker (`- Not a task`)
// simply does not match, so it is invisible to toggleTaskItem: it neither matches nor consumes
// an index.
const TASK_ITEM = /^(\s*[-*+]\s+)\[([ xX])\](.*)$/;

/**
 * Rewrites the `index`th task-list item (`- [ ]` / `- [x]`, `*` and `+` bullets too) in a
 * markdown document to `checked`, counting task items in document order top to bottom, including
 * items nested under others. Returns the markdown unchanged if `index` names no task item.
 */
export function toggleTaskItem(markdown: string, index: number, checked: boolean): string {
  const lines = markdown.split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = TASK_ITEM.exec(lines[i]);
    if (!match) continue;
    if (seen === index) {
      const [, prefix, , rest] = match;
      lines[i] = `${prefix}[${checked ? "x" : " "}]${rest}`;
      return lines.join("\n");
    }
    seen++;
  }
  return markdown;
}
