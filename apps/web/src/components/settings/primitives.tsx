import { useEffect, useRef } from "react";
import type { Icon } from "@phosphor-icons/react";
import { ApiError } from "../../lib/api";
import { LaneScene } from "../../lib/iso";

/**
 * The building blocks of a Settings tab (spec section 5): one list per tab, rows that show and
 * expand on demand, a compact inline form, an inline confirmation, and a one-line empty state.
 * Every tab holds an `expandedId` ("new" for the add form, a row id for an edit) so only one
 * form is open at a time; these components carry no state of their own beyond focus.
 */

/** The message to show for a failed write: the server's own sentence for an ApiError, else the fallback. */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Header line (muted one-sentence description left, the primary action right) above the list surface. */
export function SettingsSection({ description, action, children }: { description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <div className="settings-head">
        <p className="muted">{description}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One bordered surface; rows are separated by 1px dividers, never by per-row cards. */
export function SettingsList({ children, label }: { children: React.ReactNode; label: string }) {
  return <ul className="settings-list" aria-label={label}>{children}</ul>;
}

/**
 * A row: identity (swatch or chip, name) | facts (chips and muted text) | actions (32px icon
 * buttons). Anything passed as `children` (the expanded form, an inline confirmation, an error)
 * renders below the line, spanning the row.
 */
export function SettingsRow({
  identity,
  facts,
  actions,
  expanded,
  children,
}: {
  identity: React.ReactNode;
  facts?: React.ReactNode;
  actions?: React.ReactNode;
  expanded?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="settings-row" data-expanded={expanded || undefined}>
      <div className="row-id">{identity}</div>
      <div className="row-facts">{facts}</div>
      <div className="row-actions">{actions}</div>
      {children}
    </li>
  );
}

/** A 32px icon button with a tooltip and an accessible name; the tooltip carries the reason when disabled. */
export function RowAction({
  icon: Glyph,
  label,
  onClick,
  disabled,
  reason,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why the action is unavailable; shown as the tooltip instead of the label while disabled. */
  reason?: string;
}) {
  const title = disabled && reason ? reason : label;
  return (
    <button type="button" className="icon-btn" title={title} aria-label={label} disabled={disabled} onClick={onClick}>
      <Glyph size={16} weight="regular" aria-hidden="true" />
    </button>
  );
}

/** The control a freshly opened form should focus: a text input, else the first swatch, else the first checkbox. */
const FIRST_CONTROL = 'input[type="text"], input:not([type]), .color-swatch[tabindex="0"], input[type="checkbox"]';

/**
 * The compact inline form a row expands into (or the add form at the top of the list). Save
 * submits, Cancel and Escape close it; `canSave` gates the submit button and `busy` swaps its
 * label while a write is in flight. Escape already consumed by a nested control (an open Picker
 * closing itself) leaves the form alone. On open the form remembers what was focused (the Edit
 * or Add button that opened it) and moves focus to its first control; on close it hands focus
 * back to that opener if it is still on the page.
 */
export function RowForm({
  onSubmit,
  onCancel,
  canSave,
  busy,
  error,
  label,
  children,
}: {
  onSubmit: () => void;
  onCancel: () => void;
  canSave: boolean;
  busy?: boolean;
  error?: string | null;
  label: string;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    formRef.current?.querySelector<HTMLElement>(FIRST_CONTROL)?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (canSave && !busy) onSubmit();
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      onCancel();
    }
  }
  return (
    <form ref={formRef} className="row-form" aria-label={label} onSubmit={submit} onKeyDown={onKeyDown}>
      {children}
      {error && <p className="error row-error" role="alert">{error}</p>}
      <div className="row-form-actions">
        <button type="submit" className="btn small" disabled={!canSave || busy}>{busy ? "Saving" : "Save"}</button>
        <button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** The inline confirmation below a row: a question, an optional muted note, the destructive action as a small btn, and Cancel. */
export function RowConfirm({
  question,
  note,
  action,
  onConfirm,
  onCancel,
  busy,
}: {
  question: string;
  note?: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="row-confirm">
      <span>{question}</span>
      {note && <span className="muted">{note}</span>}
      <button type="button" className="btn small" onClick={onConfirm} disabled={busy}>{busy ? "Working" : action}</button>
      <button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/** A failed write, shown below the row it belongs to. */
export function RowError({ message }: { message: string }) {
  return <p className="error row-error" role="alert">{message}</p>;
}

/** One line of muted text, with the 96px lane mark when the list is empty for a reason worth a picture. */
export function EmptyRow({ children, mark }: { children: React.ReactNode; mark?: boolean }) {
  return (
    <li className="settings-empty">
      {mark && <LaneScene />}
      <p className="muted">{children}</p>
    </li>
  );
}

/** "n tickets", in the mono meta style, for a tag, arc, or lane row. */
export function Count({ n, noun }: { n: number; noun: string }) {
  return <span className="mono muted">{n} {n === 1 ? noun : `${noun}s`}</span>;
}
