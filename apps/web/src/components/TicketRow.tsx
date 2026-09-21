import type { Actor, Family, Lane, Ticket } from "@panorama/core";
import { Chip } from "./Chip";

export const laneFamily = (t: Ticket, lanes: Lane[]): Family =>
  t.flags.includes("needs_human") ? "coral" : lanes.find((l) => l.id === t.laneId)?.family ?? "stone";

export function TicketRow({ ticket, lanes, agents, onOpen, index = 0 }: { ticket: Ticket; lanes: Lane[]; agents: Pick<Actor, "id" | "name">[]; onOpen: (id: string) => void; index?: number }) {
  const family = laneFamily(ticket, lanes), lane = lanes.find((l) => l.id === ticket.laneId);
  const agent = agents.find((a) => a.id === ticket.assigneeId), tokens = typeof ticket.metadata.tokens === "number" ? ticket.metadata.tokens : null;
  return (
    <a className="trow enter-row" style={{ "--i": index } as React.CSSProperties} role="link" tabIndex={0} data-ticket={ticket.id}
      onClick={() => onOpen(ticket.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(ticket.id); }}>
      <span className="mark" style={{ background: `var(--${family}-right)` }} aria-hidden="true" />
      <span className="mono muted id">{ticket.key}</span>
      <span className="ttl" title={ticket.title}>{ticket.title}</span>
      {agent && <span className="mono muted ag">{agent.name}</span>}
      {tokens !== null && <span className="mono muted tk">{tokens.toLocaleString("en-US")} tok</span>}
      <Chip family={family}>{ticket.flags.includes("needs_human") ? "Needs human" : lane?.name ?? "Unknown lane"}</Chip>
    </a>
  );
}
// The epic chip, timer, and state-filter click arrive with epics, timers, and the Board in later milestones; they are absent here, not dead.
