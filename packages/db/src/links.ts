import { randomUUID } from "node:crypto";
import type { LinkKind, TicketLink } from "@panorama/core";
import type { DB } from "./open";

const toLink = (r: any): TicketLink => ({
  id: r.id, projectId: r.project_id, fromId: r.from_id, toId: r.to_id, kind: r.kind, createdAt: r.created_at,
});

export const listLinks = (db: DB, ticketId: string): TicketLink[] =>
  db.prepare("select * from ticket_links where from_id = ? or to_id = ? order by created_at").all(ticketId, ticketId).map(toLink);

/**
 * Whether `target` is reachable from `start` by following `blocks` edges forward
 * (from_id to to_id). Adding a new edge `fromId blocks toId` closes a cycle exactly when
 * `toId` can already reach `fromId` this way, since the new edge would then complete the loop.
 */
function reachable(db: DB, start: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [start];
  const next = db.prepare("select to_id from ticket_links where from_id = ? and kind = 'blocks'");
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const row of next.all(id) as { to_id: string }[]) stack.push(row.to_id);
  }
  return false;
}

export function addLink(db: DB, input: { projectId: string; fromId: string; toId: string; kind: LinkKind }, now: string): TicketLink {
  if (input.fromId === input.toId) throw new Error("self_link");
  if (input.kind === "blocks" && reachable(db, input.toId, input.fromId)) throw new Error("link_cycle");
  const id = randomUUID();
  try {
    db.prepare("insert into ticket_links(id, project_id, from_id, to_id, kind, created_at) values(?,?,?,?,?,?)")
      .run(id, input.projectId, input.fromId, input.toId, input.kind, now);
  } catch (e) {
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("duplicate_link");
    throw e;
  }
  return toLink(db.prepare("select * from ticket_links where id = ?").get(id));
}

export function removeLink(db: DB, id: string): void {
  db.prepare("delete from ticket_links where id = ?").run(id);
}
