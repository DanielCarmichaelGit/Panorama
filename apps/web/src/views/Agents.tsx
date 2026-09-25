import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { AGENT_ACTIONS, type Actor, type AgentAction, type Lane, type Project, type Scopes } from "@boomerang/core";
import { BoomerangScene } from "../lib/iso";
import { useAgents, useApproveAgent, useProjects, useRevokeAgent, useTickets } from "../lib/hooks";
import { isPickerOpen } from "../lib/keys";
import { useFocusTrap } from "../lib/useFocusTrap";
import { AgentCard } from "../components/AgentCard";
import { Picker } from "../components/Picker";

const ALL_PROJECTS_ID = "*";

export const shortKey = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-4)}`;

export const scopesFromForm = (projects: string[] | "*", actions: AgentAction[]): Scopes => ({
  projects,
  actions: AGENT_ACTIONS.filter((a) => actions.includes(a)),
});

const ACTION_LABELS: Record<AgentAction, string> = {
  read: "Read",
  "ticket.create": "Create tickets",
  "ticket.update": "Edit tickets",
  "ticket.move": "Move tickets",
  "flag.set": "Set flags",
  "comment.add": "Comment",
  "evidence.add": "Attach evidence",
  "attachment.add": "Upload files",
};

function ApproveDialog({ agent, onClose }: { agent: Actor; onClose: () => void }) {
  const projects = useProjects();
  const approve = useApproveAgent();
  const [allProjects, setAllProjects] = useState(true);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [actions, setActions] = useState<AgentAction[]>([...AGENT_ACTIONS]);

  const list = projects.data ?? [];
  const canApprove = (allProjects || projectIds.length > 0) && actions.includes("read") && !approve.isPending;

  const dialogRef = useFocusTrap<HTMLDivElement>(onClose);

  function toggleAction(a: AgentAction) {
    setActions((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  }

  // "All projects" (id "*") and specific projects are mutually exclusive: picking "*" clears
  // the rest, and picking a specific project while "*" was active drops "*" in favour of it,
  // since having both selected at once would be meaningless (specific ids are redundant once
  // every project is already included).
  const projectValues = allProjects ? [ALL_PROJECTS_ID] : projectIds;
  function changeProjects(ids: string[]) {
    if (ids.includes(ALL_PROJECTS_ID) && !allProjects) {
      setAllProjects(true);
      setProjectIds([]);
      return;
    }
    setAllProjects(false);
    setProjectIds(ids.filter((id) => id !== ALL_PROJECTS_ID));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canApprove) return;
    try {
      await approve.mutateAsync({ id: agent.id, scopes: scopesFromForm(allProjects ? "*" : projectIds, actions) });
      onClose();
    } catch {
      // approve.error renders the message below
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-title"
        ref={dialogRef}
        onKeyDown={(e) => {
          // Dismissing the open Projects Picker's popover must not also cancel the whole dialog
          // underneath it; useFocusTrap's own Escape handler runs after this one but only sees
          // the Picker already closed, so it has to be stopped here instead.
          if (e.key === "Escape" && isPickerOpen()) e.stopPropagation();
        }}
      >
        <form onSubmit={submit}>
          <h2 id="approve-title">Approve {agent.name}</h2>
          <Picker
            id="approve-projects"
            label="Projects"
            multi
            options={[{ id: ALL_PROJECTS_ID, label: "All projects" }, ...list.map((p) => ({ id: p.id, label: p.name }))]}
            values={projectValues}
            onChange={changeProjects}
          />
          <div className="field">
            <label>Actions</label>
            {AGENT_ACTIONS.map((a) => (
              <label className="checkbox-row" key={a}>
                <input type="checkbox" checked={actions.includes(a)} onChange={() => toggleAction(a)} /> {ACTION_LABELS[a]}
              </label>
            ))}
          </div>
          {approve.isError && <p className="error" role="alert">{approve.error instanceof Error ? approve.error.message : "Could not approve the agent."}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={!canApprove}>{approve.isPending ? "Approving" : "Approve"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "Never";
}

function PendingCard({ agent, error, onApprove, onReject, working }: {
  agent: Actor; error?: string; onApprove: () => void; onReject: () => void; working: boolean;
}) {
  return (
    <div className="card agent-row pending-card">
      <strong>{agent.name}</strong>
      <span className="mono">{shortKey(agent.publicKey)}</span>
      <span className="mono">registered {when(agent.createdAt)}</span>
      <div className="spacer" />
      <button type="button" className="btn" onClick={onApprove}>Approve</button>
      <button type="button" className="btn ghost" onClick={onReject} disabled={working}>Reject</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function RevokedRow({ agent }: { agent: Actor }) {
  return (
    <div className="card agent-row">
      <strong>{agent.name}</strong>
      <span className="mono muted">{shortKey(agent.publicKey)}</span>
      <span className="mono muted">{when(agent.lastSeen)}</span>
    </div>
  );
}

export function Agents() {
  const agents = useAgents();
  const revoke = useRevokeAgent();
  const outlet = useOutletContext<{ project: Project; lanes: Lane[] } | undefined>();
  const tickets = useTickets(outlet?.project.id).data ?? [];
  const [approving, setApproving] = useState<Actor | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const list = agents.data ?? [];
  const pending = list.filter((a) => a.status === "pending");
  const active = list.filter((a) => a.status === "active");
  const revoked = list.filter((a) => a.status === "revoked");

  // Reject and Revoke are the same call. Failures belong beside the row they failed on.
  function withdraw(id: string) {
    setWorking(id);
    setRowError(null);
    revoke.mutate(id, {
      onError: (e) => setRowError({ id, message: e instanceof Error ? e.message : "Could not update this agent." }),
      onSettled: () => setWorking(null),
    });
  }

  const errorFor = (id: string) => (rowError?.id === id ? rowError.message : undefined);

  if (agents.isPending) {
    return (
      <div className="view">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
      </div>
    );
  }

  if (agents.isError) {
    return (
      <div className="view">
        <p className="error" role="alert">Could not load agents.</p>
        <button className="btn" onClick={() => agents.refetch()}>Try again</button>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="view">
        <div className="empty">
          <BoomerangScene />
          <h1>No agents yet</h1>
          <p className="muted">Register an agent key to see it here.</p>
          <p className="muted">An agent registers itself with its own key. You approve it here before it can touch anything.</p>
          <pre className="codeblock mono">{'POST /api/v1/agents/register {"name":"my-agent","publicKey":"<ed25519 public key hex>"}'}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-head">
        <h1>Agents</h1>
        {pending.length > 0 && <p className="muted"><span className="mono">{pending.length}</span> pending</p>}
      </div>
      {pending.length > 0 && (
        <>
          <h2 className="section-title">Pending</h2>
          {pending.map((a) => (
            <PendingCard
              key={a.id}
              agent={a}
              error={errorFor(a.id)}
              working={working === a.id}
              onApprove={() => setApproving(a)}
              onReject={() => withdraw(a.id)}
            />
          ))}
        </>
      )}
      {active.length > 0 && (
        <>
          <h2 className="section-title">Active</h2>
          <div className="agent-grid">
            {active.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                ticket={tickets.find((t) => t.id === a.currentTicketId)}
                revoking={working === a.id}
                error={errorFor(a.id)}
                onRevoke={() => withdraw(a.id)}
              />
            ))}
          </div>
        </>
      )}
      {revoked.length > 0 && (
        <>
          <button type="button" className="section-toggle" aria-expanded={showRevoked} onClick={() => setShowRevoked((v) => !v)}>
            {showRevoked ? <CaretDown size={16} weight="regular" aria-hidden="true" /> : <CaretRight size={16} weight="regular" aria-hidden="true" />}
            Revoked <span className="mono">{revoked.length}</span>
          </button>
          {showRevoked && revoked.map((a) => <RevokedRow key={a.id} agent={a} />)}
        </>
      )}
      {approving && <ApproveDialog agent={approving} onClose={() => setApproving(null)} />}
    </div>
  );
}
