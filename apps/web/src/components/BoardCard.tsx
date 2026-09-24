import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDraggable } from "@dnd-kit/core";
import type { Actor, EvidenceType, Lane, Ticket } from "@panorama/core";
import { useGates, useMoveTicket } from "../lib/hooks";
import { Chip } from "./Chip";
import { laneOptionLabel } from "./GateList";
import { laneFamily } from "./TicketRow";

function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
}

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

/**
 * One ticket on the Board: a draggable wrapper (pointer drag only, see `Board`'s sensors) around
 * a real link into the ticket panel, so a plain click still opens it. With the card focused, `m`
 * opens a "Move to" select offering every lane, with the ones its evidence would refuse disabled.
 */
export function BoardCard({ ticket, lanes, agents, types }: { ticket: Ticket; lanes: Lane[]; agents: Pick<Actor, "id" | "name">[]; types: EvidenceType[] }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: ticket.id, attributes: { tabIndex: -1 } });
  const move = useMoveTicket();
  const [moveOpen, setMoveOpen] = useState(false);
  const gates = useGates(moveOpen ? ticket.id : undefined);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (moveOpen) selectRef.current?.focus();
  }, [moveOpen]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "m" || isTypingTarget() || document.querySelector(".modal-back")) return;
    e.preventDefault();
    setMoveOpen(true);
  }

  function chooseLane(laneId: string) {
    move.mutate(
      { id: ticket.id, laneId },
      {
        onSettled: () => {
          setMoveOpen(false);
          window.setTimeout(() => document.querySelector<HTMLElement>(`[data-ticket="${ticket.id}"]`)?.focus(), 0);
        },
      },
    );
  }

  function onSelectKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    setMoveOpen(false);
    window.setTimeout(() => linkRef.current?.focus(), 0);
  }

  return (
    <div ref={setNodeRef} className="bcard" {...listeners} {...attributes}>
      <Link ref={linkRef} to={`/board/t/${ticket.id}`} data-ticket={ticket.id} className="bcard-row" onKeyDown={onKeyDown}>
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
              const missing = gates.data?.[l.id] ?? [];
              const disabled = l.id !== ticket.laneId && missing.length > 0;
              return (
                <option key={l.id} value={l.id} disabled={disabled}>
                  {laneOptionLabel(l, missing, types)}
                </option>
              );
            })}
          </select>
        </div>
      )}
    </div>
  );
}
