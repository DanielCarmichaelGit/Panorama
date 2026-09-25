import type { FastifyInstance } from "fastify";
import { CreateTicketInput, FlagInput, MoveTicketInput, UpdateTicketInput } from "@boomerang/core";
import { archiveTicket, getProject, listTickets, queue } from "@boomerang/db";
import { getDb, inScope, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";
import { createTicketAs, moveTicketAs, setFlagAs, updateTicketAs } from "../services/tickets";
import { actingAs, loadTicket, makeLog } from "./common";

// The routes check the key's permissions and parse the body; everything after that (the gate,
// the epic and tag rules, the events) lives in services/tickets.ts, which the rule engine
// runs through too, so a rule can do nothing a request could not.
export function ticketRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const load = loadTicket;
  const log = makeLog(ctx);

  app.get("/api/v1/tickets", async (req: any) => {
    const { projectId, boardId, laneId, flag } = req.query as Record<string, string | undefined>;
    requireCan(req, "read", projectId);
    return listTickets(getDb(ctx), { projectId, boardId, laneId, flag }).filter((t) => inScope(req.actor, t.projectId));
  });

  app.get("/api/v1/queue", async (req: any) => {
    const projectId = String(req.query.projectId ?? "");
    const db = getDb(ctx);
    if (!getProject(db, projectId)) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "read", projectId);
    return queue(db, projectId);
  });

  app.post("/api/v1/tickets", async (req) => {
    const db = getDb(ctx); const input = CreateTicketInput.parse(req.body);
    if (!getProject(db, input.projectId)) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "ticket.create", input.projectId);
    // successCriteria is human-only (criteria.edit), whether or not it is present on this input.
    if (input.successCriteria !== undefined) requireCan(req, "criteria.edit", input.projectId);
    return createTicketAs(actingAs(ctx, db, req), input);
  });

  app.get("/api/v1/tickets/:id", async (req: any) => { const t = load(getDb(ctx), req.params.id); requireCan(req, "read", t.projectId); return t; });

  app.patch("/api/v1/tickets/:id", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "ticket.update", t.projectId);
    const patch = UpdateTicketInput.parse(req.body);
    if (patch.successCriteria !== undefined) requireCan(req, "criteria.edit", t.projectId);
    return updateTicketAs(actingAs(ctx, db, req), t, patch);
  });

  app.post("/api/v1/tickets/:id/move", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "ticket.move", t.projectId);
    const { laneId } = MoveTicketInput.parse(req.body);
    return moveTicketAs(actingAs(ctx, db, req), t, laneId);
  });

  app.post("/api/v1/tickets/:id/flags", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); const { flag, on } = FlagInput.parse(req.body);
    requireCan(req, flag === "needs_human" && !on ? "flag.clear_needs_human" : "flag.set", t.projectId);
    return setFlagAs(actingAs(ctx, db, req), t, flag, on);
  });

  app.post("/api/v1/tickets/:id/archive", async (req: any) => {
    requireCan(req, "ticket.archive");
    const db = getDb(ctx); const t = load(db, req.params.id);
    return db.transaction(() => { const out = archiveTicket(db, t.id, iso()); log(db, req, "ticket.archived", { id: t.id, projectId: t.projectId }); return out; })();
  });
}
