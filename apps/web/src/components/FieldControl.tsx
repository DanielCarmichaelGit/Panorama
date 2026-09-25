import type { FieldDefinition, FieldValue } from "@panorama/core";
import { Picker } from "./Picker";

/**
 * A required field with nothing in it: blank text counts as empty, and a checkbox never does.
 * An unticked box looks like `false`, and `false` is a value, so an untouched required checkbox
 * reads as `false` rather than as missing (the create dialog sends it that way; the panel's
 * "Needs fields" chip does not count it).
 */
export function isFieldEmpty(def: FieldDefinition, value: FieldValue | undefined): boolean {
  if (def.kind === "checkbox") return false;
  if (value === undefined || value === null) return true;
  return def.kind === "text" && value === "";
}

/**
 * The input for one custom field, chosen by the definition's kind: a text, number, or date
 * input, a Picker for a select, a checkbox row for a checkbox. Shared by the ticket panel (which
 * saves on commit) and the New ticket dialog (which only collects a draft), so both surfaces
 * render a field the same way. `onChange` fires on every edit with the field's typed value;
 * `onCommit` fires when the value is settled: on blur for text and number (where typing is
 * still in progress until then), immediately for date, select, and checkbox. Blank text
 * commits as `null`, matching the server's "null clears a field" rule.
 */
export function FieldControl({
  id,
  def,
  value,
  onChange,
  onCommit,
}: {
  id: string;
  def: FieldDefinition;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  onCommit?: (value: FieldValue) => void;
}) {
  function settle(next: FieldValue) {
    onChange(next);
    onCommit?.(next);
  }

  if (def.kind === "text") {
    return (
      <input
        id={id}
        className="input"
        aria-label={def.name}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.(value === "" ? null : value)}
      />
    );
  }
  if (def.kind === "number") {
    return (
      <input
        id={id}
        className="input"
        type="number"
        inputMode="numeric"
        aria-label={def.name}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        onBlur={() => onCommit?.(value)}
      />
    );
  }
  if (def.kind === "date") {
    return (
      <input
        id={id}
        className="input"
        type="date"
        aria-label={def.name}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => settle(e.target.value || null)}
      />
    );
  }
  if (def.kind === "select") {
    return (
      <Picker
        id={id}
        label={def.name}
        hideLabel
        clearable
        value={typeof value === "string" ? value : null}
        onChange={(next) => settle(next)}
        options={def.options.map((o) => ({ id: o.value, label: o.label }))}
      />
    );
  }
  return (
    <label className="checkbox-row">
      <input type="checkbox" checked={value === true} onChange={(e) => settle(e.target.checked)} />
      {def.name}
    </label>
  );
}
