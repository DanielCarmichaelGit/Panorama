import { useState } from "react";
import type { EvidenceType, Lane, LaneRequirement } from "@panorama/core";
import { useSetLaneRequirements } from "../lib/hooks";
import { useFocusTrap } from "../lib/useFocusTrap";

/**
 * One row per evidence type, in the order the rows were first given. Two rows can end up on the
 * same type once a row's type is changed, and the server refuses that outright, so the larger of
 * the two counts wins: it is the one that satisfies both rows.
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
 * Human-signed dialog editing one lane's evidence requirements (`PUT
 * /api/v1/lanes/:id/requirements`). Opened from the Board's lane header.
 */
export function LaneRequirements({ lane, types, onClose }: { lane: Lane; types: EvidenceType[]; onClose: () => void }) {
  const setRequirements = useSetLaneRequirements();
  const dialogRef = useFocusTrap<HTMLDivElement>(onClose);
  const [rows, setRows] = useState<LaneRequirement[]>(lane.evidenceRequirements.map((r) => ({ ...r })));

  function addRow() {
    const used = new Set(rows.map((r) => r.typeId));
    const next = types.find((t) => !used.has(t.id)) ?? types[0];
    if (!next) return;
    setRows((rs) => [...rs, { typeId: next.id, count: 1 }]);
  }

  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  function updateType(i: number, typeId: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, typeId } : r)));
  }

  function updateCount(i: number, count: number) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, count } : r)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await setRequirements.mutateAsync({ id: lane.id, requirements: merge(rows) });
      onClose();
    } catch {
      // setRequirements.error renders below
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="lane-req-title" ref={dialogRef}>
        <form onSubmit={save}>
          <h2 id="lane-req-title">Requirements for {lane.name}</h2>
          {rows.map((r, i) => (
            <div className="req-row" key={i}>
              <div className="field">
                <label htmlFor={`req-type-${i}`}>Evidence type</label>
                <select id={`req-type-${i}`} className="input" value={r.typeId} onChange={(e) => updateType(i, e.target.value)}>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`req-count-${i}`}>Count</label>
                <input
                  id={`req-count-${i}`}
                  className="input"
                  type="number"
                  min={1}
                  max={20}
                  value={r.count}
                  onChange={(e) => updateCount(i, Number(e.target.value))}
                />
              </div>
              <button type="button" className="btn ghost" onClick={() => removeRow(i)}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn ghost add-req-btn" onClick={addRow} disabled={rows.length >= types.length}>Add requirement</button>
          {setRequirements.isError && (
            <p className="error" role="alert">
              {setRequirements.error instanceof Error ? setRequirements.error.message : "Could not save requirements."}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={setRequirements.isPending}>{setRequirements.isPending ? "Saving" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
