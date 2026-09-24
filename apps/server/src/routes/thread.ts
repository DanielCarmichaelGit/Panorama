import type { FastifyInstance } from "fastify";
import { AddCommentInput, AddEvidenceInput, checkGate, evaluateEvidence, LaneRequirementsInput } from "@panorama/core";
import {
  addComment,
  addEvidence,
  appendEvent,
  getActor,
  getAttachment,
  getEvidenceType,
  getLane,
  getTicket,
  listComments,
  listEvidence,
  listEvidenceTypes,
  listLanes,
  setLaneRequirements,
  thread,
  type DB,
} from "@panorama/db";
import { getDb, requireCan } from "../auth";
import { record } from "../bus";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export function threadRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const load = (db: DB, id: string) => { const t = getTicket(db, id); if (!t || t.archived) throw new HttpError(404, "not_found", "No such ticket"); return t; };
  const log = (db: DB, req: any, type: string, payload: unknown) => {
    const ev = appendEvent(db, { actorId: req.actor.id, type, payload, signature: req.sig, now: iso() });
    record(req, ev);
    return ev;
  };

  app.get("/api/v1/evidence-types", async (req) => { requireCan(req, "read"); return listEvidenceTypes(getDb(ctx)); });

  app.put("/api/v1/lanes/:id/requirements", async (req: any) => {
    const db = getDb(ctx); const lane = getLane(db, req.params.id);
    if (!lane) throw new HttpError(404, "not_found", "No such lane");
    requireCan(req, "lane.edit", lane.projectId);
    const { requirements } = LaneRequirementsInput.parse(req.body);
    for (const r of requirements) if (!getEvidenceType(db, r.typeId)) throw new HttpError(400, "validation", `No such evidence type: ${r.typeId}`);
    return db.transaction(() => {
      const out = setLaneRequirements(db, lane.id, requirements);
      log(db, req, "lane.requirements_set", { id: lane.id, projectId: lane.projectId, requirements });
      return out;
    })();
  });

  app.get("/api/v1/tickets/:id/thread", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "read", t.projectId);
    const th = thread(db, t.id);
    const actorIds = new Set<string>();
    for (const c of th.comments) actorIds.add(c.actorId);
    for (const a of th.attachments) actorIds.add(a.actorId);
    for (const e of th.evidence) actorIds.add(e.actorId);
    const actors = [...actorIds].map((id) => getActor(db, id)).filter((a): a is NonNullable<typeof a> => !!a).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
    return { ...th, actors };
  });

  app.post("/api/v1/comments", async (req: any) => {
    const db = getDb(ctx); const input = AddCommentInput.parse(req.body);
    const t = load(db, input.ticketId); requireCan(req, "comment.add", t.projectId);
    const attachmentIds = input.attachmentIds ?? [];
    for (const id of attachmentIds) {
      const att = getAttachment(db, id);
      if (!att || att.ticketId !== t.id || att.actorId !== req.actor.id || att.commentId !== null) {
        throw new HttpError(400, "validation", "Bad attachment", { attachmentId: id });
      }
    }
    // The body is markdown and is untrusted. It is stored verbatim (zod already bounds it to
    // 1..20000 chars): an HTML sanitiser here is both lossy (it mangles plain markdown
    // punctuation like `<` and `&` in prose or code spans) and bypassable (entity-encoded
    // input decodes back to live markup once un-escaped for the markdown case). The render
    // boundary is HTML, not this route, so sanitisation happens there: the web client renders
    // this body through marked and DOMPurify, and shows any raw HTML blocks only inside a
    // sandboxed frame.
    return db.transaction(() => {
      const c = addComment(db, { ticketId: t.id, actorId: req.actor.id, body: input.body, attachmentIds, now: iso() });
      log(db, req, "comment.added", { id: c.id, ticketId: t.id, projectId: t.projectId });
      return c;
    })();
  });

  app.post("/api/v1/evidence", async (req: any) => {
    const db = getDb(ctx); const input = AddEvidenceInput.parse(req.body);
    const t = load(db, input.ticketId); requireCan(req, "evidence.add", t.projectId);
    const type = getEvidenceType(db, input.typeId);
    if (!type) throw new HttpError(404, "not_found", "No such evidence type");
    if (type.humanOnly) requireCan(req, "evidence.signoff");
    if (input.attachmentId) {
      const att = getAttachment(db, input.attachmentId);
      if (!att || att.ticketId !== t.id) throw new HttpError(400, "validation", "No such attachment on this ticket", { attachmentId: input.attachmentId });
    }
    if (type.needsAttachment && !input.attachmentId) {
      throw new HttpError(400, "validation", "This evidence type needs an attachment", { attachmentId: null });
    }
    if (input.commentId && !listComments(db, t.id).some((c) => c.id === input.commentId)) {
      throw new HttpError(400, "validation", "No such comment on this ticket", { commentId: input.commentId });
    }
    const result = evaluateEvidence(type, input.payload);
    return db.transaction(() => {
      const e = addEvidence(db, {
        ticketId: t.id,
        typeId: type.id,
        commentId: input.commentId ?? null,
        attachmentId: input.attachmentId ?? null,
        actorId: req.actor.id,
        payload: input.payload,
        result,
        now: iso(),
      });
      log(db, req, "evidence.added", { id: e.id, ticketId: t.id, projectId: t.projectId, typeId: type.id, result });
      return e;
    })();
  });

  app.get("/api/v1/tickets/:id/gates", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "read", t.projectId);
    const evidence = listEvidence(db, t.id);
    const out: Record<string, { typeId: string; name: string; need: number; have: number }[]> = {};
    for (const lane of listLanes(db, t.projectId)) {
      out[lane.id] = checkGate(lane.evidenceRequirements, evidence).map((m) => ({ ...m, name: getEvidenceType(db, m.typeId)?.name ?? m.typeId }));
    }
    return out;
  });
}
