import { useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { Board as BoardType, EvidenceType, Lane, Project, Ticket } from "@panorama/core";
import { ApiError } from "../lib/api";
import { useAgents, useBoard, useBoards, useEvidenceTypes, useGates, useMoveTicket } from "../lib/hooks";
import { BoardCard, BoardCardContent } from "../components/BoardCard";
import { laneOptionLabel, missingMessage } from "../components/GateList";
import { NewBoard } from "../components/NewBoard";
import { NewTicket } from "../components/NewTicket";

const NEW_BOARD_OPTION = "__new";

/** Groups tickets by lane, sorted by position within each lane; every lane gets an entry, even an empty one. */
export function groupByLane(tickets: Ticket[], lanes: Lane[]): Record<string, Ticket[]> {
  const groups: Record<string, Ticket[]> = {};
  for (const lane of lanes) groups[lane.id] = [];
  for (const ticket of tickets) {
    (groups[ticket.laneId] ??= []).push(ticket);
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.position - b.position);
  return groups;
}

interface DropError {
  laneId: string;
  message: string;
}

function LaneColumn({
  lane,
  lanes,
  tickets,
  agents,
  types,
  activeId,
  refused,
  busy,
  title,
  error,
  onOpenRequirements,
}: {
  lane: Lane;
  lanes: Lane[];
  tickets: Ticket[];
  agents: ReturnType<typeof useAgents>["data"];
  types: EvidenceType[];
  activeId: string | null;
  refused: boolean;
  busy: boolean;
  title: string | undefined;
  error: string | null;
  onOpenRequirements: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: lane.id, disabled: refused });
  return (
    <section
      className="lane"
      ref={setNodeRef}
      aria-disabled={refused ? "true" : undefined}
      aria-busy={busy ? "true" : undefined}
      title={title}
    >
      <div className="lane-head">
        <div className="lane-head-top">
          <h2>{lane.name}</h2>
          <span className="mono muted">{tickets.length}</span>
        </div>
        {lane.setsNeedsHuman && (
          <span className="needs-human-mark">
            <span className="dot" aria-hidden="true" />
            Needs human on entry
          </span>
        )}
        <button type="button" className="btn ghost lane-req-btn" onClick={onOpenRequirements}>Requirements</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {tickets.length === 0 ? (
        <p className="muted">No tickets</p>
      ) : (
        tickets.map((t) =>
          t.id === activeId ? (
            <div key={t.id} className="bcard-origin" aria-hidden="true" />
          ) : (
            <BoardCard key={t.id} ticket={t} lanes={lanes} agents={agents ?? []} types={types} />
          ),
        )
      )}
    </section>
  );
}

export function Board() {
  const { project, lanes } = useOutletContext<{ project: Project; lanes: Lane[] }>();
  const board = useBoard(project.id);
  const boardsQuery = useBoards(project.id);
  const agents = useAgents().data ?? [];
  const evidenceTypes = useEvidenceTypes().data ?? [];
  const move = useMoveTicket();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropError, setDropError] = useState<DropError | null>(null);
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [showNewTicket, setShowNewTicket] = useState(false);

  const activeGates = useGates(activeId ?? undefined);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const laneList = [...lanes].sort((a, b) => a.position - b.position);
  const boardList = [...(boardsQuery.data ?? [])].sort((a, b) => a.position - b.position);
  const urlBoardId = searchParams.get("board");
  const selectedBoardId = urlBoardId && boardList.some((b) => b.id === urlBoardId) ? urlBoardId : (boardList[0]?.id ?? "");
  const allTickets = board.data ?? [];
  const tickets = allTickets.filter((t) => t.boardId === selectedBoardId);
  const groups = groupByLane(tickets, laneList);
  const activeTicket = tickets.find((t) => t.id === activeId) ?? null;

  function selectBoard(value: string) {
    if (value === NEW_BOARD_OPTION) { setShowNewBoard(true); return; }
    const next = new URLSearchParams(searchParams);
    next.set("board", value);
    setSearchParams(next, { replace: true });
  }

  function closeNewBoard(created?: BoardType) {
    setShowNewBoard(false);
    if (!created) return;
    const next = new URLSearchParams(searchParams);
    next.set("board", created.id);
    setSearchParams(next, { replace: true });
  }

  function closeNewTicket() {
    setShowNewTicket(false);
  }

  function handleDragStart(e: DragStartEvent) {
    setDropError(null);
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    const ticketId = String(e.active.id);
    const targetLaneId = e.over ? String(e.over.id) : null;
    setActiveId(null);
    if (!targetLaneId) return;
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket || ticket.laneId === targetLaneId) return;
    move.mutate(
      { id: ticketId, laneId: targetLaneId },
      {
        onError: (err) => {
          const details = err instanceof ApiError ? (err.details as { missing?: { name: string }[] } | undefined) : undefined;
          const message = details?.missing?.length
            ? missingMessage(details.missing)
            : err instanceof Error
              ? err.message
              : "Could not move the ticket.";
          setDropError({ laneId: ticket.laneId, message });
        },
      },
    );
  }

  if (board.isPending || boardsQuery.isPending) {
    return (
      <div className="view">
        <h1>Board</h1>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
      </div>
    );
  }

  if (board.isError || boardsQuery.isError) {
    return (
      <div className="view">
        <h1>Board</h1>
        <p className="error" role="alert">Could not load the board.</p>
        <button className="btn" onClick={() => { board.refetch(); boardsQuery.refetch(); }}>Try again</button>
      </div>
    );
  }

  return (
    <div className="view board-view">
      <div className="board-head">
        <h1>Board</h1>
        <div className="field">
          <label htmlFor="board-select">Board</label>
          <select id="board-select" className="input" value={selectedBoardId} onChange={(e) => selectBoard(e.target.value)}>
            {boardList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value={NEW_BOARD_OPTION}>New board</option>
          </select>
        </div>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => setShowNewTicket(true)}>New ticket</button>
      </div>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="board">
          {laneList.map((lane) => {
            const isSource = !!activeId && lane.id === activeTicket?.laneId;
            const dragging = !!activeId && !isSource;
            // Gates for the dragged card haven't landed yet: don't pretend this lane is open
            // before we know either way.
            const busy = dragging && activeGates.isPending;
            const missing = dragging && !busy ? activeGates.data?.[lane.id] ?? [] : [];
            const refused = busy || missing.length > 0;
            const title = busy ? "Checking what this lane needs" : refused ? laneOptionLabel(lane, missing, evidenceTypes) : undefined;
            return (
              <LaneColumn
                key={lane.id}
                lane={lane}
                lanes={laneList}
                tickets={groups[lane.id] ?? []}
                agents={agents}
                types={evidenceTypes}
                activeId={activeId}
                refused={refused}
                busy={busy}
                title={title}
                error={dropError?.laneId === lane.id ? dropError.message : null}
                onOpenRequirements={() => navigate("/settings?tab=lanes")}
              />
            );
          })}
        </div>
        <DragOverlay>
          {activeTicket && (
            <div className="bcard dragging">
              <div className="bcard-row">
                <BoardCardContent ticket={activeTicket} lanes={laneList} agents={agents} />
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {showNewBoard && <NewBoard projectId={project.id} onClose={closeNewBoard} />}
      {showNewTicket && <NewTicket projectId={project.id} boardId={selectedBoardId} returnTo="board" onClose={closeNewTicket} />}
    </div>
  );
}
