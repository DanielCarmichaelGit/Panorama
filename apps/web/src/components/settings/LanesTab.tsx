import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, PencilSimple, Trash } from "@phosphor-icons/react";
import type { EvidenceType, Lane, UpdateLaneInput } from "@panorama/core";
import { useCreateLane, useDeleteLane, useEvidenceTypes, useLanes, useReorderLanes, useSetLaneRequirements, useTickets, useUpdateLane } from "../../lib/hooks";
import { Chip } from "../Chip";
import { ColorField, type ColorValue } from "../ColorField";
import { merge, RequirementRows, toRequirements, type RequirementRow } from "../RequirementRows";
import { Count, EmptyRow, FocusInput, RowAction, RowConfirm, RowError, RowForm, SettingsList, SettingsRow, SettingsSection, errorMessage } from "./primitives";
import { TabState } from "./TabState";

const NEW = "new";

/** "Needs Eval score, Human sign-off to enter", or "No requirements". */
function requirementSummary(lane: Lane, types: EvidenceType[]): string {
  if (lane.evidenceRequirements.length === 0) return "No requirements";
  const names = lane.evidenceRequirements.map((r) => types.find((t) => t.id === r.typeId)?.name ?? r.typeId);
  return `Needs ${names.join(", ")} to enter`;
}

function sameRequirements(a: RequirementRow[], b: RequirementRow[]): boolean {
  const key = (rows: RequirementRow[]) =>
    [...rows].sort((x, y) => x.typeId.localeCompare(y.typeId)).map((r) => `${r.typeId}:${r.count}:${r.description ?? ""}`).join("|");
  return key(a) === key(b);
}

function LaneFlags({ family, setsNeedsHuman, isDone, onFamily, onNeedsHuman, onDone, id }: {
  id: string;
  family: ColorValue["family"];
  setsNeedsHuman: boolean;
  isDone: boolean;
  onFamily: (v: ColorValue) => void;
  onNeedsHuman: (v: boolean) => void;
  onDone: (v: boolean) => void;
}) {
  return (
    <>
      <ColorField id={`${id}-family`} label="Family" family={family} color={null} presets={false} custom={false} onChange={onFamily} />
      <div className="row-form-checks">
        <label className="checkbox-row">
          <input type="checkbox" checked={setsNeedsHuman} onChange={(e) => onNeedsHuman(e.target.checked)} /> Needs human on entry
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={isDone} onChange={(e) => onDone(e.target.checked)} /> Done lane
        </label>
      </div>
    </>
  );
}

function NewLaneForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const create = useCreateLane();
  const [name, setName] = useState("");
  const [family, setFamily] = useState<ColorValue["family"]>("stone");
  const [setsNeedsHuman, setNeedsHuman] = useState(false);
  const [isDone, setDone] = useState(false);

  return (
    <RowForm
      label="New lane"
      onSubmit={() => create.mutate({ projectId, name: name.trim(), family, setsNeedsHuman, isDone }, { onSuccess: onClose })}
      onCancel={onClose}
      canSave={name.trim() !== ""}
      busy={create.isPending}
      error={create.isError ? errorMessage(create.error, "Could not add the lane.") : null}
    >
      <div className="row-form-grid">
        <div className="field">
          <label htmlFor="nl-name">Name</label>
          <FocusInput id="nl-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <LaneFlags id="nl" family={family} setsNeedsHuman={setsNeedsHuman} isDone={isDone} onFamily={(v) => setFamily(v.family)} onNeedsHuman={setNeedsHuman} onDone={setDone} />
    </RowForm>
  );
}

/**
 * The expanded lane: family, the two flags, and the requirement rows. Save sends a PATCH only
 * when the family or a flag changed and a PUT only when the requirements changed, so an
 * untouched form closes without a request and the event log records only real changes.
 */
function EditLaneForm({ lane, types, onClose }: { lane: Lane; types: EvidenceType[]; onClose: () => void }) {
  const update = useLaneUpdate(lane);
  const [family, setFamily] = useState(lane.family);
  const [setsNeedsHuman, setNeedsHuman] = useState(lane.setsNeedsHuman);
  const [isDone, setDone] = useState(lane.isDone);
  const [rows, setRows] = useState<RequirementRow[]>(lane.evidenceRequirements.map((r) => ({ ...r })));

  function addRow() {
    const used = new Set(rows.map((r) => r.typeId));
    const next = types.find((t) => !used.has(t.id)) ?? types[0];
    if (!next) return;
    setRows((rs) => [...rs, { typeId: next.id, count: 1 }]);
  }

  async function submit() {
    const patch: UpdateLaneInput = {};
    if (family !== lane.family) patch.family = family;
    if (setsNeedsHuman !== lane.setsNeedsHuman) patch.setsNeedsHuman = setsNeedsHuman;
    if (isDone !== lane.isDone) patch.isDone = isDone;
    const merged = toRequirements(merge(rows));
    const requirements = sameRequirements(merged, toRequirements(lane.evidenceRequirements)) ? null : merged;
    const ok = await update.save(Object.keys(patch).length ? patch : null, requirements);
    if (ok) onClose();
  }

  return (
    <RowForm label={`Edit ${lane.name}`} onSubmit={submit} onCancel={onClose} canSave busy={update.busy} error={update.error}>
      <LaneFlags id={`le-${lane.id}`} family={family} setsNeedsHuman={setsNeedsHuman} isDone={isDone} onFamily={(v) => setFamily(v.family)} onNeedsHuman={setNeedsHuman} onDone={setDone} />
      <div className="row-form-reqs">
        <span className="options-label">Requirements to enter</span>
        <RequirementRows
          rows={rows}
          types={types}
          onChangeType={(i, typeId) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, typeId } : r)))}
          onChangeCount={(i, count) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, count } : r)))}
          onChangeDescription={(i, description) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, description } : r)))}
          onRemove={(i) => setRows((rs) => rs.filter((_, idx) => idx !== i))}
          onAdd={addRow}
        />
      </div>
    </RowForm>
  );
}

/** The two writes an expanded lane can make, with one busy flag and one error between them. */
function useLaneUpdate(lane: Lane) {
  const patchLane = useUpdateLane();
  const putRequirements = useSetLaneRequirements();
  const [error, setError] = useState<string | null>(null);

  async function save(patch: UpdateLaneInput | null, requirements: RequirementRow[] | null): Promise<boolean> {
    setError(null);
    try {
      if (patch) await patchLane.mutateAsync({ id: lane.id, projectId: lane.projectId, patch });
      if (requirements) await putRequirements.mutateAsync({ id: lane.id, requirements });
      return true;
    } catch (e) {
      setError(errorMessage(e, "Could not save the lane."));
      return false;
    }
  }

  return { save, busy: patchLane.isPending || putRequirements.isPending, error };
}

function LaneRow({
  lane,
  types,
  index,
  count,
  ticketCount,
  onlyDoneLane,
  expanded,
  onExpand,
  onClose,
  onMove,
  moveError,
}: {
  lane: Lane;
  types: EvidenceType[];
  index: number;
  count: number;
  ticketCount: number;
  onlyDoneLane: boolean;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  onMove: (dir: -1 | 1) => void;
  moveError?: string;
}) {
  const remove = useDeleteLane();
  const [confirming, setConfirming] = useState(false);

  const deleteReason =
    ticketCount > 0 ? `Move its ${ticketCount} ${ticketCount === 1 ? "ticket" : "tickets"} first`
    : count === 1 ? "A project keeps at least one lane"
    : onlyDoneLane ? "Add another done lane first"
    : undefined;

  return (
    <SettingsRow
      identity={
        <>
          <span className="row-dot" style={{ background: `var(--${lane.family}-left)` }} aria-hidden="true" />
          <span className="row-name">{lane.name}</span>
        </>
      }
      facts={
        <>
          {lane.setsNeedsHuman && <Chip family="coral">Needs human on entry</Chip>}
          {lane.isDone && <Chip family="mint">Done lane</Chip>}
          <span>{requirementSummary(lane, types)}</span>
          {ticketCount > 0 && <Count n={ticketCount} noun="ticket" />}
        </>
      }
      actions={
        !confirming && (
          <>
            <RowAction icon={PencilSimple} label="Edit" onClick={onExpand} />
            <RowAction icon={ArrowUp} label="Move up" onClick={() => onMove(-1)} disabled={index === 0} />
            <RowAction icon={ArrowDown} label="Move down" onClick={() => onMove(1)} disabled={index === count - 1} />
            <RowAction icon={Trash} label="Delete" onClick={() => { remove.reset(); setConfirming(true); }} disabled={!!deleteReason} reason={deleteReason} />
          </>
        )
      }
      expanded={expanded}
    >
      {moveError && <RowError message={moveError} />}
      {remove.isError && <RowError message={errorMessage(remove.error, "Could not delete the lane.")} />}
      {confirming && (
        <RowConfirm
          question={`Delete ${lane.name}?`}
          action="Delete"
          busy={remove.isPending}
          onConfirm={() => remove.mutate({ id: lane.id, projectId: lane.projectId }, { onSettled: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      )}
      {expanded && <EditLaneForm key={lane.id} lane={lane} types={types} onClose={onClose} />}
    </SettingsRow>
  );
}

/**
 * Settings tab for the project's lanes, in position order: add, reorder, edit the family, the
 * two flags and the evidence requirements, and delete. Names are fixed once created (agents
 * match on them and the event history records them). Delete is disabled here with the reason
 * whenever the server would refuse it: tickets in the lane, the only lane, the only done lane.
 */
export function LanesTab({ projectId }: { projectId: string }) {
  const lanes = useLanes(projectId);
  const evidenceTypes = useEvidenceTypes();
  const tickets = useTickets(projectId);
  const reorder = useReorderLanes();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<{ id: string; message: string } | null>(null);

  const list = useMemo(() => [...(lanes.data ?? [])].sort((a, b) => a.position - b.position), [lanes.data]);
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of tickets.data ?? []) out.set(t.laneId, (out.get(t.laneId) ?? 0) + 1);
    return out;
  }, [tickets.data]);
  const doneLanes = list.filter((l) => l.isDone).length;

  async function move(lane: Lane, dir: -1 | 1) {
    const from = list.findIndex((l) => l.id === lane.id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= list.length) return;
    const ids = list.map((l) => l.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setMoveError(null);
    try {
      await reorder.mutateAsync({ projectId, ids });
    } catch (e) {
      setMoveError({ id: lane.id, message: errorMessage(e, "Could not reorder") });
    }
  }

  const state = TabState({ query: lanes, label: "lanes" }) ?? TabState({ query: evidenceTypes, label: "evidence types" });
  if (state) return state;

  const types = evidenceTypes.data ?? [];
  const close = () => setExpandedId(null);

  return (
    <SettingsSection
      description="Lanes are the stages a ticket moves through. Add stages, set which ones need a human, mark which count as done, and choose the evidence a ticket needs before it can enter one. Names are fixed once created."
      action={<button type="button" className="btn" onClick={() => setExpandedId(NEW)} disabled={expandedId === NEW}>Add lane</button>}
    >
      <SettingsList label="Lanes">
        {expandedId === NEW && (
          <li className="settings-row" data-expanded="true">
            <NewLaneForm projectId={projectId} onClose={close} />
          </li>
        )}
        {list.length === 0 && expandedId !== NEW && <EmptyRow mark>No lanes yet. Add one to give tickets somewhere to go.</EmptyRow>}
        {list.map((lane, i) => (
          <LaneRow
            key={lane.id}
            lane={lane}
            types={types}
            index={i}
            count={list.length}
            ticketCount={counts.get(lane.id) ?? 0}
            onlyDoneLane={lane.isDone && doneLanes === 1}
            expanded={expandedId === lane.id}
            onExpand={() => setExpandedId(lane.id)}
            onClose={close}
            onMove={(dir) => move(lane, dir)}
            moveError={moveError?.id === lane.id ? moveError.message : undefined}
          />
        ))}
      </SettingsList>
    </SettingsSection>
  );
}
