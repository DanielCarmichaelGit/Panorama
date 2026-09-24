import { randomUUID } from "node:crypto";
import type { Family, Tag } from "@panorama/core";
import type { DB } from "./open";

const toTag = (r: any): Tag => ({
  id: r.id, projectId: r.project_id, name: r.name, family: r.family, archived: !!r.archived, createdAt: r.created_at,
});

export const listTags = (db: DB, projectId: string, opts: { includeArchived?: boolean } = {}): Tag[] => {
  const where = opts.includeArchived ? "project_id = ?" : "project_id = ? and archived = 0";
  return db.prepare(`select * from tags where ${where} order by name`).all(projectId).map(toTag);
};

export const getTag = (db: DB, id: string): Tag | undefined => {
  const r = db.prepare("select * from tags where id = ?").get(id);
  return r ? toTag(r) : undefined;
};

export function createTag(db: DB, input: { projectId: string; name: string; family?: Family }, now: string): Tag {
  const id = randomUUID();
  try {
    db.prepare("insert into tags(id, project_id, name, family, created_at) values(?,?,?,?,?)")
      .run(id, input.projectId, input.name, input.family ?? "stone", now);
  } catch (e) {
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("duplicate_tag");
    throw e;
  }
  return getTag(db, id)!;
}

export const archiveTag = (db: DB, id: string): Tag => {
  db.prepare("update tags set archived = 1 where id = ?").run(id);
  return getTag(db, id)!;
};

export function setTicketTags(db: DB, ticketId: string, tagIds: string[]): void {
  db.prepare("delete from ticket_tags where ticket_id = ?").run(ticketId);
  const ins = db.prepare("insert into ticket_tags(ticket_id, tag_id) values(?,?)");
  for (const tagId of tagIds) ins.run(ticketId, tagId);
}

export const listTicketTags = (db: DB, ticketId: string): string[] =>
  (db.prepare("select tag_id from ticket_tags where ticket_id = ?").all(ticketId) as { tag_id: string }[]).map((r) => r.tag_id);
