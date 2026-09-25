import type { Actor, Family, Scopes, Ticket } from "@boomerang/core";
import { AgentMark } from "../lib/iso";

const AGENT_FAMILIES: Family[] = ["sky", "lilac", "mint", "stone"];

/** A stable colour family for an agent's avatar, hashed from its id. Never coral: that
 *  family is reserved for needs-human and pending states, not decided by an agent's id. */
export function agentFamily(agentId: string): Family {
  let sum = 0;
  for (let i = 0; i < agentId.length; i++) sum += agentId.charCodeAt(i);
  return AGENT_FAMILIES[sum % AGENT_FAMILIES.length];
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

/** True when an agent is on a ticket and was seen recently enough to still be "working" it. */
export function isWorking(agent: Actor, now: Date): boolean {
  return agent.currentTicketId !== null && agent.lastSeen !== null && now.getTime() - new Date(agent.lastSeen).getTime() <= TEN_MINUTES_MS;
}

function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
}

/** The one-line status shown for an agent, shared by the presence strip and the agent card. */
export function agentStatusLine(agent: Actor, ticket: Ticket | undefined, now: Date): { text: string; coral: boolean } {
  if (agent.status === "pending") return { text: "waiting for approval", coral: true };
  if (isWorking(agent, now) && ticket) return { text: `on ${ticket.key} for ${minutesSince(ticket.updatedAt, now)} min`, coral: false };
  return { text: "idle", coral: false };
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "Never";
}

export function scopeSummary(scopes: Scopes | null): string {
  if (!scopes) return "no access";
  if (scopes.projects === "*") return "all projects";
  const n = scopes.projects.length;
  return `${n} project${n === 1 ? "" : "s"}, ${scopes.actions.length} action${scopes.actions.length === 1 ? "" : "s"}`;
}

export function AgentCard({ agent, ticket, onRevoke, revoking, error }: {
  agent: Actor;
  ticket: Ticket | undefined;
  onRevoke: () => void;
  revoking: boolean;
  error?: string;
}) {
  const status = agentStatusLine(agent, ticket, new Date());
  return (
    <div className="card agent-card">
      <div className="agent-card-head">
        <AgentMark family={agentFamily(agent.id)} size={40} />
        <div>
          <strong>{agent.name}</strong>
          <div className={"status" + (status.coral ? " coral" : "")}>{status.text}</div>
        </div>
      </div>
      <span className="mono muted">{when(agent.lastSeen)}</span>
      <span className="muted">{scopeSummary(agent.scopes)}</span>
      <button type="button" className="btn ghost" onClick={onRevoke} disabled={revoking}>Revoke</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
