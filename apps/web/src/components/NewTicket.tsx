import { useState } from "react";
import type { Ticket } from "@panorama/core";
import { useCreateTicket } from "../lib/hooks";
import { useFocusTrap } from "../lib/useFocusTrap";

export function NewTicket({ projectId, onClose }: { projectId: string; onClose: (created?: Ticket) => void }) {
  const [title, setTitle] = useState("");
  const create = useCreateTicket();
  const dialogRef = useFocusTrap<HTMLDivElement>(() => onClose());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || create.isPending) return;
    try {
      const created = await create.mutateAsync({ projectId, title: title.trim() });
      onClose(created);
    } catch {
      // create.error renders the message below
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="new-ticket-title" ref={dialogRef}>
        <form onSubmit={submit}>
          <h2 id="new-ticket-title">New ticket</h2>
          <div className="field">
            <label htmlFor="nt-title">Title</label>
            <input id="nt-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {create.isError && <p className="error" role="alert">{create.error instanceof Error ? create.error.message : "Could not create the ticket."}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => onClose()}>Cancel</button>
            <button type="submit" className="btn" disabled={!title.trim() || create.isPending}>{create.isPending ? "Creating" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
