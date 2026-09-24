import { randomUUID } from "node:crypto";
import type { Attachment, Comment, Evidence, EvidenceType } from "@panorama/core";
import type { DB } from "./open";
const toType = (r: any): EvidenceType => ({ id: r.id, name: r.name, kind: r.kind, params: JSON.parse(r.params), humanOnly: !!r.human_only, needsAttachment: !!r.needs_attachment, createdAt: r.created_at });
const toAtt = (r: any): Attachment => ({ id: r.id, ticketId: r.ticket_id, commentId: r.comment_id, actorId: r.actor_id, filename: r.filename, mime: r.mime, size: r.size, sha256: r.sha256, createdAt: r.created_at });
const toEv = (r: any): Evidence => ({ id: r.id, ticketId: r.ticket_id, typeId: r.type_id, commentId: r.comment_id, attachmentId: r.attachment_id, actorId: r.actor_id, payload: JSON.parse(r.payload), result: r.result, createdAt: r.created_at });
export const listEvidenceTypes = (db: DB): EvidenceType[] => db.prepare("select * from evidence_types order by created_at, name").all().map(toType);
export const getEvidenceType = (db: DB, id: string): EvidenceType | undefined => { const r = db.prepare("select * from evidence_types where id = ?").get(id); return r ? toType(r) : undefined; };
export function addAttachment(db: DB, a: Omit<Attachment, "commentId">): Attachment {
  db.prepare("insert into attachments(id, ticket_id, comment_id, actor_id, filename, mime, size, sha256, created_at) values(?,?,null,?,?,?,?,?,?)")
    .run(a.id, a.ticketId, a.actorId, a.filename, a.mime, a.size, a.sha256, a.createdAt);
  return getAttachment(db, a.id)!;
}
export const getAttachment = (db: DB, id: string): Attachment | undefined => { const r = db.prepare("select * from attachments where id = ?").get(id); return r ? toAtt(r) : undefined; };
export const listAttachments = (db: DB, ticketId: string): Attachment[] => db.prepare("select * from attachments where ticket_id = ? order by created_at, id").all(ticketId).map(toAtt);
export function addComment(db: DB, c: { ticketId: string; actorId: string; body: string; attachmentIds: string[]; now: string }): Comment {
  const id = randomUUID();
  db.prepare("insert into comments(id, ticket_id, actor_id, body, created_at) values(?,?,?,?,?)").run(id, c.ticketId, c.actorId, c.body, c.now);
  const link = db.prepare("update attachments set comment_id = ? where id = ? and ticket_id = ? and comment_id is null");
  for (const a of c.attachmentIds) link.run(id, a, c.ticketId);
  return listComments(db, c.ticketId).find((x) => x.id === id)!;
}
export function listComments(db: DB, ticketId: string): Comment[] {
  const atts = listAttachments(db, ticketId);
  return db.prepare("select * from comments where ticket_id = ? order by created_at, id").all(ticketId)
    .map((r: any) => ({ id: r.id, ticketId: r.ticket_id, actorId: r.actor_id, body: r.body, createdAt: r.created_at, attachmentIds: atts.filter((a) => a.commentId === r.id).map((a) => a.id) }));
}
export function addEvidence(db: DB, e: Omit<Evidence, "id" | "createdAt"> & { now: string }): Evidence {
  const id = randomUUID();
  db.prepare("insert into evidence(id, ticket_id, type_id, comment_id, attachment_id, actor_id, payload, result, created_at) values(?,?,?,?,?,?,?,?,?)")
    .run(id, e.ticketId, e.typeId, e.commentId, e.attachmentId, e.actorId, JSON.stringify(e.payload), e.result, e.now);
  return toEv(db.prepare("select * from evidence where id = ?").get(id));
}
export const listEvidence = (db: DB, ticketId: string): Evidence[] => db.prepare("select * from evidence where ticket_id = ? order by created_at, id").all(ticketId).map(toEv);
export const thread = (db: DB, ticketId: string) => ({ comments: listComments(db, ticketId), attachments: listAttachments(db, ticketId), evidence: listEvidence(db, ticketId) });
