import { useMemo, useState } from "react";
import { FAMILIES, type Epic, type Family } from "@panorama/core";
import { useCreateEpic, useEpics, useUpdateEpic } from "../../lib/hooks";
import { swapNeighbour } from "../../lib/reorder";
import { Chip } from "../Chip";
import { Picker } from "../Picker";
import { TabState } from "./TabState";

const FAMILY_LABELS: Record<Family, string> = { coral: "Coral", sky: "Sky", lilac: "Lilac", mint: "Mint", stone: "Stone" };
const FAMILY_OPTIONS = FAMILIES.map((f) => ({ id: f, label: FAMILY_LABELS[f], family: f }));

function NewEpicForm({ projectId }: { projectId: string }) {
  const create = useCreateEpic();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [family, setFamily] = useState<Family>("stone");

  const canCreate = name.trim() !== "" && !create.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    try {
      await create.mutateAsync({ projectId, name: name.trim(), description: description.trim() || undefined, family });
      setName("");
      setDescription("");
    } catch {
      // create.error renders below
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <h2>New epic</h2>
      <div className="field">
        <label htmlFor="ne-name">Name</label>
        <input id="ne-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ne-description">Description</label>
        <textarea id="ne-description" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <Picker id="ne-family" label="Family" options={FAMILY_OPTIONS} value={family} swatch onChange={(v) => v && setFamily(v as Family)} />
      {create.isError && <p className="error" role="alert">{create.error instanceof Error ? create.error.message : "Could not create the epic."}</p>}
      <button type="submit" className="btn" disabled={!canCreate}>{create.isPending ? "Creating" : "Create epic"}</button>
    </form>
  );
}

function EpicRow({
  epic,
  index,
  count,
  onMove,
  moveError,
}: {
  epic: Epic;
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  moveError?: string;
}) {
  const update = useUpdateEpic();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(epic.name);
  const [description, setDescription] = useState(epic.description ?? "");
  const [family, setFamily] = useState<Family>(epic.family);

  function startEdit() {
    setName(epic.name);
    setDescription(epic.description ?? "");
    setFamily(epic.family);
    update.reset();
    setEditing(true);
  }

  const canSave = name.trim() !== "" && !update.isPending;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    try {
      await update.mutateAsync({ id: epic.id, patch: { name: name.trim(), description: description.trim() || null, family } });
      setEditing(false);
    } catch {
      // update.error renders below
    }
  }

  function doArchive() {
    update.mutate({ id: epic.id, patch: { archived: true } }, { onSuccess: () => setConfirming(false) });
  }

  if (editing) {
    return (
      <form className="inline-form" onSubmit={save}>
        <div className="field">
          <label htmlFor={`ee-name-${epic.id}`}>Name</label>
          <input id={`ee-name-${epic.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`ee-description-${epic.id}`}>Description</label>
          <textarea id={`ee-description-${epic.id}`} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Picker id={`ee-family-${epic.id}`} label="Family" options={FAMILY_OPTIONS} value={family} swatch onChange={(v) => v && setFamily(v as Family)} />
        {update.isError && <p className="error" role="alert">{update.error instanceof Error ? update.error.message : "Could not save the epic."}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => { update.reset(); setEditing(false); }}>Cancel</button>
          <button type="submit" className="btn" disabled={!canSave}>{update.isPending ? "Saving" : "Save"}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="settings-row">
      <Chip family={epic.family}>{epic.name}</Chip>
      {epic.description && <span className="muted">{epic.description}</span>}
      <div className="spacer" />
      {moveError && <p className="error" role="alert">{moveError}</p>}
      {update.isError && (
        <p className="error" role="alert">{update.error instanceof Error ? update.error.message : "Could not archive the epic."}</p>
      )}
      {confirming ? (
        <span className="confirm-row">
          Archive {epic.name}? Tickets keep it, but it will not appear as an option.
          <button type="button" className="btn ghost" onClick={doArchive}>Archive</button>
          <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>Keep</button>
        </span>
      ) : (
        <>
          <button type="button" className="btn ghost" onClick={() => onMove(-1)} disabled={index === 0}>Move up</button>
          <button type="button" className="btn ghost" onClick={() => onMove(1)} disabled={index === count - 1}>Move down</button>
          <button type="button" className="btn ghost" onClick={startEdit}>Edit</button>
          <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>Archive</button>
        </>
      )}
    </div>
  );
}

/**
 * Settings tab for the project's epics: create, reorder, edit, and archive. Archiving keeps the
 * epic on tickets already carrying it but drops it from new assignment and this list.
 */
export function EpicsTab({ projectId }: { projectId: string }) {
  const epics = useEpics(projectId);
  const update = useUpdateEpic();
  const [moveError, setMoveError] = useState<{ id: string; message: string } | null>(null);

  const list = useMemo(
    () => [...(epics.data ?? [])].filter((e) => !e.archived).sort((a, b) => a.position - b.position),
    [epics.data],
  );

  async function move(epic: Epic, dir: -1 | 1) {
    const pair = swapNeighbour(list, list.findIndex((e) => e.id === epic.id), dir);
    if (!pair) return;
    setMoveError(null);
    try {
      await Promise.all(pair.map((p) => update.mutateAsync({ id: p.id, patch: { position: p.position } })));
    } catch {
      setMoveError({ id: epic.id, message: "Could not reorder" });
      epics.refetch();
    }
  }

  const state = TabState({ query: epics, label: "epics" });
  if (state) return state;

  return (
    <div>
      {list.length === 0 && <p className="muted">No epics yet. Add one to group related tickets.</p>}
      <NewEpicForm projectId={projectId} />
      <div className="settings-list">
        {list.map((e, i) => (
          <EpicRow
            key={e.id}
            epic={e}
            index={i}
            count={list.length}
            onMove={(dir) => move(e, dir)}
            moveError={moveError?.id === e.id ? moveError.message : undefined}
          />
        ))}
      </div>
    </div>
  );
}
