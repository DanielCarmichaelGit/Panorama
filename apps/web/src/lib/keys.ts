/**
 * True when the document's active element is a form control (or a contenteditable) that should
 * swallow single-key shortcuts like `g`, `c`, `j`/`k`, or `m` rather than have them fire globally.
 * Shared by every view and component that registers its own single-key shortcut.
 */
export function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
}

/**
 * True while a Picker's popover is open somewhere in the page. A Picker handles its own Escape
 * (closing just the popover) but does not stop the key from bubbling further, since the Board
 * card's "Move to" Picker relies on that bubbling to also return focus to the card. A dialog or
 * panel with its own page-level Escape-to-close (`useFocusTrap`, the ticket panel) should check
 * this from a React `onKeyDown` on its own root and call `stopPropagation` when it is true, so
 * dismissing a dropdown does not also close the dialog underneath it. That check has to happen
 * inside a React handler, not a native `document` listener: React's own state update for the
 * Picker closing is already committed (and the popover already gone) by the time a native
 * `document` listener runs, but a React ancestor's `onKeyDown` fires earlier, before that commit.
 */
export function isPickerOpen(): boolean {
  return !!document.querySelector(".picker-popover");
}
