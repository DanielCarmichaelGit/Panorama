import type { EvidenceType, LaneRequirement } from "@panorama/core";
import { Picker } from "./Picker";

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
