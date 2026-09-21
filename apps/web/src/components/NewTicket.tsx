import { useEffect, useRef, useState } from "react";
import type { Ticket } from "@panorama/core";
import { useCreateTicket } from "../lib/hooks";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function NewTicket({ projectId, onClose }: { projectId: string; onClose: (created?: Ticket) => void }) {
  const [title, setTitle] = useState("");
  const create = useCreateTicket();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => openerRef.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (list.length === 0) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
            <input id="nt-title" ref={titleRef} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
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
