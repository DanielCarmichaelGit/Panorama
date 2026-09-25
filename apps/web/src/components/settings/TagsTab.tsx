import { useMemo, useState } from "react";
import type { Tag } from "@panorama/core";
import { ApiError } from "../../lib/api";
import { useArchiveTag, useCreateTag, useTags, useUpdateTag } from "../../lib/hooks";
import { Chip } from "../Chip";
import { ColorField, type ColorValue } from "../ColorField";
import { TabState } from "./TabState";

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.code === "duplicate_tag") return "That name is taken";
  return e instanceof Error ? e.message : fallback;
}

function NewTagForm({ projectId }: { projectId: string }) {
  const create = useCreateTag();
  const [name, setName] = useState("");
  const [colour, setColour] = useState<ColorValue>({ family: "stone", color: null });

  const canCreate = name.trim() !== "" && !create.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    try {
      await create.mutateAsync({ projectId, name: name.trim(), family: colour.family, color: colour.color ?? undefined });
      setName("");
    } catch {
      // create.error renders below
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <h2>New tag</h2>
      <div className="field">
        <label htmlFor="ntag-name">Name</label>
        <input id="ntag-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <ColorField id="ntag-colour" label="Colour" family={colour.family} color={colour.color} onChange={setColour} />
      {create.isError && <p className="error" role="alert">{errorMessage(create.error, "Could not create the tag.")}</p>}
      <button type="submit" className="btn" disabled={!canCreate}>{create.isPending ? "Creating" : "Create tag"}</button>
    </form>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const archive = useArchiveTag();
  const update = useUpdateTag();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(tag.name);
  const [colour, setColour] = useState<ColorValue>({ family: tag.family, color: tag.color });

  function startEdit() {
    setName(tag.name);
    setColour({ family: tag.family, color: tag.color });
    update.reset();
    setEditing(true);
  }

  const canSave = name.trim() !== "" && !update.isPending;

  // One PATCH on Save; the colour field's native picker fires on every drag step and none of
  // those reach the server.
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    try {
      await update.mutateAsync({ id: tag.id, projectId: tag.projectId, patch: { name: name.trim(), family: colour.family, color: colour.color } });
      setEditing(false);
    } catch {
      // update.error renders below
    }
  }

  if (editing) {
    return (
      <form className="inline-form" onSubmit={save}>
        <div className="field">
          <label htmlFor={`te-name-${tag.id}`}>Name</label>
          <input id={`te-name-${tag.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ColorField id={`te-colour-${tag.id}`} label="Colour" family={colour.family} color={colour.color} onChange={setColour} />
        {update.isError && <p className="error" role="alert">{errorMessage(update.error, "Could not save the tag.")}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => { update.reset(); setEditing(false); }}>Cancel</button>
          <button type="submit" className="btn" disabled={!canSave}>{update.isPending ? "Saving" : "Save"}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="settings-row">
      <Chip family={tag.family} color={tag.color}>{tag.name}</Chip>
      <div className="spacer" />
      {archive.isError && (
        <p className="error" role="alert">{archive.error instanceof Error ? archive.error.message : "Could not archive the tag."}</p>
      )}
      {confirming ? (
        <span className="confirm-row">
          Archive {tag.name}? Tickets keep it, but it will not appear as an option.
          <button type="button" className="btn ghost" onClick={() => archive.mutate(tag.id, { onSuccess: () => setConfirming(false) })}>Archive</button>
          <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>Keep</button>
        </span>
      ) : (
        <>
          <button type="button" className="btn ghost" onClick={startEdit}>Edit</button>
          <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>Archive</button>
        </>
      )}
    </div>
  );
}

/**
 * Settings tab for the project's tags: create with a colour, edit the name and colour in place,
 * and archive. Archiving keeps the tag on tickets already carrying it but stops offering it.
 */
export function TagsTab({ projectId }: { projectId: string }) {
  const tags = useTags(projectId);
  const list = useMemo(() => (tags.data ?? []).filter((t) => !t.archived), [tags.data]);

  const state = TabState({ query: tags, label: "tags" });
  if (state) return state;

  return (
    <div>
      {list.length === 0 && <p className="muted">No tags yet. Add one to label tickets.</p>}
      <NewTagForm projectId={projectId} />
      <div className="settings-list">
        {list.map((t) => <TagRow key={t.id} tag={t} />)}
      </div>
    </div>
  );
}
