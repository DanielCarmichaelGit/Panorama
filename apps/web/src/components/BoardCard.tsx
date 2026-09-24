import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDraggable } from "@dnd-kit/core";
import type { Actor, EvidenceType, Lane, Ticket } from "@panorama/core";
import { ApiError } from "../lib/api";
import { useGates, useMoveTicket, usePrefetchGates } from "../lib/hooks";
import { isTypingTarget } from "../lib/keys";
import { Chip } from "./Chip";
import { laneOptionLabel, missingMessage } from "./GateList";
import { laneFamily } from "./TicketRow";

/**
 * The card's visible content, shared between the interactive card (`BoardCard`) and the static
 * preview `Board` renders in its `DragOverlay` while the card is being dragged.
 */
export function BoardCardContent({ ticket, lanes, agents }: { ticket: Ticket; lanes: Lane[]; agents: Pick<Actor, "id" | "name">[] }) {
  const family = laneFamily(ticket, lanes);
  const agent = agents.find((a) => a.id === ticket.assigneeId);
  return (
    <>
      <span className="mark" style={{ background: `var(--${family}-right)` }} aria-hidden="true" />
      <span className="mono muted id">{ticket.key}</span>
      <span className="ttl" title={ticket.title}>{ticket.title}</span>
      {agent && <span className="mono muted ag">{agent.name}</span>}
      {ticket.flags.includes("needs_human") && <Chip family="coral">Needs human</Chip>}
    </>
  );
}

/** The `ApiError.details.missing` names, or a fallback message, for a failed move. */
function moveErrorMessage(err: unknown): string {
  const details = err instanceof ApiError ? (err.details as { missing?: { name: string }[] } | undefined) : undefined;
  if (details?.missing?.length) return missingMessage(details.missing);
  return err instanceof Error ? err.message : "Could not move the ticket.";
}

/**
 * One ticket on the Board: a draggable wrapper (pointer drag only, see `Board`'s sensors) around
 * a real link into the ticket panel, so a plain click still opens it. With the card focused, `m`
 * opens a "Move to" select offering every lane, with the ones its evidence would refuse disabled.
 * Gates for this ticket are prefetched on pointerdown and on focus, so the drag-activation
 * distance and the "m" shortcut usually already have the data instead of briefly showing every
 * lane as open.
 */
export function BoardCard({ ticket, lanes, agents, types }: { ticket: Ticket; lanes: Lane[]; agents: Pick<Actor, "id" | "name">[]; types: EvidenceType[] }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: ticket.id, attributes: { tabIndex: -1 } });
  const move = useMoveTicket();
  const prefetchGates = usePrefetchGates();
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const gates = useGates(moveOpen ? ticket.id : undefined);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (moveOpen) selectRef.current?.focus();
  }, [moveOpen]);

  function warmGates() {
    void prefetchGates(ticket.id);
  }

  // dnd-kit's own `onPointerDown` (from `listeners`) must still run; we just also warm the gates
  // cache before the drag has a chance to cross its 6px activation distance.
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    warmGates();
    const onDndPointerDown = listeners?.onPointerDown as ((e: React.PointerEvent<HTMLDivElement>) => void) | undefined;
    onDndPointerDown?.(e);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "m" || isTypingTarget() || document.querySelector(".modal-back")) return;
    e.preventDefault();
    setMoveError(null);
    setMoveOpen(true);
  }

  function chooseLane(laneId: string) {
    setMoveError(null);
    move.mutate(
      { id: ticket.id, laneId },
      {
        onSuccess: () => {
          setMoveOpen(false);
          window.setTimeout(() => document.querySelector<HTMLElement>(`[data-ticket="${ticket.id}"]`)?.focus(), 0);
        },
        onError: (err) => setMoveError(moveErrorMessage(err)),
      },
    );
  }

  function closeMove() {
    setMoveOpen(false);
    setMoveError(null);
    window.setTimeout(() => linkRef.current?.focus(), 0);
  }

  function onSelectKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    closeMove();
  }

  return (
    <div ref={setNodeRef} className="bcard" {...listeners} {...attributes} onPointerDown={onPointerDown}>
      <Link ref={linkRef} to={`/board/t/${ticket.id}`} data-ticket={ticket.id} className="bcard-row" onFocus={warmGates} onKeyDown={onKeyDown}>
        <BoardCardContent ticket={ticket} lanes={lanes} agents={agents} />
      </Link>
      {moveOpen && (
        <div className="move-to">
          <label htmlFor={`move-${ticket.id}`}>Move to</label>
          <select
            id={`move-${ticket.id}`}
            ref={selectRef}
            className="input"
            value={ticket.laneId}
            disabled={move.isPending}
            onChange={(e) => chooseLane(e.target.value)}
            onKeyDown={onSelectKeyDown}
          >
            {lanes.map((l) => {
              const same = l.id === ticket.laneId;
              const missing = gates.data?.[l.id] ?? [];
              // Gates not loaded yet: don't pretend a lane is open before we know.
              const disabled = !same && (gates.isPending || missing.length > 0);
              return (
                <option key={l.id} value={l.id} disabled={disabled}>
                  {laneOptionLabel(l, missing, types)}
                </option>
              );
            })}
          </select>
          {moveError && <p className="error" role="alert">{moveError}</p>}
        </div>
      )}
    </div>
  );
}
