import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { Lane, Project } from "@boomerang/core";
import { LaneScene } from "../lib/iso";
import { useAgents, useBoards, useEpics, useQueue, useTags, useTickets } from "../lib/hooks";
import { isTypingTarget } from "../lib/keys";
import { TicketRow } from "../components/TicketRow";
import { NewTicket } from "../components/NewTicket";
import { PresenceStrip, presenceLine } from "../components/PresenceStrip";

export function Queue() {
  const { project, lanes } = useOutletContext<{ project: Project; lanes: Lane[] }>();
  const queue = useQueue(project.id);
  const allTickets = useTickets(project.id);
  const boards = useBoards(project.id).data ?? [];
  const agents = useAgents().data ?? [];
  const epics = useEpics(project.id).data ?? [];
  const tags = useTags(project.id).data ?? [];
  const [showNew, setShowNew] = useState(false);
  const [showAllOpen, setShowAllOpen] = useState(false);
  const rowsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const needsHuman = queue.data?.needsHuman ?? [];
  const active = queue.data?.active ?? [];
  const hasQueue = !queue.isPending && !queue.isError;
  const tickets = allTickets.data ?? [];
  const hasActiveAgents = agents.some((a) => a.status === "active");
  const firstBoardId = [...boards].sort((a, b) => a.position - b.position)[0]?.id ?? "";

  const doneLaneIds = new Set(lanes.filter((l) => l.isDone).map((l) => l.id));
  const shownIds = new Set([...needsHuman, ...active].map((t) => t.id));
  const openTickets = (allTickets.data ?? []).filter((t) => !shownIds.has(t.id) && !doneLaneIds.has(t.laneId));

  function closeNew() {
    setShowNew(false);
  }

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

  const allOpenSection = openTickets.length === 0 ? null : (
    <>
      <button type="button" className="section-toggle" aria-expanded={showAllOpen} onClick={() => setShowAllOpen((v) => !v)}>
        {showAllOpen ? <CaretDown size={16} weight="regular" aria-hidden="true" /> : <CaretRight size={16} weight="regular" aria-hidden="true" />}
        All open tickets <span className="mono">{openTickets.length}</span>
      </button>
      {showAllOpen && openTickets.map((t, i) => (
        <TicketRow key={t.id} ticket={t} lanes={lanes} agents={agents} epics={epics} tags={tags} index={i} />
      ))}
    </>
  );

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

  if (needsHuman.length === 0) {
    return (
      <div className="view">
        <div className="empty">
          <LaneScene />
          {hasActiveAgents ? (
            <>
              <h1>Nothing needs you</h1>
              <p className="muted">{presenceLine(agents, new Date())}</p>
              <button className="btn ghost" onClick={() => setShowNew(true)}>New ticket</button>
            </>
          ) : (
            <>
              <h1>No agents connected yet</h1>
              <p className="muted">Connect an agent and it will start reporting here.</p>
              <div className="empty-actions">
                <button className="btn" onClick={() => navigate("/agents")}>Connect an agent</button>
                <button className="btn ghost" onClick={() => setShowNew(true)}>New ticket</button>
              </div>
            </>
          )}
        </div>
        <PresenceStrip agents={agents} tickets={tickets} onOpen={(id) => navigate(`/t/${id}`)} />
        <div className="rows">
          {active.length > 0 && (
            <>
              <h2 className="section-title">With agents</h2>
              {active.map((t, i) => (
                <TicketRow key={t.id} ticket={t} lanes={lanes} agents={agents} epics={epics} tags={tags} index={i} />
              ))}
            </>
          )}
          {allOpenSection}
        </div>
        {showNew && <NewTicket projectId={project.id} boardId={firstBoardId} returnTo="queue" onClose={closeNew} />}
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-head enter-header">
        <h1><span className="count mono">{needsHuman.length}</span> need you</h1>
        {active.length > 0 && <p className="muted"><span className="mono">{active.length}</span> more with agents</p>}
        <div className="spacer" />
        <button className="btn" onClick={() => setShowNew(true)}>New ticket</button>
      </div>
      <PresenceStrip agents={agents} tickets={tickets} onOpen={(id) => navigate(`/t/${id}`)} />
      <div ref={rowsRef}>
        {needsHuman.map((t, i) => (
          <TicketRow key={t.id} ticket={t} lanes={lanes} agents={agents} epics={epics} tags={tags} index={i} />
        ))}
      </div>
      {active.length > 0 && (
        <>
          <h2 className="section-title">With agents</h2>
          {active.map((t, i) => (
            <TicketRow key={t.id} ticket={t} lanes={lanes} agents={agents} epics={epics} tags={tags} index={needsHuman.length + i} />
          ))}
        </>
      )}
      {allOpenSection}
      {showNew && <NewTicket projectId={project.id} boardId={firstBoardId} returnTo="queue" onClose={closeNew} />}
    </div>
  );
}
