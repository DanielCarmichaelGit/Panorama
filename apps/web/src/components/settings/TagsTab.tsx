import { useMemo, useState } from "react";
import { FAMILIES, type Family, type Tag } from "@panorama/core";
import { ApiError } from "../../lib/api";
import { useArchiveTag, useCreateTag, useTags } from "../../lib/hooks";
import { Chip } from "../Chip";
import { Picker } from "../Picker";
import { TabState } from "./TabState";

const FAMILY_LABELS: Record<Family, string> = { coral: "Coral", sky: "Sky", lilac: "Lilac", mint: "Mint", stone: "Stone" };
const FAMILY_OPTIONS = FAMILIES.map((f) => ({ id: f, label: FAMILY_LABELS[f], family: f }));

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.code === "duplicate_tag") return "That name is taken";
  return e instanceof Error ? e.message : fallback;
}

function NewTagForm({ projectId }: { projectId: string }) {
  const create = useCreateTag();
  const [name, setName] = useState("");
  const [family, setFamily] = useState<Family>("stone");

  const canCreate = name.trim() !== "" && !create.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    try {
      await create.mutateAsync({ projectId, name: name.trim(), family });
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
      <Picker id="ntag-family" label="Family" options={FAMILY_OPTIONS} value={family} swatch onChange={(v) => v && setFamily(v as Family)} />
      {create.isError && <p className="error" role="alert">{errorMessage(create.error, "Could not create the tag.")}</p>}
      <button type="submit" className="btn" disabled={!canCreate}>{create.isPending ? "Creating" : "Create tag"}</button>
    </form>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const archive = useArchiveTag();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="settings-row">
      <Chip family={tag.family}>{tag.name}</Chip>
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
        <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>Archive</button>
      )}
    </div>
  );
}

/**
 * Settings tab for the project's tags: create with a family colour, and archive. Tags have no
 * inline edit; a colour or name change means archiving the old one and creating a new tag.
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
