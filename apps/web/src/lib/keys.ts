/**
 * True when the document's active element is a form control (or a contenteditable) that should
 * swallow single-key shortcuts like `g`, `c`, `j`/`k`, or `m` rather than have them fire globally.
 * Shared by every view and component that registers its own single-key shortcut.
 */
export function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
}
