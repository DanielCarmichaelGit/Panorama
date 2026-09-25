import { useMemo, useState } from "react";
import { Archive, PencilSimple } from "@phosphor-icons/react";
import type { Tag } from "@boomerang/core";
import { useArchiveTag, useCreateTag, useTags, useTickets, useUpdateTag } from "../../lib/hooks";
import { Chip } from "../Chip";
import { ColorField, type ColorValue } from "../ColorField";
import { Count, EmptyRow, RowAction, RowConfirm, RowError, RowForm, SettingsList, SettingsRow, SettingsSection, errorMessage } from "./primitives";
import { TabState } from "./TabState";

const NEW = "new";

function TagForm({
  id,
  initial,
  busy,
  error,
  onSave,
  onClose,
}: {
  id: string;
  initial: { name: string } & ColorValue;
  busy: boolean;
  error: string | null;
  onSave: (v: { name: string } & ColorValue) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [colour, setColour] = useState<ColorValue>({ family: initial.family, color: initial.color });
  return (
    <RowForm label={initial.name ? `Edit ${initial.name}` : "New tag"} onSubmit={() => onSave({ name: name.trim(), ...colour })} onCancel={onClose} canSave={name.trim() !== ""} busy={busy} error={error}>
      <div className="row-form-grid">
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <ColorField id={`${id}-colour`} label="Colour" family={colour.family} color={colour.color} onChange={setColour} />
    </RowForm>
  );
}

function NewTagForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const create = useCreateTag();
  return (
    <TagForm
      id="ntag"
      initial={{ name: "", family: "stone", color: null }}
      busy={create.isPending}
      error={create.isError ? errorMessage(create.error, "Could not create the tag.") : null}
      onSave={(v) => create.mutate({ projectId, name: v.name, family: v.family, color: v.color ?? undefined }, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

function TagRow({ tag, count, expanded, onExpand, onClose }: { tag: Tag; count: number; expanded: boolean; onExpand: () => void; onClose: () => void }) {
  const archive = useArchiveTag();
  const update = useUpdateTag();
  const [confirming, setConfirming] = useState(false);

  return (
    <SettingsRow
      identity={<Chip family={tag.family} color={tag.color}>{tag.name}</Chip>}
      facts={<Count n={count} noun="ticket" />}
      actions={
        !confirming && (
          <>
            <RowAction icon={PencilSimple} label="Edit" onClick={() => { update.reset(); onExpand(); }} />
            <RowAction icon={Archive} label="Archive" onClick={() => { archive.reset(); setConfirming(true); }} />
          </>
        )
      }
      expanded={expanded}
    >
      {archive.isError && <RowError message={errorMessage(archive.error, "Could not archive the tag.")} />}
      {confirming && (
        <RowConfirm
          question={`Archive ${tag.name}?`}
          note="Tickets keep it, but it will not appear as an option."
          action="Archive"
          busy={archive.isPending}
          onConfirm={() => archive.mutate(tag.id, { onSuccess: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      )}
      {expanded && (
        // One PATCH on Save; the colour field's native picker fires on every drag step and none
        // of those reach the server.
        <TagForm
          key={tag.id}
          id={`te-${tag.id}`}
          initial={{ name: tag.name, family: tag.family, color: tag.color }}
          busy={update.isPending}
          error={update.isError ? errorMessage(update.error, "Could not save the tag.") : null}
          onSave={(v) => update.mutate({ id: tag.id, projectId: tag.projectId, patch: { name: v.name, family: v.family, color: v.color } }, { onSuccess: onClose })}
          onClose={onClose}
        />
      )}
    </SettingsRow>
  );
}

/**
 * Settings tab for the project's tags: add with a colour, edit the name and colour in place, and
 * archive. Archiving keeps the tag on tickets already carrying it but stops offering it. The
 * ticket count beside each tag comes from the project's open tickets.
 */
export function TagsTab({ projectId }: { projectId: string }) {
  const tags = useTags(projectId);
  const tickets = useTickets(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const list = useMemo(() => (tags.data ?? []).filter((t) => !t.archived), [tags.data]);
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of tickets.data ?? []) for (const id of t.tagIds) out.set(id, (out.get(id) ?? 0) + 1);
    return out;
  }, [tickets.data]);

  const state = TabState({ query: tags, label: "tags" });
  if (state) return state;

  const close = () => setExpandedId(null);

  return (
    <SettingsSection
      description="Tags are quick labels for filtering. Give each a colour."
      action={<button type="button" className="btn" onClick={() => setExpandedId(NEW)} disabled={expandedId === NEW}>Add tag</button>}
    >
      <SettingsList label="Tags">
        {expandedId === NEW && (
          <li className="settings-row" data-expanded="true">
            <NewTagForm projectId={projectId} onClose={close} />
          </li>
        )}
        {list.length === 0 && expandedId !== NEW && <EmptyRow mark>No tags yet. Add one to label tickets.</EmptyRow>}
        {list.map((t) => (
          <TagRow key={t.id} tag={t} count={counts.get(t.id) ?? 0} expanded={expandedId === t.id} onExpand={() => setExpandedId(t.id)} onClose={close} />
        ))}
      </SettingsList>
    </SettingsSection>
  );
}
