import { randomUUID } from "node:crypto";
import type { FieldDefinition, FieldKind, FieldValue } from "@boomerang/core";
import type { DB } from "./open";

const toField = (r: any): FieldDefinition => ({
  id: r.id, projectId: r.project_id, name: r.name, key: r.key, kind: r.kind, options: JSON.parse(r.options),
  required: !!r.required, position: r.position, archived: !!r.archived, createdAt: r.created_at,
});

export const listFields = (db: DB, projectId: string, opts: { includeArchived?: boolean } = {}): FieldDefinition[] => {
  const where = opts.includeArchived ? "project_id = ?" : "project_id = ? and archived = 0";
  return db.prepare(`select * from field_definitions where ${where} order by position`).all(projectId).map(toField);
};

export const getField = (db: DB, id: string): FieldDefinition | undefined => {
  const r = db.prepare("select * from field_definitions where id = ?").get(id);
  return r ? toField(r) : undefined;
};

export function createField(
  db: DB,
  input: { projectId: string; name: string; key: string; kind: FieldKind; options?: { value: string; label: string }[]; required?: boolean },
  now: string
): FieldDefinition {
  const id = randomUUID();
  const position = ((db.prepare("select max(position) m from field_definitions where project_id = ?").get(input.projectId) as { m: number | null }).m ?? 0) + 1;
  try {
    db.prepare("insert into field_definitions(id, project_id, name, key, kind, options, required, position, created_at) values(?,?,?,?,?,?,?,?,?)")
      .run(id, input.projectId, input.name, input.key, input.kind, JSON.stringify(input.options ?? []), input.required ? 1 : 0, position, now);
  } catch (e) {
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("duplicate_key");
    throw e;
  }
  return getField(db, id)!;
}

export function updateField(
  db: DB,
  id: string,
  patch: { name?: string; options?: { value: string; label: string }[]; required?: boolean; position?: number; archived?: boolean }
): FieldDefinition {
  const cols: Record<string, unknown> = {};
  if (patch.name !== undefined) cols.name = patch.name;
  if (patch.options !== undefined) cols.options = JSON.stringify(patch.options);
  if (patch.required !== undefined) cols.required = patch.required ? 1 : 0;
  if (patch.position !== undefined) cols.position = patch.position;
  if (patch.archived !== undefined) cols.archived = patch.archived ? 1 : 0;
  const keys = Object.keys(cols);
  if (keys.length > 0) db.prepare(`update field_definitions set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`).run(...keys.map((k) => cols[k]), id);
  return getField(db, id)!;
}

/** Only values for non-archived definitions: an archived field's value stays in the table
 *  (nothing deletes it), it is simply left out of what the ticket reports. */
export function getTicketFields(db: DB, ticketId: string): Record<string, FieldValue> {
  const rows = db.prepare(
    `select fd.key as key, v.value as value from ticket_field_values v
     join field_definitions fd on fd.id = v.field_id
     where v.ticket_id = ? and fd.archived = 0`
  ).all(ticketId) as { key: string; value: string }[];
  const out: Record<string, FieldValue> = {};
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

/** Upserts by key against the ticket's own project. A `null` value deletes the row (clears the
 *  field); a key with no matching definition is ignored, since validation already happened
 *  upstream (the server checks values against definitions before calling this). */
export function setTicketFields(db: DB, ticketId: string, values: Record<string, FieldValue>): void {
  const ticket = db.prepare("select project_id from tickets where id = ?").get(ticketId) as { project_id: string } | undefined;
  if (!ticket) return;
  const defByKey = new Map(
    (db.prepare("select id, key from field_definitions where project_id = ?").all(ticket.project_id) as { id: string; key: string }[])
      .map((d) => [d.key, d.id])
  );
  const upsert = db.prepare(
    "insert into ticket_field_values(ticket_id, field_id, value) values(?,?,?) on conflict(ticket_id, field_id) do update set value = excluded.value"
  );
  const del = db.prepare("delete from ticket_field_values where ticket_id = ? and field_id = ?");
  for (const [key, value] of Object.entries(values)) {
    const fieldId = defByKey.get(key);
    if (!fieldId) continue;
    if (value === null) del.run(ticketId, fieldId);
    else upsert.run(ticketId, fieldId, JSON.stringify(value));
  }
}
