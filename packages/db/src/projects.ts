import { randomUUID } from "node:crypto";
import { DEFAULT_LANES, type Board, type Family, type Lane, type LaneRequirement, type Project } from "@panorama/core";
import type { DB } from "./open";
const toProject = (r: any): Project => ({ id: r.id, key: r.key, name: r.name, createdAt: r.created_at });
const toLane = (r: any): Lane => ({ id: r.id, projectId: r.project_id, name: r.name, position: r.position, family: r.family, setsNeedsHuman: !!r.sets_needs_human, isDone: !!r.is_done, evidenceRequirements: JSON.parse(r.evidence_requirements) });
const toBoard = (r: any): Board => ({ id: r.id, projectId: r.project_id, name: r.name, description: r.description, family: r.family, position: r.position, createdAt: r.created_at });
export function createProject(db: DB, input: { name: string; key: string }, now: string): { project: Project; lanes: Lane[]; boards: Board[] } {
  const id = randomUUID();
  db.prepare("insert into projects(id, key, name, created_at) values(?,?,?,?)").run(id, input.key, input.name, now);
  const ins = db.prepare("insert into lanes(id, project_id, name, position, family, sets_needs_human, is_done, evidence_requirements) values(?,?,?,?,?,?,?,?)");
  DEFAULT_LANES.forEach((l, i) => ins.run(randomUUID(), id, l.name, i, l.family, l.setsNeedsHuman ? 1 : 0, l.isDone ? 1 : 0, JSON.stringify(l.evidenceRequirements)));
  createBoard(db, { projectId: id, name: input.name, description: null, family: "stone" }, now);
  return { project: getProject(db, id)!, lanes: listLanes(db, id), boards: listBoards(db, id) };
}
export const listProjects = (db: DB): Project[] => db.prepare("select * from projects order by created_at").all().map(toProject);
export const getProject = (db: DB, id: string): Project | undefined => { const r = db.prepare("select * from projects where id = ?").get(id); return r ? toProject(r) : undefined; };
export const listLanes = (db: DB, projectId: string): Lane[] => db.prepare("select * from lanes where project_id = ? order by position").all(projectId).map(toLane);
export const getLane = (db: DB, id: string): Lane | undefined => { const r = db.prepare("select * from lanes where id = ?").get(id); return r ? toLane(r) : undefined; };
export const listBoards = (db: DB, projectId: string): Board[] => db.prepare("select * from boards where project_id = ? order by position").all(projectId).map(toBoard);
export const getBoard = (db: DB, id: string): Board | undefined => { const r = db.prepare("select * from boards where id = ?").get(id); return r ? toBoard(r) : undefined; };
export function createBoard(db: DB, input: { projectId: string; name: string; description?: string | null; family?: Board["family"] }, now: string): Board {
  const id = randomUUID();
  const position = (db.prepare("select count(*) n from boards where project_id = ?").get(input.projectId) as { n: number }).n;
  db.prepare("insert into boards(id, project_id, name, description, family, position, created_at) values(?,?,?,?,?,?,?)")
    .run(id, input.projectId, input.name, input.description ?? null, input.family ?? "stone", position, now);
  return getBoard(db, id)!;
}
export function setLaneRequirements(db: DB, laneId: string, requirements: LaneRequirement[]): Lane {
  db.prepare("update lanes set evidence_requirements = ? where id = ?").run(JSON.stringify(requirements), laneId);
  return getLane(db, laneId)!;
}

/** A new lane lands immediately before the first done lane by position (so the done lanes
 *  stay at the end of the board, and a done lane toggled mid-board does not capture new
 *  lanes behind it), or at the end when the project has no done lane. Rows from that
 *  position on shift down one. Name uniqueness is the route's job: it has the message to give. */
export function createLane(db: DB, input: { projectId: string; name: string; family: Family; setsNeedsHuman: boolean; isDone: boolean }, now: string): Lane {
  void now; // lanes have no created_at column: kept for symmetry with the other create* functions
  const id = randomUUID();
  const firstDone = db.prepare("select min(position) m from lanes where project_id = ? and is_done = 1").get(input.projectId) as { m: number | null };
  const count = (db.prepare("select count(*) n from lanes where project_id = ?").get(input.projectId) as { n: number }).n;
  const position = firstDone.m === null ? count : firstDone.m;
  db.prepare("update lanes set position = position + 1 where project_id = ? and position >= ?").run(input.projectId, position);
  db.prepare("insert into lanes(id, project_id, name, position, family, sets_needs_human, is_done, evidence_requirements) values(?,?,?,?,?,?,?,'[]')")
    .run(id, input.projectId, input.name, position, input.family, input.setsNeedsHuman ? 1 : 0, input.isDone ? 1 : 0);
  return getLane(db, id)!;
}

export function updateLane(db: DB, id: string, patch: { family?: Family; setsNeedsHuman?: boolean; isDone?: boolean }): Lane {
  const cols: Record<string, unknown> = {};
  if (patch.family !== undefined) cols.family = patch.family;
  if (patch.setsNeedsHuman !== undefined) cols.sets_needs_human = patch.setsNeedsHuman ? 1 : 0;
  if (patch.isDone !== undefined) cols.is_done = patch.isDone ? 1 : 0;
  const keys = Object.keys(cols);
  if (keys.length > 0) db.prepare(`update lanes set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`).run(...keys.map((k) => cols[k]), id);
  return getLane(db, id)!;
}

/** `ids` must be exactly the project's lanes, each once, or nothing changes ("lane_set_mismatch"). */
export function reorderLanes(db: DB, projectId: string, ids: string[]): Lane[] {
  const current = listLanes(db, projectId).map((l) => l.id);
  const wanted = new Set(ids);
  if (ids.length !== current.length || wanted.size !== ids.length || current.some((id) => !wanted.has(id))) throw new Error("lane_set_mismatch");
  const set = db.prepare("update lanes set position = ? where id = ?");
  ids.forEach((id, i) => set.run(i, id));
  return listLanes(db, projectId);
}

/** Counts every ticket in the lane, archived ones included: an archived ticket still points at
 *  its lane and the foreign key would refuse the delete anyway. Deletes only when the count is 0. */
export function deleteLane(db: DB, id: string): { deleted: boolean; ticketCount: number } {
  const ticketCount = (db.prepare("select count(*) n from tickets where lane_id = ?").get(id) as { n: number }).n;
  if (ticketCount > 0) return { deleted: false, ticketCount };
  db.prepare("delete from lanes where id = ?").run(id);
  return { deleted: true, ticketCount };
}
