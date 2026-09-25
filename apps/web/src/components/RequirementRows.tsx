import { useLayoutEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";
import type { EvidenceType, LaneRequirement } from "@boomerang/core";
import { Picker } from "./Picker";

/** A requirement as the Lanes tab edits it: typeId, count, and what the evidence should show. */
export type RequirementRow = LaneRequirement;

/**
 * One row per evidence type, in the order the rows were first given. Two rows can end up on the
 * same type once a row's type is changed, and the server refuses that outright, so the larger of
 * the two counts wins: it is the one that satisfies both rows. The first description written
 * wins as well. Applied by the Lanes tab on save.
 */
export function merge(rows: RequirementRow[]): RequirementRow[] {
  const out: RequirementRow[] = [];
  for (const row of rows) {
    const seen = out.find((r) => r.typeId === row.typeId);
    if (seen) {
      seen.count = Math.max(seen.count, row.count);
      if (!seen.description && row.description) seen.description = row.description;
    } else out.push({ ...row });
  }
  return out;
}

/** The rows as the PUT body wants them: trimmed descriptions, and no `description` key at all when there is none. */
export function toRequirements(rows: RequirementRow[]): RequirementRow[] {
  return rows.map((r) => {
    const description = r.description?.trim();
    return description ? { typeId: r.typeId, count: r.count, description } : { typeId: r.typeId, count: r.count };
  });
}

/**
 * A textarea that starts one line tall and grows with its text, so a short description stays a
 * single row. It re-measures when its text changes and when its width does (a narrower column
 * needs more lines for the same text).
 */
function GrowingTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    function fit() {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}

/**
 * One row per evidence type requirement: a Picker for the type, a count input, a Remove button,
 * and under them a description of what the evidence should show. Used by the Settings Lanes tab
 * (one editor per expanded lane), entirely through Pickers rather than a native select.
 */
export function RequirementRows({
  rows,
  types,
  onChangeType,
  onChangeCount,
  onChangeDescription,
  onRemove,
  onAdd,
}: {
  rows: RequirementRow[];
  types: EvidenceType[];
  onChangeType: (index: number, typeId: string) => void;
  onChangeCount: (index: number, count: number) => void;
  onChangeDescription: (index: number, description: string) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="req-rows">
      {rows.map((r, i) => (
        <div className="req-row" key={i}>
          <div className="req-row-top">
            <Picker
              id={`req-type-${i}`}
              label="Evidence type"
              options={types.map((t) => ({ id: t.id, label: t.name }))}
              value={r.typeId}
              onChange={(typeId) => typeId && onChangeType(i, typeId)}
            />
            <div className="field">
              <label htmlFor={`req-count-${i}`}>Count</label>
              <input
                id={`req-count-${i}`}
                className="input mono-input"
                type="number"
                min={1}
                max={20}
                value={r.count}
                onChange={(e) => onChangeCount(i, Number(e.target.value))}
              />
            </div>
            <button type="button" className="icon-btn" title="Remove" aria-label="Remove" onClick={() => onRemove(i)}>
              <X size={14} weight="regular" aria-hidden="true" />
            </button>
          </div>
          <div className="field">
            <label htmlFor={`req-desc-${i}`}>What it should show</label>
            <GrowingTextarea
              id={`req-desc-${i}`}
              className="input req-desc"
              placeholder="Describe the evidence an agent must provide"
              maxLength={2000}
              value={r.description ?? ""}
              onChange={(e) => onChangeDescription(i, e.target.value)}
            />
          </div>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={onAdd} disabled={rows.length >= types.length}>Add requirement</button>
    </div>
  );
}
