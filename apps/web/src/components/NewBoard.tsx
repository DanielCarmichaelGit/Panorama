import { useState } from "react";
import { FAMILIES, type Board, type Family } from "@panorama/core";
import { useCreateBoard } from "../lib/hooks";
import { useFocusTrap } from "../lib/useFocusTrap";

const FAMILY_LABELS: Record<Family, string> = { coral: "Coral", sky: "Sky", lilac: "Lilac", mint: "Mint", stone: "Stone" };

/**
 * Dialog to create a board inside a project (human only, `board.create`). A board groups
 * tickets the way an epic categorises them; every project starts with one default board, and
 * this is how a second one gets made. Opened from the Board view's "New board" select option.
 */
export function NewBoard({ projectId, onClose }: { projectId: string; onClose: (created?: Board) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [family, setFamily] = useState<Family>("stone");
  const create = useCreateBoard();
  const dialogRef = useFocusTrap<HTMLDivElement>(() => onClose());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || create.isPending) return;
    try {
      const created = await create.mutateAsync({ projectId, name: name.trim(), description: description.trim() || undefined, family });
      onClose(created);
    } catch {
      // create.error renders below
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="new-board-title" ref={dialogRef}>
        <form onSubmit={submit}>
          <h2 id="new-board-title">New board</h2>
          <div className="field">
            <label htmlFor="nb-name">Name</label>
            <input id="nb-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nb-description">Description</label>
            <textarea id="nb-description" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <fieldset className="field swatch-field">
            <legend>Colour</legend>
            <div className="swatch-row">
              {FAMILIES.map((f) => (
                <label key={f} className="swatch-option">
                  <input type="radio" name="nb-family" value={f} checked={family === f} onChange={() => setFamily(f)} />
                  <span className="swatch" style={{ background: `var(--${f}-top)` }} aria-hidden="true" />
                  {FAMILY_LABELS[f]}
                </label>
              ))}
            </div>
          </fieldset>
          {create.isError && (
            <p className="error" role="alert">{create.error instanceof Error ? create.error.message : "Could not create the board."}</p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => onClose()}>Cancel</button>
            <button type="submit" className="btn" disabled={!name.trim() || create.isPending}>{create.isPending ? "Creating" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
