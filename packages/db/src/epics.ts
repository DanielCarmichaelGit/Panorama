import { randomUUID } from "node:crypto";
import type { Epic, Family } from "@panorama/core";
import type { DB } from "./open";

const toEpic = (r: any): Epic => ({
  id: r.id, projectId: r.project_id, name: r.name, description: r.description, family: r.family,
  position: r.position, archived: !!r.archived, createdAt: r.created_at,
});

export const listEpics = (db: DB, projectId: string, opts: { includeArchived?: boolean } = {}): Epic[] => {
  const where = opts.includeArchived ? "project_id = ?" : "project_id = ? and archived = 0";
  return db.prepare(`select * from epics where ${where} order by position`).all(projectId).map(toEpic);
};

export const getEpic = (db: DB, id: string): Epic | undefined => {
  const r = db.prepare("select * from epics where id = ?").get(id);
  return r ? toEpic(r) : undefined;
};

export function createEpic(db: DB, input: { projectId: string; name: string; description?: string | null; family?: Family }, now: string): Epic {
  const id = randomUUID();
  const position = ((db.prepare("select max(position) m from epics where project_id = ?").get(input.projectId) as { m: number | null }).m ?? 0) + 1;
  db.prepare("insert into epics(id, project_id, name, description, family, position, created_at) values(?,?,?,?,?,?,?)")
    .run(id, input.projectId, input.name, input.description ?? null, input.family ?? "stone", position, now);
  return getEpic(db, id)!;
}

export function updateEpic(
  db: DB,
  id: string,
  patch: { name?: string; description?: string | null; family?: Family; archived?: boolean; position?: number },
  now: string
): Epic {
  void now; // epics have no updated_at column: kept for interface symmetry with other update* functions
  const cols: Record<string, unknown> = {};
  if (patch.name !== undefined) cols.name = patch.name;
  if (patch.description !== undefined) cols.description = patch.description;
  if (patch.family !== undefined) cols.family = patch.family;
  if (patch.archived !== undefined) cols.archived = patch.archived ? 1 : 0;
  if (patch.position !== undefined) cols.position = patch.position;
  const keys = Object.keys(cols);
  if (keys.length > 0) db.prepare(`update epics set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`).run(...keys.map((k) => cols[k]), id);
  return getEpic(db, id)!;
}
