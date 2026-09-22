import { randomUUID } from "node:crypto";
import { DEFAULT_LANES, type Lane, type LaneRequirement, type Project } from "@panorama/core";
import type { DB } from "./open";
const toProject = (r: any): Project => ({ id: r.id, key: r.key, name: r.name, createdAt: r.created_at });
const toLane = (r: any): Lane => ({ id: r.id, projectId: r.project_id, name: r.name, position: r.position, family: r.family, setsNeedsHuman: !!r.sets_needs_human, isDone: !!r.is_done, evidenceRequirements: JSON.parse(r.evidence_requirements) });
export function createProject(db: DB, input: { name: string; key: string }, now: string): { project: Project; lanes: Lane[] } {
  const id = randomUUID();
  db.prepare("insert into projects(id, key, name, created_at) values(?,?,?,?)").run(id, input.key, input.name, now);
  const ins = db.prepare("insert into lanes(id, project_id, name, position, family, sets_needs_human, is_done, evidence_requirements) values(?,?,?,?,?,?,?,?)");
  DEFAULT_LANES.forEach((l, i) => ins.run(randomUUID(), id, l.name, i, l.family, l.setsNeedsHuman ? 1 : 0, l.isDone ? 1 : 0, JSON.stringify(l.evidenceRequirements)));
  return { project: getProject(db, id)!, lanes: listLanes(db, id) };
}
export const listProjects = (db: DB): Project[] => db.prepare("select * from projects order by created_at").all().map(toProject);
export const getProject = (db: DB, id: string): Project | undefined => { const r = db.prepare("select * from projects where id = ?").get(id); return r ? toProject(r) : undefined; };
export const listLanes = (db: DB, projectId: string): Lane[] => db.prepare("select * from lanes where project_id = ? order by position").all(projectId).map(toLane);
export const getLane = (db: DB, id: string): Lane | undefined => { const r = db.prepare("select * from lanes where id = ?").get(id); return r ? toLane(r) : undefined; };
export function setLaneRequirements(db: DB, laneId: string, requirements: LaneRequirement[]): Lane {
  db.prepare("update lanes set evidence_requirements = ? where id = ?").run(JSON.stringify(requirements), laneId);
  return getLane(db, laneId)!;
}
