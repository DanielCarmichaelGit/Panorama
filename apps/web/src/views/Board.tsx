import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { EvidenceType, Lane, Project, Ticket } from "@panorama/core";
import { ApiError } from "../lib/api";
import { useAgents, useBoard, useEvidenceTypes, useGates, useMoveTicket } from "../lib/hooks";
import { BoardCard, BoardCardContent } from "../components/BoardCard";
import { laneOptionLabel } from "../components/GateList";
import { LaneRequirements } from "../components/LaneRequirements";
import { LaneScene } from "../lib/iso";

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

/** The 422 gate error's `details.missing` names, phrased the way the drop was refused. */
function missingMessage(missing: { name: string }[]): string {
  return `${missing.map((m) => m.name).join(", ")} needed first`;
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
  title: string | undefined;
  error: string | null;
  onOpenRequirements: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: lane.id, disabled: refused });
  return (
    <section className="lane" ref={setNodeRef} aria-disabled={refused ? "true" : undefined} title={title}>
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
  const agents = useAgents().data ?? [];
  const evidenceTypes = useEvidenceTypes().data ?? [];
  const move = useMoveTicket();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropError, setDropError] = useState<DropError | null>(null);
  const [reqLane, setReqLane] = useState<Lane | null>(null);

  const activeGates = useGates(activeId ?? undefined);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const laneList = [...lanes].sort((a, b) => a.position - b.position);
  const tickets = board.data ?? [];
  const groups = groupByLane(tickets, laneList);
  const activeTicket = tickets.find((t) => t.id === activeId) ?? null;

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

  if (board.isPending) {
    return (
      <div className="view">
        <h1>Board</h1>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
      </div>
    );
  }

  if (board.isError) {
    return (
      <div className="view">
        <h1>Board</h1>
        <p className="error" role="alert">Could not load the board.</p>
        <button className="btn" onClick={() => board.refetch()}>Try again</button>
      </div>
    );
  }

  return (
    <div className="view">
      <h1>Board</h1>
      {tickets.length === 0 && <LaneScene />}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="board">
          {laneList.map((lane) => {
            const missing = activeId && lane.id !== activeTicket?.laneId ? activeGates.data?.[lane.id] ?? [] : [];
            const refused = missing.length > 0;
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
                title={refused ? laneOptionLabel(lane, missing, evidenceTypes) : undefined}
                error={dropError?.laneId === lane.id ? dropError.message : null}
                onOpenRequirements={() => setReqLane(lane)}
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
      {reqLane && <LaneRequirements lane={reqLane} types={evidenceTypes} onClose={() => setReqLane(null)} />}
    </div>
  );
}
