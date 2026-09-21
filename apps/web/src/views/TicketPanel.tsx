import { Fragment, useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { useAgents, useLanes, useMoveTicket, useSetFlag, useTicket, useUpdateTicket } from "../lib/hooks";
import { Chip } from "../components/Chip";

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

function metaValue(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function TicketPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const ticket = useTicket(id);
  const lanes = useLanes(ticket.data?.projectId);
  const agents = useAgents().data ?? [];
  const move = useMoveTicket();
  const setFlag = useSetFlag();
  const update = useUpdateTicket();

  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState("");
  const [laneChoice, setLaneChoice] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ticket.data) setTitle(ticket.data.title);
  }, [ticket.data?.id, ticket.data?.title]);

  // The server has spoken: whatever lane it reports is the one to show.
  useEffect(() => {
    setLaneChoice(null);
  }, [ticket.data?.id, ticket.data?.laneId]);

  useEffect(() => {
    if (ticket.data) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.data?.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function saveTitle() {
    const trimmed = title.trim();
    if (!ticket.data || !trimmed || trimmed === ticket.data.title) {
      if (ticket.data) setTitle(ticket.data.title);
      return;
    }
    const previous = ticket.data.title;
    try {
      setTitleError("");
      await update.mutateAsync({ id, patch: { title: trimmed } });
    } catch (e) {
      setTitle(previous);
      setTitleError(e instanceof Error ? e.message : "Could not save the title.");
    }
  }

  if (ticket.isPending) {
    return (
      <aside className="panel" role="dialog" aria-label="Loading ticket">
        <div className="panel-head">
          <span className="mono muted">Loading</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <X size={16} weight="regular" aria-hidden="true" />
          </button>
        </div>
        {[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
      </aside>
    );
  }

  if (ticket.isError || !ticket.data) {
    return (
      <aside className="panel" role="dialog" aria-label="Ticket">
        <div className="panel-head">
          <span className="mono muted">Ticket</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <X size={16} weight="regular" aria-hidden="true" />
          </button>
        </div>
        <p className="error" role="alert">Could not load the ticket.</p>
        <button className="btn" onClick={() => ticket.refetch()}>Try again</button>
      </aside>
    );
  }

  const t = ticket.data;
  const flagged = t.flags.includes("needs_human");
  const laneList = [...(lanes.data ?? [])].sort((a, b) => a.position - b.position);
  const assignee = agents.find((a) => a.id === t.assigneeId);
  const metaEntries = Object.entries(t.metadata);

  return (
    <aside className="panel" role="dialog" aria-label={t.key}>
      <div className="panel-head">
        <span className="mono muted">{t.key}</span>
        <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
          <X size={16} weight="regular" aria-hidden="true" />
        </button>
      </div>
      <input
        className="title-input"
        aria-label="Title"
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      />
      {titleError && <p className="error" role="alert">{titleError}</p>}
      <div className="field">
        <label htmlFor="tp-lane">Lane</label>
        <select
          id="tp-lane"
          className="input"
          value={laneChoice ?? t.laneId}
          disabled={move.isPending}
          onChange={(e) => {
            const laneId = e.target.value;
            setLaneChoice(laneId);
            move.mutate({ id, laneId }, { onError: () => setLaneChoice(null) });
          }}
        >
          {laneList.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      {move.isError && <p className="error" role="alert">{move.error instanceof Error ? move.error.message : "Could not move the ticket."}</p>}
      {t.flags.length > 0 && (
        <div className="chips">
          {t.flags.map((f) => <Chip key={f} family={f === "needs_human" ? "coral" : "stone"}>{f.replace(/_/g, " ")}</Chip>)}
        </div>
      )}
      <button
        type="button"
        className={flagged ? "btn" : "btn ghost"}
        disabled={setFlag.isPending}
        onClick={() => setFlag.mutate({ id, flag: "needs_human", on: !flagged })}
      >
        {flagged ? "Clear needs human" : "Flag for human"}
      </button>
      {setFlag.isError && <p className="error" role="alert">{setFlag.error instanceof Error ? setFlag.error.message : "Could not update the flag."}</p>}
      <dl className="kv">
        <dt>Assignee</dt><dd className="mono">{assignee ? assignee.name : "Unassigned"}</dd>
        <dt>Created</dt><dd className="mono">{when(t.createdAt)}</dd>
        <dt>Updated</dt><dd className="mono">{when(t.updatedAt)}</dd>
      </dl>
      {metaEntries.length > 0 && (
        <>
          <h2>Metadata</h2>
          <dl className="kv">
            {metaEntries.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="mono">{k}</dt>
                <dd className="mono">{metaValue(v)}</dd>
              </Fragment>
            ))}
          </dl>
        </>
      )}
    </aside>
  );
}
