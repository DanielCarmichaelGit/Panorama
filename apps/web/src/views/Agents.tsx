import { useEffect, useRef, useState } from "react";
import { AGENT_ACTIONS, type Actor, type AgentAction, type Scopes } from "@panorama/core";
import { LaneScene } from "../lib/iso";
import { useAgents, useApproveAgent, useProjects, useRevokeAgent } from "../lib/hooks";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

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
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "Never";
}

function scopeSummary(scopes: Scopes | null): string {
  if (!scopes) return "No access";
  const projects = scopes.projects === "*" ? "all projects" : `${scopes.projects.length} project${scopes.projects.length === 1 ? "" : "s"}`;
  return `${projects}, ${scopes.actions.map((a) => ACTION_LABELS[a]).join(", ")}`;
}

function ApproveDialog({ agent, onClose }: { agent: Actor; onClose: () => void }) {
  const projects = useProjects();
  const approve = useApproveAgent();
  const [allProjects, setAllProjects] = useState(true);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [actions, setActions] = useState<AgentAction[]>([...AGENT_ACTIONS]);

  const list = projects.data ?? [];
  const canApprove = (allProjects || projectIds.length > 0) && actions.includes("read") && !approve.isPending;

  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => openerRef.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function toggleAction(a: AgentAction) {
    setActions((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  }
  function toggleProject(id: string) {
    setProjectIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
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
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="approve-title" ref={dialogRef}>
        <form onSubmit={submit}>
          <h2 id="approve-title">Approve {agent.name}</h2>
          <div className="field">
            <label>Projects</label>
            <label className="checkbox-row"><input type="checkbox" checked={allProjects} onChange={(e) => setAllProjects(e.target.checked)} /> All projects</label>
            {!allProjects && list.map((p) => (
              <label className="checkbox-row" key={p.id}>
                <input type="checkbox" checked={projectIds.includes(p.id)} onChange={() => toggleProject(p.id)} /> {p.name}
              </label>
            ))}
          </div>
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

function AgentRow({ agent, showLastSeen, children }: { agent: Actor; showLastSeen?: boolean; children?: React.ReactNode }) {
  return (
    <div className="card agent-row">
      <strong>{agent.name}</strong>
      <span className="mono muted">{shortKey(agent.publicKey)}</span>
      <span className="mono muted">{showLastSeen ? when(agent.lastSeen) : `registered ${when(agent.createdAt)}`}</span>
      {agent.scopes && <span className="muted">{scopeSummary(agent.scopes)}</span>}
      <div className="spacer" />
      {children}
    </div>
  );
}

export function Agents() {
  const agents = useAgents({ refetchInterval: 3000 });
  const revoke = useRevokeAgent();
  const [approving, setApproving] = useState<Actor | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);

  const list = agents.data ?? [];
  const pending = list.filter((a) => a.status === "pending");
  const active = list.filter((a) => a.status === "active");
  const revoked = list.filter((a) => a.status === "revoked");

  async function reject(id: string) {
    setRejecting(id);
    try {
      await revoke.mutateAsync(id);
    } finally {
      setRejecting(null);
    }
  }

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
          <LaneScene />
          <h1>No agents yet</h1>
          <p className="muted">Register an agent key to see it here.</p>
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
            <AgentRow key={a.id} agent={a}>
              <button type="button" className="btn" onClick={() => setApproving(a)}>Approve</button>
              <button type="button" className="btn ghost" onClick={() => reject(a.id)} disabled={rejecting === a.id}>Reject</button>
            </AgentRow>
          ))}
        </>
      )}
      {active.length > 0 && (
        <>
          <h2 className="section-title">Active</h2>
          {active.map((a) => (
            <AgentRow key={a.id} agent={a} showLastSeen>
              <button type="button" className="btn ghost" onClick={() => revoke.mutate(a.id)} disabled={revoke.isPending}>Revoke</button>
            </AgentRow>
          ))}
        </>
      )}
      {revoked.length > 0 && (
        <>
          <h2 className="section-title">Revoked</h2>
          {revoked.map((a) => <AgentRow key={a.id} agent={a} showLastSeen />)}
        </>
      )}
      {approving && <ApproveDialog agent={approving} onClose={() => setApproving(null)} />}
    </div>
  );
}
