import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { Lane, Project } from "@panorama/core";
import { LaneScene } from "../lib/iso";
import { useAgents, useQueue } from "../lib/hooks";
import { TicketRow } from "../components/TicketRow";
import { NewTicket } from "../components/NewTicket";

function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
}

export function Queue() {
  const { project, lanes } = useOutletContext<{ project: Project; lanes: Lane[] }>();
  const queue = useQueue(project.id);
  const agents = useAgents().data ?? [];
  const [showNew, setShowNew] = useState(false);
  const rowsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const needsHuman = queue.data?.needsHuman ?? [];
  const active = queue.data?.active ?? [];
  const hasQueue = !queue.isPending && !queue.isError;

  useEffect(() => {
    if (!hasQueue || needsHuman.length === 0) return;
    const t = window.setTimeout(() => rowsRef.current?.querySelector<HTMLElement>("a[data-ticket]")?.focus(), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasQueue, needsHuman.length > 0]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget() || showNew) return;
      if (e.key === "c") { e.preventDefault(); setShowNew(true); return; }
      if (e.key === "j" || e.key === "k") {
        const rows = Array.from(document.querySelectorAll<HTMLElement>(".trow"));
        if (rows.length === 0) return;
        const idx = rows.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "j" ? Math.min(idx < 0 ? 0 : idx + 1, rows.length - 1) : Math.max(idx < 0 ? 0 : idx - 1, 0);
        e.preventDefault();
        rows[next]?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showNew]);

  function openTicket(id: string) {
    navigate(`/t/${id}`);
  }

  if (queue.isPending) {
    return (
      <div className="view">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
      </div>
    );
  }

  if (queue.isError) {
    return (
      <div className="view">
        <p className="error" role="alert">Could not load the queue.</p>
        <button className="btn" onClick={() => queue.refetch()}>Try again</button>
      </div>
    );
  }

  const isEmpty = needsHuman.length === 0 && active.length === 0;
  if (isEmpty) {
    return (
      <div className="view">
        <div className="empty">
          <LaneScene />
          <h1>Nothing needs you</h1>
          <p className="muted">Agents are working. Flagged tickets land here.</p>
          <button className="btn" onClick={() => setShowNew(true)}>New ticket</button>
        </div>
        {showNew && <NewTicket projectId={project.id} onClose={() => setShowNew(false)} />}
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-head enter-header">
        <h1><span className="count mono">{needsHuman.length}</span> need you</h1>
        {active.length > 0 && <p className="muted">{active.length} more with agents</p>}
        <div className="spacer" />
        <button className="btn" onClick={() => setShowNew(true)}>New ticket</button>
      </div>
      <div ref={rowsRef}>
        {needsHuman.map((t, i) => (
          <TicketRow key={t.id} ticket={t} lanes={lanes} agents={agents} onOpen={openTicket} index={i} />
        ))}
      </div>
      {active.length > 0 && (
        <>
          <h2 className="section-title">With agents</h2>
          {active.map((t, i) => (
            <TicketRow key={t.id} ticket={t} lanes={lanes} agents={agents} onOpen={openTicket} index={needsHuman.length + i} />
          ))}
        </>
      )}
      {showNew && <NewTicket projectId={project.id} onClose={() => setShowNew(false)} />}
    </div>
  );
}
