import { randomUUID } from "node:crypto";
import type { Ticket } from "@panorama/core";
import type { DB } from "./open";
import { getLane, listBoards, listLanes } from "./projects";

const SELECT = "select t.*, p.key as project_key from tickets t join projects p on p.id = t.project_id";
const HAS_FLAG = "exists(select 1 from json_each(t.flags) where value = ?)";
const toTicket = (r: any): Ticket => ({ id: r.id, projectId: r.project_id, boardId: r.board_id, number: r.number, key: `${r.project_key}-${r.number}`, title: r.title, laneId: r.lane_id, position: r.position,
  flags: JSON.parse(r.flags), assigneeId: r.assignee_id, startDate: r.start_date, dueDate: r.due_date, metadata: JSON.parse(r.metadata), archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at });
const nextPosition = (db: DB, laneId: string): number => ((db.prepare("select max(position) m from tickets where lane_id = ?").get(laneId) as { m: number | null }).m ?? 0) + 1;

export const getTicket = (db: DB, id: string): Ticket | undefined => { const r = db.prepare(`${SELECT} where t.id = ?`).get(id); return r ? toTicket(r) : undefined; };

export function createTicket(db: DB, input: { projectId: string; title: string; boardId?: string; laneId?: string; assigneeId?: string | null; metadata?: Record<string, unknown> }, now: string): Ticket {
  const boardId = input.boardId ?? listBoards(db, input.projectId)[0].id;
  const laneId = input.laneId ?? listLanes(db, input.projectId)[0].id;
  const { n } = db.prepare("update projects set next_number = next_number + 1 where id = ? returning next_number - 1 as n").get(input.projectId) as { n: number };
  const id = randomUUID();
  db.prepare("insert into tickets(id, project_id, board_id, number, title, lane_id, position, assignee_id, metadata, created_at, updated_at) values(?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, input.projectId, boardId, n, input.title, laneId, nextPosition(db, laneId), input.assigneeId ?? null, JSON.stringify(input.metadata ?? {}), now, now);
  return getTicket(db, id)!;
}

export function listTickets(db: DB, f: { projectId?: string; boardId?: string; laneId?: string; flag?: string }): Ticket[] {
  const where = ["t.archived = 0"]; const args: unknown[] = [];
  if (f.projectId) { where.push("t.project_id = ?"); args.push(f.projectId); }
  if (f.boardId) { where.push("t.board_id = ?"); args.push(f.boardId); }
  if (f.laneId) { where.push("t.lane_id = ?"); args.push(f.laneId); }
  if (f.flag) { where.push(HAS_FLAG); args.push(f.flag); }
  return db.prepare(`${SELECT} where ${where.join(" and ")} order by t.lane_id, t.position`).all(...args).map(toTicket);
}

export function updateTicket(db: DB, id: string, patch: { title?: string; startDate?: string | null; dueDate?: string | null; assigneeId?: string | null; metadata?: Record<string, unknown> }, now: string): Ticket {
  const cols: Record<string, unknown> = {};
  if (patch.title !== undefined) cols.title = patch.title;
  if (patch.startDate !== undefined) cols.start_date = patch.startDate;
  if (patch.dueDate !== undefined) cols.due_date = patch.dueDate;
  if (patch.assigneeId !== undefined) cols.assignee_id = patch.assigneeId;
  if (patch.metadata !== undefined) cols.metadata = JSON.stringify(patch.metadata);
  cols.updated_at = now;
  const keys = Object.keys(cols);
  db.prepare(`update tickets set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`).run(...keys.map((k) => cols[k]), id);
  return getTicket(db, id)!;
}

export function setFlag(db: DB, id: string, flag: string, on: boolean, now: string): Ticket {
  const t = getTicket(db, id)!;
  const flags = on ? [...new Set([...t.flags, flag])] : t.flags.filter((f) => f !== flag);
  db.prepare("update tickets set flags = ?, updated_at = ? where id = ?").run(JSON.stringify(flags), now, id);
  return getTicket(db, id)!;
}

export function moveTicket(db: DB, id: string, laneId: string, now: string): { ticket: Ticket; flagged: boolean } {
  const lane = getLane(db, laneId)!;
  db.prepare("update tickets set lane_id = ?, position = ?, updated_at = ? where id = ?").run(laneId, nextPosition(db, laneId), now, id);
  const before = getTicket(db, id)!;
  const flagged = lane.setsNeedsHuman && !before.flags.includes("needs_human");
  return { ticket: flagged ? setFlag(db, id, "needs_human", true, now) : before, flagged };
}

export function archiveTicket(db: DB, id: string, now: string): Ticket {
  db.prepare("update tickets set archived = 1, updated_at = ? where id = ?").run(now, id);
  return getTicket(db, id)!;
}

export function queue(db: DB, projectId: string): { needsHuman: Ticket[]; active: Ticket[] } {
  const needsHuman = db.prepare(`${SELECT} where t.archived = 0 and t.project_id = ? and ${HAS_FLAG} order by t.updated_at desc, t.number desc`).all(projectId, "needs_human").map(toTicket);
  const active = db.prepare(`${SELECT} join lanes l on l.id = t.lane_id where t.archived = 0 and t.project_id = ? and t.assignee_id is not null and l.is_done = 0 and not ${HAS_FLAG} order by t.updated_at desc`).all(projectId, "needs_human").map(toTicket);
  return { needsHuman, active };
}
