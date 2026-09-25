import type { Actor, ChainEvent, Comment, CreateTicketInput, FieldDefinition, FieldValue, Lane, Ticket, UpdateTicketInput } from "@boomerang/core";
import { checkGate, isFileValue, validateFieldValues } from "@boomerang/core";
import { addComment, createTicket, enterLane, getActor, getAttachment, getBoard, getEpic, getEvidenceType, getLane, getProject, getTag, listEvidence, listFields, listLanes, moveTicket, setCurrentTicket, setFlag, updateTicket, type DB } from "@boomerang/db";
import { changedKeys, sameMergedRecord, sameSet } from "../changed";
import { HttpError } from "../errors";
import { blockedByReasons } from "../gate";
import { stopTicketTimers } from "./timers";

/**
 * The ticket operations behind the routes, as functions of who is acting rather than of a
 * request, so the rule engine performs a move, a flag, a patch, a comment or a create through
 * exactly the code a route runs: the gate, the archived-epic and tag rules, the attachment
 * ownership check, the events. Permission checks (`requireCan`) stay in the routes: they are
 * about the key that signed the request, and the engine has none. `kind` is who is acting in
 * the sense the rules care about: the engine is "system" whatever its actor row says.
 */
export interface Acting {
  db: DB;
  actor: Actor;
  kind: "human" | "agent" | "system";
  now: () => string;
  /** Appends a signed event inside the caller's transaction and records it for the stream. */
  log: (type: string, payload: Record<string, unknown>) => ChainEvent;
}

export interface MissingEntry { typeId: string; name: string; need: number; have: number; description?: string }

/**
 * What a ticket still lacks to enter a lane, in the one shape both the 422 and the gates
 * report use. Entering a lane with `isDone` also runs the dependency check, reporting an unmet
 * `blocks` link as a `blocked_by` entry alongside any missing evidence. `ticketId` is omitted
 * on create: a brand new ticket cannot yet be the target of a link, so there is nothing to check.
 */
export function missingForLane(db: DB, lane: Lane, evidence: Parameters<typeof checkGate>[1], projectId: string, ticketId?: string): MissingEntry[] {
  const missing = checkGate(lane.evidenceRequirements, evidence).map((m) => ({ ...m, name: getEvidenceType(db, m.typeId)?.name ?? m.typeId }));
  const blockers = ticketId ? blockedByReasons(db, projectId, ticketId, lane) : [];
  return [...missing, ...blockers];
}

/** Refuses a lane a ticket cannot enter yet, in the one 422 shape both create and move use. */
export function requireGate(db: DB, lane: Lane, evidence: Parameters<typeof checkGate>[1], projectId: string, ticketId?: string): void {
  const all = missingForLane(db, lane, evidence, projectId, ticketId);
  if (all.length === 0) return;
  throw new HttpError(422, "gate", `${lane.name} needs evidence first`, { laneId: lane.id, missing: all });
}

/** An epic a ticket may join: it must be this project's and still open. */
export function requireEpic(db: DB, epicId: string, projectId: string): void {
  const epic = getEpic(db, epicId);
  if (!epic || epic.projectId !== projectId) throw new HttpError(400, "wrong_project", "That epic belongs to another project");
  if (epic.archived) throw new HttpError(400, "validation", "That epic is archived", { epicId });
}

/** Tags a ticket may carry: this project's, and not archived. */
export function requireTags(db: DB, tagIds: string[], projectId: string): void {
  for (const tagId of tagIds) {
    const tag = getTag(db, tagId);
    if (!tag || tag.projectId !== projectId || tag.archived) throw new HttpError(400, "validation", "That tag does not apply here", { tagId });
  }
}

/**
 * A file field may only name one of the ticket's own attachments. Core has checked the
 * shape; this checks ownership. On create there is no ticket yet, so no attachment can
 * belong to it and any file value is refused: upload after create, then PATCH the field.
 */
export function requireOwnAttachments(db: DB, defs: FieldDefinition[], values: Record<string, FieldValue>, ticketId: string | null): void {
  for (const def of defs) {
    if (def.kind !== "file" || def.archived) continue;
    const value = values[def.key];
    if (!isFileValue(value)) continue;
    const att = getAttachment(db, value.attachmentId);
    if (!att || att.ticketId !== ticketId) throw new HttpError(400, "validation", "That attachment does not belong to this ticket", { key: def.key, attachmentId: value.attachmentId });
  }
}

/** POST /tickets after its permission checks: validation, the gate on the landing lane, then
 *  the create and its events in one transaction. An agent is assigned what it creates. */
export function createTicketAs(a: Acting, input: CreateTicketInput): Ticket {
  const { db } = a;
  if (!getProject(db, input.projectId)) throw new HttpError(404, "not_found", "No such project");
  if (input.laneId && getLane(db, input.laneId)?.projectId !== input.projectId) throw new HttpError(400, "wrong_project", "That lane belongs to another project");
  if (input.boardId && getBoard(db, input.boardId)?.projectId !== input.projectId) throw new HttpError(400, "wrong_project", "That board belongs to another project");
  if (input.epicId !== undefined) requireEpic(db, input.epicId, input.projectId);
  if (input.tagIds) requireTags(db, input.tagIds, input.projectId);
  // Required fields are enforced for the human's dialog only: an agent (or a rule) may create
  // with fields missing, leaving the ticket to show "Needs fields" in the panel. A required
  // file field is never checked at create, for anyone: its attachment can only exist once the
  // ticket does (upload after create, then PATCH), so the panel's "Needs fields" chip carries it.
  const defs = listFields(db, input.projectId, { includeArchived: true });
  const fieldCheck = validateFieldValues(defs.map((d) => (d.kind === "file" ? { ...d, required: false } : d)), input.fields ?? {}, { requireAll: a.kind === "human" });
  if (!fieldCheck.ok) throw new HttpError(400, "validation", "Bad field values", { issues: fieldCheck.issues });
  requireOwnAttachments(db, defs, input.fields ?? {}, null);
  // Creating into a lane is entering it, so the same gate applies. A brand new ticket carries
  // no evidence at all, so every requirement the lane has is missing by definition.
  const lane = input.laneId ? getLane(db, input.laneId)! : listLanes(db, input.projectId)[0];
  requireGate(db, lane, [], input.projectId);
  return db.transaction(() => {
    const t = createTicket(db, { ...input, assigneeId: a.kind === "agent" ? a.actor.id : null }, a.now());
    if (a.kind === "agent") setCurrentTicket(db, a.actor.id, t.id);
    a.log("ticket.created", { id: t.id, projectId: t.projectId, boardId: t.boardId, key: t.key, title: t.title, laneId: t.laneId, epicId: t.epicId, tagIds: t.tagIds });
    const { ticket, flagged } = enterLane(db, t.id, t.laneId, a.now());
    if (flagged) a.log("ticket.flag_set", { id: t.id, projectId: t.projectId, flag: "needs_human", cause: "lane" });
    return ticket;
  })();
}

/** PATCH /tickets/:id after its permission checks. `changed[]` on the event names the keys
 *  whose value actually differs from the row. */
export function updateTicketAs(a: Acting, t: Ticket, patch: UpdateTicketInput): Ticket {
  const { db } = a;
  if (patch.assigneeId !== undefined && patch.assigneeId !== null) {
    if (a.kind === "agent" && patch.assigneeId !== a.actor.id) throw new HttpError(403, "forbidden", "Agents may only assign themselves");
    if (!getActor(db, patch.assigneeId)) throw new HttpError(400, "validation", "No such actor");
  }
  if (patch.epicId !== undefined && patch.epicId !== null) requireEpic(db, patch.epicId, t.projectId);
  if (patch.tagIds) requireTags(db, patch.tagIds, t.projectId);
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
    const out = updateTicket(db, t.id, patch, a.now());
    a.log("ticket.updated", { id: t.id, projectId: t.projectId, changed });
    return out;
  })();
}

/** POST /tickets/:id/move after its permission check: the lane must be this project's and
 *  the gate must pass, whoever asks. An agent moving an unassigned ticket takes it. */
export function moveTicketAs(a: Acting, t: Ticket, laneId: string): Ticket {
  const { db } = a;
  const lane = getLane(db, laneId);
  if (!lane) throw new HttpError(404, "not_found", "No such lane");
  if (lane.projectId !== t.projectId) throw new HttpError(400, "wrong_project", "That lane belongs to another project");
  requireGate(db, lane, listEvidence(db, t.id), t.projectId, t.id);
  return db.transaction(() => {
    if (a.kind === "agent" && !t.assigneeId) updateTicket(db, t.id, { assigneeId: a.actor.id }, a.now());
    const { ticket, flagged } = moveTicket(db, t.id, laneId, a.now());
    if (a.kind === "agent") setCurrentTicket(db, a.actor.id, lane.isDone ? null : t.id);
    a.log("ticket.moved", { id: t.id, projectId: t.projectId, from: t.laneId, to: laneId });
    // Done means the work stopped: every open timer on the ticket closes with the move.
    if (lane.isDone) stopTicketTimers(a, t);
    if (flagged) a.log("ticket.flag_set", { id: t.id, projectId: t.projectId, flag: "needs_human", cause: "lane" });
    return ticket;
  })();
}

/** POST /tickets/:id/flags after its permission check. `cause` says who asked: an actor, a
 *  lane on entry, or a rule. */
export function setFlagAs(a: Acting, t: Ticket, flag: string, on: boolean, cause: "actor" | "rule" = "actor"): Ticket {
  const { db } = a;
  return db.transaction(() => {
    const out = setFlag(db, t.id, flag, on, a.now());
    a.log(on ? "ticket.flag_set" : "ticket.flag_cleared", { id: t.id, projectId: t.projectId, flag, cause });
    return out;
  })();
}

/**
 * POST /comments after its permission check. The body is markdown and is untrusted. It is
 * stored verbatim (zod already bounds it to 1..20000 chars): an HTML sanitiser here is both
 * lossy (it mangles plain markdown punctuation like `<` and `&` in prose or code spans) and
 * bypassable (entity-encoded input decodes back to live markup once un-escaped for the
 * markdown case). The render boundary is HTML, not this route, so sanitisation happens there:
 * the web client renders this body through marked and DOMPurify, and shows any raw HTML
 * blocks only inside a sandboxed frame.
 */
export function addCommentAs(a: Acting, t: Ticket, body: string, attachmentIds: string[]): Comment {
  const { db } = a;
  for (const id of attachmentIds) {
    const att = getAttachment(db, id);
    if (!att || att.ticketId !== t.id || att.actorId !== a.actor.id || att.commentId !== null) {
      throw new HttpError(400, "validation", "Bad attachment", { attachmentId: id });
    }
  }
  return db.transaction(() => {
    const c = addComment(db, { ticketId: t.id, actorId: a.actor.id, body, attachmentIds, now: a.now() });
    a.log("comment.added", { id: c.id, ticketId: t.id, projectId: t.projectId });
    return c;
  })();
}
