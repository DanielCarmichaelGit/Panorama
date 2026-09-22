import type { FastifyInstance } from "fastify";
import { CreateTicketInput, FlagInput, MoveTicketInput, UpdateTicketInput } from "@panorama/core";
import { appendEvent, archiveTicket, createTicket, getActor, getLane, getProject, getTicket, listTickets, moveTicket, queue, setFlag, updateTicket, type DB } from "@panorama/db";
import { getDb, inScope, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export function ticketRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const load = (db: DB, id: string) => { const t = getTicket(db, id); if (!t || t.archived) throw new HttpError(404, "not_found", "No such ticket"); return t; };
  const log = (db: DB, req: any, type: string, payload: unknown) => appendEvent(db, { actorId: req.actor.id, type, payload, signature: req.sig, now: iso() });

  app.get("/api/v1/tickets", async (req: any) => {
    const { projectId, laneId, flag } = req.query as Record<string, string | undefined>;
    requireCan(req, "read", projectId);
    return listTickets(getDb(ctx), { projectId, laneId, flag }).filter((t) => inScope(req.actor, t.projectId));
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
    if (input.laneId && getLane(db, input.laneId)?.projectId !== input.projectId) throw new HttpError(400, "wrong_project", "That lane belongs to another project");
    return db.transaction(() => {
      const t = createTicket(db, { ...input, assigneeId: req.actor.kind === "agent" ? req.actor.id : null }, iso());
      log(db, req, "ticket.created", { id: t.id, key: t.key, title: t.title, laneId: t.laneId });
      return t;
    })();
  });

  app.get("/api/v1/tickets/:id", async (req: any) => { const t = load(getDb(ctx), req.params.id); requireCan(req, "read", t.projectId); return t; });

  app.patch("/api/v1/tickets/:id", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "ticket.update", t.projectId);
    const patch = UpdateTicketInput.parse(req.body);
    if (patch.assigneeId !== undefined && patch.assigneeId !== null) {
      if (req.actor.kind === "agent" && patch.assigneeId !== req.actor.id) throw new HttpError(403, "forbidden", "Agents may only assign themselves");
      if (!getActor(db, patch.assigneeId)) throw new HttpError(400, "validation", "No such actor");
    }
    return db.transaction(() => { const out = updateTicket(db, t.id, patch, iso()); log(db, req, "ticket.updated", { id: t.id, patch }); return out; })();
  });

  app.post("/api/v1/tickets/:id/move", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "ticket.move", t.projectId);
    const { laneId } = MoveTicketInput.parse(req.body); const lane = getLane(db, laneId);
    if (!lane) throw new HttpError(404, "not_found", "No such lane");
    if (lane.projectId !== t.projectId) throw new HttpError(400, "wrong_project", "That lane belongs to another project");
    return db.transaction(() => {
      if (req.actor.kind === "agent" && !t.assigneeId) updateTicket(db, t.id, { assigneeId: req.actor.id }, iso());
      const { ticket, flagged } = moveTicket(db, t.id, laneId, iso());
      log(db, req, "ticket.moved", { id: t.id, from: t.laneId, to: laneId });
      if (flagged) log(db, req, "ticket.flag_set", { id: t.id, flag: "needs_human", cause: "lane" });
      return ticket;
    })();
  });

  app.post("/api/v1/tickets/:id/flags", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); const { flag, on } = FlagInput.parse(req.body);
    requireCan(req, flag === "needs_human" && !on ? "flag.clear_needs_human" : "flag.set", t.projectId);
    return db.transaction(() => { const out = setFlag(db, t.id, flag, on, iso()); log(db, req, on ? "ticket.flag_set" : "ticket.flag_cleared", { id: t.id, flag, cause: "actor" }); return out; })();
  });

  app.post("/api/v1/tickets/:id/archive", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "ticket.archive", t.projectId);
    return db.transaction(() => { const out = archiveTicket(db, t.id, iso()); log(db, req, "ticket.archived", { id: t.id }); return out; })();
  });
}
