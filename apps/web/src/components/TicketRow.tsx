import { Link } from "react-router-dom";
import type { Actor, Epic, Family, Lane, Tag, Ticket } from "@boomerang/core";
import { Chip, EpicChip, TagChips } from "./Chip";

export const laneFamily = (t: Ticket, lanes: Lane[]): Family =>
  t.flags.includes("needs_human") ? "coral" : lanes.find((l) => l.id === t.laneId)?.family ?? "stone";

export function TicketRow({
  ticket,
  lanes,
  agents,
  epics,
  tags,
  index = 0,
}: {
  ticket: Ticket;
  lanes: Lane[];
  agents: Pick<Actor, "id" | "name">[];
  epics: Epic[];
  tags: Tag[];
  index?: number;
}) {
  const family = laneFamily(ticket, lanes), lane = lanes.find((l) => l.id === ticket.laneId);
  const agent = agents.find((a) => a.id === ticket.assigneeId), tokens = typeof ticket.metadata.tokens === "number" ? ticket.metadata.tokens : null;
  const epic = epics.find((e) => e.id === ticket.epicId);
  const ticketTags = ticket.tagIds.map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => !!t);
  return (
    <Link className="trow enter-row" style={{ "--i": index } as React.CSSProperties} data-ticket={ticket.id} to={`/t/${ticket.id}`}>
      <span className="mark" style={{ background: `var(--${family}-right)` }} aria-hidden="true" />
      <span className="mono muted id">{ticket.key}</span>
      <span className="ttl" title={ticket.title}>{ticket.title}</span>
      {agent && <span className="mono muted ag">{agent.name}</span>}
      {tokens !== null && <span className="mono muted tk">{tokens.toLocaleString("en-US")} tok</span>}
      <EpicChip epic={epic} />
      <TagChips tags={ticketTags} />
      <Chip family={family}>{ticket.flags.includes("needs_human") ? "Needs human" : lane?.name ?? "Unknown lane"}</Chip>
    </Link>
  );
}
// The timer and click-to-filter chip behaviour arrive later (milestone 3 timers, and a future
// click-to-filter interaction on chips); they are absent here, not dead.
