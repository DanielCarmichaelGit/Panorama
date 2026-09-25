import type { FastifyInstance } from "fastify";
import { checkGate, CreateTicketInput, type FieldDefinition, type FieldValue, FlagInput, isFileValue, type Lane, MoveTicketInput, UpdateTicketInput, validateFieldValues } from "@boomerang/core";
import { archiveTicket, createTicket, enterLane, getActor, getAttachment, getBoard, getEpic, getEvidenceType, getLane, getProject, getTag, listEvidence, listFields, listLanes, listTickets, moveTicket, queue, setCurrentTicket, setFlag, updateTicket, type DB } from "@boomerang/db";
import { getDb, inScope, requireCan } from "../auth";
import { changedKeys, sameMergedRecord, sameSet } from "../changed";
import type { Ctx } from "../context";
import { blockedByReasons } from "../gate";
import { HttpError } from "../errors";
import { loadTicket, makeLog } from "./common";

export function ticketRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const load = loadTicket;
  /**
   * Refuses a lane a ticket cannot enter yet, in the one 422 shape both create and move use.
   * Entering a lane with `isDone` also runs the dependency check, reporting an unmet `blocks`
   * link as a `blocked_by` entry alongside any missing evidence. `ticketId` is omitted on
   * create: a brand new ticket cannot yet be the target of a link, so there is nothing to check.
   */
  const requireGate = (db: DB, lane: Lane, evidence: Parameters<typeof checkGate>[1], projectId: string, ticketId?: string) => {
    const missing = checkGate(lane.evidenceRequirements, evidence).map((m) => ({ ...m, name: getEvidenceType(db, m.typeId)?.name ?? m.typeId }));
    const blockers = ticketId ? blockedByReasons(db, projectId, ticketId, lane) : [];
    const all = [...missing, ...blockers];
    if (all.length === 0) return;
    throw new HttpError(422, "gate", `${lane.name} needs evidence first`, { laneId: lane.id, missing: all });
  };
  const log = makeLog(ctx);
  /** An epic a ticket may join: it must be this project's and still open. */
  const requireEpic = (db: DB, epicId: string, projectId: string) => {
    const epic = getEpic(db, epicId);
    if (!epic || epic.projectId !== projectId) throw new HttpError(400, "wrong_project", "That epic belongs to another project");
    if (epic.archived) throw new HttpError(400, "validation", "That epic is archived", { epicId });
  };
  /**
   * A file field may only name one of the ticket's own attachments. Core has checked the
   * shape; this checks ownership. On create there is no ticket yet, so no attachment can
   * belong to it and any file value is refused: upload after create, then PATCH the field.
   */
  const requireOwnAttachments = (db: DB, defs: FieldDefinition[], values: Record<string, FieldValue>, ticketId: string | null) => {
    for (const def of defs) {
      if (def.kind !== "file" || def.archived) continue;
      const value = values[def.key];
      if (!isFileValue(value)) continue;
      const att = getAttachment(db, value.attachmentId);
      if (!att || att.ticketId !== ticketId) throw new HttpError(400, "validation", "That attachment does not belong to this ticket", { key: def.key, attachmentId: value.attachmentId });
    }
  };

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
    if (input.laneId && getLane(db, input.laneId)?.projectId !== input.projectId) throw new HttpError(400, "wrong_project", "That lane belongs to another project");
    if (input.boardId && getBoard(db, input.boardId)?.projectId !== input.projectId) throw new HttpError(400, "wrong_project", "That board belongs to another project");
    if (input.epicId !== undefined) requireEpic(db, input.epicId, input.projectId);
    if (input.tagIds) {
      for (const tagId of input.tagIds) {
        const tag = getTag(db, tagId);
        if (!tag || tag.projectId !== input.projectId || tag.archived) throw new HttpError(400, "validation", "That tag does not apply here", { tagId });
      }
    }
    // successCriteria is human-only (criteria.edit), whether or not it is present on this input.
    if (input.successCriteria !== undefined) requireCan(req, "criteria.edit", input.projectId);
    // Required fields are enforced for the human's dialog only: an agent may create with fields
    // missing, leaving the ticket to show "Needs fields" in the panel. A required file field is
    // never checked at create, for anyone: its attachment can only exist once the ticket does
    // (upload after create, then PATCH), so the panel's "Needs fields" chip carries it instead.
    const defs = listFields(db, input.projectId, { includeArchived: true });
    const fieldCheck = validateFieldValues(defs.map((d) => (d.kind === "file" ? { ...d, required: false } : d)), input.fields ?? {}, { requireAll: req.actor.kind === "human" });
    if (!fieldCheck.ok) throw new HttpError(400, "validation", "Bad field values", { issues: fieldCheck.issues });
    requireOwnAttachments(db, defs, input.fields ?? {}, null);
    // Creating into a lane is entering it, so the same gate applies. A brand new ticket carries
    // no evidence at all, so every requirement the lane has is missing by definition.
    const lane = input.laneId ? getLane(db, input.laneId)! : listLanes(db, input.projectId)[0];
    requireGate(db, lane, [], input.projectId);
    return db.transaction(() => {
      const t = createTicket(db, { ...input, assigneeId: req.actor.kind === "agent" ? req.actor.id : null }, iso());
      if (req.actor.kind === "agent") setCurrentTicket(db, req.actor.id, t.id);
      log(db, req, "ticket.created", { id: t.id, projectId: t.projectId, boardId: t.boardId, key: t.key, title: t.title, laneId: t.laneId, epicId: t.epicId, tagIds: t.tagIds });
      const { ticket, flagged } = enterLane(db, t.id, t.laneId, iso());
      if (flagged) log(db, req, "ticket.flag_set", { id: t.id, projectId: t.projectId, flag: "needs_human", cause: "lane" });
      return ticket;
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
    if (patch.epicId !== undefined && patch.epicId !== null) requireEpic(db, patch.epicId, t.projectId);
    if (patch.tagIds) {
      for (const tagId of patch.tagIds) {
        const tag = getTag(db, tagId);
        if (!tag || tag.projectId !== t.projectId || tag.archived) throw new HttpError(400, "validation", "That tag does not apply here", { tagId });
      }
    }
    if (patch.successCriteria !== undefined) requireCan(req, "criteria.edit", t.projectId);
    if (patch.fields !== undefined) {
      // The patch merges into the ticket's values, so it is the merged result that must hold:
      // a fields patch may not leave a required field empty, whoever sends it. (Only create
      // exempts file kinds, and only because their attachment cannot exist yet.)
      const defs = listFields(db, t.projectId, { includeArchived: true });
      const fieldCheck = validateFieldValues(defs, { ...t.fields, ...patch.fields }, { requireAll: true });
      if (!fieldCheck.ok) throw new HttpError(400, "validation", "Bad field values", { issues: fieldCheck.issues });
      requireOwnAttachments(db, defs, patch.fields, t.id);
    }
    const changed = changedKeys(t, patch, { tagIds: sameSet, fields: sameMergedRecord });
    return db.transaction(() => {
      const out = updateTicket(db, t.id, patch, iso());
      log(db, req, "ticket.updated", { id: t.id, projectId: t.projectId, changed });
      return out;
    })();
  });

  app.post("/api/v1/tickets/:id/move", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "ticket.move", t.projectId);
    const { laneId } = MoveTicketInput.parse(req.body); const lane = getLane(db, laneId);
    if (!lane) throw new HttpError(404, "not_found", "No such lane");
    if (lane.projectId !== t.projectId) throw new HttpError(400, "wrong_project", "That lane belongs to another project");
    requireGate(db, lane, listEvidence(db, t.id), t.projectId, t.id);
    return db.transaction(() => {
      if (req.actor.kind === "agent" && !t.assigneeId) updateTicket(db, t.id, { assigneeId: req.actor.id }, iso());
      const { ticket, flagged } = moveTicket(db, t.id, laneId, iso());
      if (req.actor.kind === "agent") setCurrentTicket(db, req.actor.id, lane.isDone ? null : t.id);
      log(db, req, "ticket.moved", { id: t.id, projectId: t.projectId, from: t.laneId, to: laneId });
      if (flagged) log(db, req, "ticket.flag_set", { id: t.id, projectId: t.projectId, flag: "needs_human", cause: "lane" });
      return ticket;
    })();
  });

  app.post("/api/v1/tickets/:id/flags", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); const { flag, on } = FlagInput.parse(req.body);
    requireCan(req, flag === "needs_human" && !on ? "flag.clear_needs_human" : "flag.set", t.projectId);
    return db.transaction(() => { const out = setFlag(db, t.id, flag, on, iso()); log(db, req, on ? "ticket.flag_set" : "ticket.flag_cleared", { id: t.id, projectId: t.projectId, flag, cause: "actor" }); return out; })();
  });

  app.post("/api/v1/tickets/:id/archive", async (req: any) => {
    requireCan(req, "ticket.archive");
    const db = getDb(ctx); const t = load(db, req.params.id);
    return db.transaction(() => { const out = archiveTicket(db, t.id, iso()); log(db, req, "ticket.archived", { id: t.id, projectId: t.projectId }); return out; })();
  });
}
