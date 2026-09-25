import type { Actor, Ticket } from "@boomerang/core";
import { AgentMark } from "../lib/iso";
import { agentFamily, agentStatusLine, isWorking } from "./AgentCard";

/**
 * "No agents connected yet" when none are active, otherwise "<n> agent(s) connected,
 * <w> working" where working means on a ticket and seen within the last 10 minutes.
 */
export function presenceLine(agents: Actor[], now: Date): string {
  const connected = agents.filter((a) => a.status === "active");
  if (connected.length === 0) return "No agents connected yet";
  const working = connected.filter((a) => isWorking(a, now)).length;
  return `${connected.length} agent${connected.length === 1 ? "" : "s"} connected, ${working} working`;
}

/** A horizontal row of agent marks with a one-line status each, under the Queue header on
 *  every state. Pending agents show up too, in coral, so approval never hides off-screen. */
export function PresenceStrip({ agents, tickets, onOpen }: { agents: Actor[]; tickets: Ticket[]; onOpen: (ticketId: string) => void }) {
  const now = new Date();
  const shown = agents.filter((a) => a.status !== "revoked");
  if (shown.length === 0) return null;
  return (
    <div className="presence-strip" aria-label="Agent presence">
      {shown.map((a) => {
        const ticket = a.currentTicketId ? tickets.find((t) => t.id === a.currentTicketId) : undefined;
        const status = agentStatusLine(a, ticket, now);
        const clickable = !!ticket;
        return (
          <button
            key={a.id}
            type="button"
            className="presence-item"
            onClick={clickable ? () => onOpen(ticket.id) : undefined}
            disabled={!clickable}
          >
            <AgentMark family={agentFamily(a.id)} size={26} />
            <span className="mono presence-name">{a.name}</span>
            <span className={"status" + (status.coral ? " coral" : "")}>{status.text}</span>
          </button>
        );
      })}
    </div>
  );
}
