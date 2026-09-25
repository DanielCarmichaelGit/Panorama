import type { EvidenceType, LaneRequirement } from "@panorama/core";
import { Picker } from "./Picker";

/**
 * One row per evidence type, in the order the rows were first given. Two rows can end up on the
 * same type once a row's type is changed, and the server refuses that outright, so the larger of
 * the two counts wins: it is the one that satisfies both rows. Applied by the Lanes tab on save.
 */
export function merge(rows: LaneRequirement[]): LaneRequirement[] {
  const out: LaneRequirement[] = [];
  for (const row of rows) {
    const seen = out.find((r) => r.typeId === row.typeId);
    if (seen) seen.count = Math.max(seen.count, row.count);
    else out.push({ ...row });
  }
  return out;
}

/**
 * One row per evidence type requirement: a Picker for the type and a count input. Shared by the
 * Settings Lanes tab (rendered inline, one editor per lane) so both surfaces edit a lane's
 * evidence requirements the same way, entirely through Pickers rather than a native select.
 */
export function RequirementRows({
  rows,
  types,
  onChangeType,
  onChangeCount,
  onRemove,
  onAdd,
}: {
  rows: LaneRequirement[];
  types: EvidenceType[];
  onChangeType: (index: number, typeId: string) => void;
  onChangeCount: (index: number, count: number) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  return (
    <>
      {rows.map((r, i) => (
        <div className="req-row" key={i}>
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
              className="input"
              type="number"
              min={1}
              max={20}
              value={r.count}
              onChange={(e) => onChangeCount(i, Number(e.target.value))}
            />
          </div>
          <button type="button" className="btn ghost" onClick={() => onRemove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn ghost add-req-btn" onClick={onAdd} disabled={rows.length >= types.length}>Add requirement</button>
    </>
  );
}
