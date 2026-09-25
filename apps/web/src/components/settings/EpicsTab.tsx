// Arcs are epics in the API. Every user-facing string here says arc; the hooks, routes, query
// keys, and this file's name keep the API's word.
import { useMemo, useState } from "react";
import { Archive, PencilSimple } from "@phosphor-icons/react";
import type { Epic } from "@boomerang/core";
import { useCreateEpic, useEpics, useTickets, useUpdateEpic } from "../../lib/hooks";
import { Chip } from "../Chip";
import { ColorField, type ColorValue } from "../ColorField";
import { Count, EmptyRow, RowAction, RowConfirm, RowError, RowForm, SettingsList, SettingsRow, SettingsSection } from "./primitives";
import { errorMessage } from "../../lib/errors";
import { tabState } from "./tabState";

const NEW = "new";

interface ArcDraft extends ColorValue {
  name: string;
  description: string;
}

function ArcForm({
  id,
  initial,
  busy,
  error,
  onSave,
  onClose,
}: {
  id: string;
  initial: ArcDraft;
  busy: boolean;
  error: string | null;
  onSave: (v: ArcDraft) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [colour, setColour] = useState<ColorValue>({ family: initial.family, color: initial.color });
  return (
    <RowForm
      label={initial.name ? `Edit ${initial.name}` : "New arc"}
      onSubmit={() => onSave({ name: name.trim(), description: description.trim(), ...colour })}
      onCancel={onClose}
      canSave={name.trim() !== ""}
      busy={busy}
      error={error}
    >
      <div className="row-form-grid">
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-description`}>Description</label>
          <input id={`${id}-description`} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <ColorField id={`${id}-colour`} label="Colour" family={colour.family} color={colour.color} onChange={setColour} />
    </RowForm>
  );
}

function NewArcForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const create = useCreateEpic();
  return (
    <ArcForm
      id="ne"
      initial={{ name: "", description: "", family: "stone", color: null }}
      busy={create.isPending}
      error={create.isError ? errorMessage(create.error, "Could not create the arc.") : null}
      onSave={(v) => create.mutate({ projectId, name: v.name, description: v.description || undefined, family: v.family, color: v.color ?? undefined }, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

function ArcRow({ epic, count, expanded, onExpand, onClose }: { epic: Epic; count: number; expanded: boolean; onExpand: () => void; onClose: () => void }) {
  const update = useUpdateEpic();
  const [confirming, setConfirming] = useState(false);

  return (
    <SettingsRow
      identity={<Chip family={epic.family} color={epic.color}>{epic.name}</Chip>}
      facts={
        <>
          {epic.description && <span className="row-truncate">{epic.description}</span>}
          <Count n={count} noun="ticket" />
        </>
      }
      actions={
        !confirming && (
          <>
            <RowAction icon={PencilSimple} label="Edit" onClick={() => { update.reset(); onExpand(); }} />
            <RowAction icon={Archive} label="Archive" onClick={() => { update.reset(); setConfirming(true); }} />
          </>
        )
      }
      expanded={expanded}
    >
      {!expanded && update.isError && <RowError message={errorMessage(update.error, "Could not archive the arc.")} />}
      {confirming && (
        <RowConfirm
          question={`Archive ${epic.name}?`}
          note="Tickets keep it, but it will not appear as an option."
          action="Archive"
          busy={update.isPending}
          onConfirm={() => update.mutate({ id: epic.id, patch: { archived: true } }, { onSuccess: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      )}
      {expanded && (
        // The colour reaches the server on Save only; the native picker fires on every drag step.
        <ArcForm
          key={epic.id}
          id={`ee-${epic.id}`}
          initial={{ name: epic.name, description: epic.description ?? "", family: epic.family, color: epic.color }}
          busy={update.isPending}
          error={update.isError ? errorMessage(update.error, "Could not save the arc.") : null}
          onSave={(v) => update.mutate({ id: epic.id, patch: { name: v.name, description: v.description || null, family: v.family, color: v.color } }, { onSuccess: onClose })}
          onClose={onClose}
        />
      )}
    </SettingsRow>
  );
}

/**
 * Settings tab for the project's arcs: add, edit (name, description, colour), and archive.
 * Archiving keeps the arc on tickets already carrying it but drops it from new assignment and
 * this list. The ticket count beside each arc comes from the project's open tickets.
 */
export function EpicsTab({ projectId }: { projectId: string }) {
  const epics = useEpics(projectId);
  const tickets = useTickets(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const list = useMemo(
    () => [...(epics.data ?? [])].filter((e) => !e.archived).sort((a, b) => a.position - b.position),
    [epics.data],
  );
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of tickets.data ?? []) if (t.epicId) out.set(t.epicId, (out.get(t.epicId) ?? 0) + 1);
    return out;
  }, [tickets.data]);

  const state = tabState({ query: epics, label: "arcs" });
  if (state) return state;

  const close = () => setExpandedId(null);

  return (
    <SettingsSection
      description="Arcs group tickets into a body of work. Give each a colour so its tickets stand out on the board."
      action={<button type="button" className="btn" onClick={() => setExpandedId(NEW)} disabled={expandedId === NEW}>Add arc</button>}
    >
      <SettingsList label="Arcs">
        {expandedId === NEW && (
          <li className="settings-row" data-expanded="true">
            <NewArcForm projectId={projectId} onClose={close} />
          </li>
        )}
        {list.length === 0 && expandedId !== NEW && <EmptyRow mark>No arcs yet. Add one to group related tickets.</EmptyRow>}
        {list.map((e) => (
          <ArcRow key={e.id} epic={e} count={counts.get(e.id) ?? 0} expanded={expandedId === e.id} onExpand={() => setExpandedId(e.id)} onClose={close} />
        ))}
      </SettingsList>
    </SettingsSection>
  );
}
