import { useState } from "react";
import type { EvidenceType, Lane, LaneRequirement } from "@panorama/core";
import { useEvidenceTypes, useSetLaneRequirements } from "../../lib/hooks";
import { merge, RequirementRows } from "../RequirementRows";
import { TabState } from "./TabState";

function LaneRow({ lane, types }: { lane: Lane; types: EvidenceType[] }) {
  const setRequirements = useSetLaneRequirements();
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
  function changeType(i: number, typeId: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, typeId } : r)));
  }
  function changeCount(i: number, count: number) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, count } : r)));
  }

  async function save() {
    try {
      await setRequirements.mutateAsync({ id: lane.id, requirements: merge(rows) });
    } catch {
      // setRequirements.error renders below
    }
  }

  return (
    <div className="settings-row lane-settings-row">
      <div className="lane-settings-head">
        <strong>{lane.name}</strong>
        {lane.setsNeedsHuman && (
          <span className="needs-human-mark">
            <span className="dot" aria-hidden="true" />
            Needs human on entry
          </span>
        )}
      </div>
      <RequirementRows rows={rows} types={types} onChangeType={changeType} onChangeCount={changeCount} onRemove={removeRow} onAdd={addRow} />
      {setRequirements.isError && (
        <p className="error" role="alert">{setRequirements.error instanceof Error ? setRequirements.error.message : "Could not save requirements."}</p>
      )}
      <button type="button" className="btn" onClick={save} disabled={setRequirements.isPending}>
        {setRequirements.isPending ? "Saving" : "Save requirements"}
      </button>
    </div>
  );
}

/**
 * Settings tab for the project's lanes, in position order. Lane names and "needs human on entry"
 * come from project setup and have no PATCH route yet, so both are read-only here; only the
 * evidence requirements are editable, through the same Picker-based rows as everywhere else.
 */
export function LanesTab({ lanes }: { lanes: Lane[] }) {
  const evidenceTypes = useEvidenceTypes();
  const list = [...lanes].sort((a, b) => a.position - b.position);

  const state = TabState({ query: evidenceTypes, label: "evidence types" });
  if (state) return state;

  return (
    <div>
      <p className="muted">Lane names are set when a project is created and cannot be renamed yet.</p>
      <div className="settings-list">
        {list.map((lane) => <LaneRow key={lane.id} lane={lane} types={evidenceTypes.data ?? []} />)}
      </div>
    </div>
  );
}
