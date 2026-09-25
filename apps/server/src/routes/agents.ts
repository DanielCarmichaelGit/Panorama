import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ApproveAgentInput, RegisterAgentInput, type Scopes } from "@boomerang/core";
import { appendEvent, countPending, getActor, getTicket, insertActor, listActors, setActorStatus } from "@boomerang/db";
import { getDb, inScope, requireCan } from "../auth";
import { record } from "../bus";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

/** Whether two scopes share at least one project ("*" counts as sharing every project). An
 *  agent should not learn about another agent it never works alongside, so this gates what one
 *  agent's view of GET /api/v1/agents includes of another. */
function scopesShareProject(a: Scopes | null, b: Scopes | null): boolean {
  if (!a || !b) return false;
  // An empty project list is scope over nothing, so it shares nothing, not even with a
  // wildcard: "*" means every project there is, not every agent there is.
  if (Array.isArray(a.projects) && a.projects.length === 0) return false;
  if (Array.isArray(b.projects) && b.projects.length === 0) return false;
  if (a.projects === "*" || b.projects === "*") return true;
  return a.projects.some((p) => (b.projects as string[]).includes(p));
}

export function agentRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.post("/api/v1/agents/register", async (req) => {
    const db = getDb(ctx); const input = RegisterAgentInput.parse(req.body);
    if (countPending(db) >= 20) throw new HttpError(429, "too_many_pending", "Too many agent keys are waiting for approval");
    if (listActors(db).some((a) => a.publicKey === input.publicKey)) throw new HttpError(409, "duplicate_key", "That public key is already registered");
    const id = randomUUID(); const now = ctx.now().toISOString();
    db.transaction(() => {
      insertActor(db, { id, kind: "agent", name: input.name, publicKey: input.publicKey, scopes: null, status: "pending", lastSeen: null, currentTicketId: null, createdAt: now });
      const ev = appendEvent(db, { actorId: id, type: "agent.registered", payload: { id, name: input.name, publicKey: input.publicKey }, signature: "", now });
      record(req, ev);
    })();
    return { id, status: "pending" };
  });

  app.get("/api/v1/me", async (req) => req.actor);

  app.get("/api/v1/agents", async (req) => {
    requireCan(req, "read");
    const db = getDb(ctx);
    const agents = listActors(db).filter((a) => a.kind === "agent");
    if (req.actor.kind === "human") return agents;
    // Any active actor with read may see who else is connected, but an agent only ever sees the
    // public shape of agents it shares a project with, and never a current ticket in a project
    // outside its own scope: otherwise it would learn about agents and work it cannot read.
    const caller = req.actor;
    return agents
      .filter((a) => scopesShareProject(caller.scopes, a.scopes))
      .map((a) => {
        const ticket = a.currentTicketId ? getTicket(db, a.currentTicketId) : undefined;
        const ticketVisible = !ticket || inScope(caller, ticket.projectId);
        return { id: a.id, name: a.name, kind: a.kind, status: a.status, lastSeen: a.lastSeen, currentTicketId: ticketVisible ? a.currentTicketId : null };
      });
  });

  const change = (type: "agent.approved" | "agent.revoked") => async (req: any) => {
    requireCan(req, type === "agent.approved" ? "agent.approve" : "agent.revoke");
    const db = getDb(ctx); const id = req.params.id as string; const target = getActor(db, id);
    if (!target || target.kind !== "agent") throw new HttpError(404, "not_found", "No such agent");
    const scopes = type === "agent.approved" ? ApproveAgentInput.parse(req.body).scopes : null;
    db.transaction(() => {
      setActorStatus(db, id, type === "agent.approved" ? "active" : "revoked", scopes);
      const ev = appendEvent(db, { actorId: req.actor.id, type, payload: { id, scopes }, signature: req.sig, now: ctx.now().toISOString() });
      record(req, ev);
    })();
    return getActor(db, id);
  };
  app.post("/api/v1/agents/:id/approve", change("agent.approved"));
  app.post("/api/v1/agents/:id/revoke", change("agent.revoked"));
}
