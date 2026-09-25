import { randomUUID } from "node:crypto";
import { DEFAULT_EVIDENCE_TYPES } from "@panorama/core";
import type { DB } from "./open";
const M1 = `
create table actors(id text primary key, kind text not null check(kind in('human','agent')), name text not null, public_key text not null unique,
  scopes text, status text not null check(status in('pending','active','revoked')), last_seen text, created_at text not null);
create table projects(id text primary key, key text not null unique, name text not null, next_number integer not null default 1, created_at text not null);
create table lanes(id text primary key, project_id text not null references projects(id), name text not null, position integer not null, family text not null,
  sets_needs_human integer not null default 0, is_done integer not null default 0, evidence_requirements text not null default '[]');
create table tickets(id text primary key, project_id text not null references projects(id), number integer not null, title text not null,
  lane_id text not null references lanes(id), position real not null, flags text not null default '[]', assignee_id text references actors(id),
  start_date text, due_date text, metadata text not null default '{}', archived integer not null default 0, created_at text not null, updated_at text not null,
  unique(project_id, number));
create index tickets_lane on tickets(lane_id, position);
create table events(seq integer primary key, prev_hash text not null, hash text not null, actor_id text not null, type text not null,
  payload text not null, signature text not null, created_at text not null);
create trigger events_no_update before update on events begin select raise(abort, 'events are append-only'); end;
create trigger events_no_delete before delete on events begin select raise(abort, 'events are append-only'); end;
create table checkpoints(seq integer primary key, head_hash text not null, signature text not null, created_at text not null);
`;
// Checkpoints are the anchor the chain is verified against, so they are as append-only
// as the events themselves. Nothing to backfill: seq was already the primary key.
const M2 = `
create trigger checkpoints_no_update before update on checkpoints begin select raise(abort, 'checkpoints are append-only'); end;
create trigger checkpoints_no_delete before delete on checkpoints begin select raise(abort, 'checkpoints are append-only'); end;
`;
const M3 = `
create table evidence_types(id text primary key, name text not null unique, kind text not null, params text not null default '{}',
  human_only integer not null default 0, needs_attachment integer not null default 0, created_at text not null);
create table comments(id text primary key, ticket_id text not null references tickets(id), actor_id text not null references actors(id),
  body text not null, created_at text not null);
create index comments_ticket on comments(ticket_id, created_at);
create trigger comments_no_update before update on comments begin select raise(abort, 'comments are append-only'); end;
create trigger comments_no_delete before delete on comments begin select raise(abort, 'comments are append-only'); end;
create table attachments(id text primary key, ticket_id text not null references tickets(id), comment_id text references comments(id),
  actor_id text not null references actors(id), filename text not null, mime text not null, size integer not null, sha256 text not null, created_at text not null);
create index attachments_ticket on attachments(ticket_id, created_at);
create trigger attachments_no_delete before delete on attachments begin select raise(abort, 'attachments are append-only'); end;
create table evidence(id text primary key, ticket_id text not null references tickets(id), type_id text not null references evidence_types(id),
  comment_id text references comments(id), attachment_id text references attachments(id), actor_id text not null references actors(id),
  payload text not null, result text not null check(result in('pass','fail','info')), created_at text not null);
create index evidence_ticket on evidence(ticket_id, created_at);
create trigger evidence_no_update before update on evidence begin select raise(abort, 'evidence is append-only'); end;
create trigger evidence_no_delete before delete on evidence begin select raise(abort, 'evidence is append-only'); end;
` + DEFAULT_EVIDENCE_TYPES.map((e) => `insert into evidence_types(id, name, kind, params, human_only, needs_attachment, created_at) values(${[e.id, e.name, e.kind, JSON.stringify(e.params)].map((v) => `'${v}'`).join(",")}, ${e.humanOnly ? 1 : 0}, ${e.needsAttachment ? 1 : 0}, '2026-09-22T00:00:00.000Z');`).join("\n");
// DEFAULT_EVIDENCE_TYPES is a fixed constant in @panorama/core: its id, name, kind, and
// params values are hardcoded literals containing no quote characters, so interpolating
// them into this migration string is safe. This is the one exception to bound parameters;
// everything else in this file (and every other query in this package) uses them.
// current_ticket_id is presence, not history: it tracks what an agent is on right now, set
// and cleared as tickets are created and moved (see routes/tickets.ts), never logged as its
// own chain event.
const M4 = `
alter table actors add column current_ticket_id text references tickets(id);
`;
// Boards group tickets inside a project the way epics categorise them (added by the owner on
// 2026-09-24). The table is plain SQL, but the backfill needs a UUID per existing project and a
// row scan, so M5 is a function migration rather than a static string like M1-M4: every project
// that predates this migration gets a default board named after it, family stone, position 0,
// and every one of its tickets is pointed at that board. From here on `board_id` is required by
// the repositories (createTicket always supplies one), even though SQLite cannot retrofit a NOT
// NULL constraint onto an existing column without rebuilding the table.
function M5(db: DB): void {
  db.exec(`
    create table boards(id text primary key, project_id text not null references projects(id), name text not null,
      description text, family text not null, position integer not null, created_at text not null);
    create index boards_project on boards(project_id, position);
    alter table tickets add column board_id text references boards(id);
  `);
  const now = new Date().toISOString();
  const projects = db.prepare("select id, name from projects").all() as { id: string; name: string }[];
  const insertBoard = db.prepare("insert into boards(id, project_id, name, description, family, position, created_at) values(?,?,?,?,?,?,?)");
  const backfillTickets = db.prepare("update tickets set board_id = ? where project_id = ?");
  for (const p of projects) {
    const boardId = randomUUID();
    insertBoard.run(boardId, p.id, p.name, null, "stone", 0, now);
    backfillTickets.run(boardId, p.id);
  }
}
// The ticket model milestone (2b): epics group tickets the way boards do but looser, tags
// classify freely (unique per project, case-insensitively, hence the lower(name) index),
// ticket_links record dependencies and relations between tickets, and field_definitions with
// ticket_field_values let the owner attach custom, typed data to tickets. tickets gains two
// plain columns: epic_id (nullable, a ticket belongs to at most one epic) and success_criteria
// (markdown, empty by default). A fresh install and an upgrade both just get the columns and
// empty tables, so this is a static string like M1-M4, not a backfill function like M5.
const M6 = `
create table epics(id text primary key, project_id text not null references projects(id), name text not null, description text,
  family text not null, position integer not null, archived integer not null default 0, created_at text not null);
create index epics_project on epics(project_id, position);
create table tags(id text primary key, project_id text not null references projects(id), name text not null, family text not null,
  archived integer not null default 0, created_at text not null);
create unique index tags_project_name on tags(project_id, lower(name));
create table ticket_tags(ticket_id text not null references tickets(id), tag_id text not null references tags(id), primary key(ticket_id, tag_id));
create table ticket_links(id text primary key, project_id text not null references projects(id), from_id text not null references tickets(id),
  to_id text not null references tickets(id), kind text not null check(kind in('blocks','relates')), created_at text not null,
  unique(from_id, to_id, kind));
create table field_definitions(id text primary key, project_id text not null references projects(id), name text not null, key text not null,
  kind text not null check(kind in('text','number','date','select','checkbox')), options text not null default '[]', required integer not null default 0,
  position integer not null, archived integer not null default 0, created_at text not null, unique(project_id, key));
create table ticket_field_values(ticket_id text not null references tickets(id), field_id text not null references field_definitions(id),
  value text not null, primary key(ticket_id, field_id));
alter table tickets add column epic_id text references epics(id);
alter table tickets add column success_criteria text not null default '';
`;
// The settings refresh (2c): an arc (epic) or a tag may carry its own `#rrggbb` colour, which
// wins over its family when set. Nullable, so every existing row simply keeps its family.
const M7 = `
alter table epics add column color text;
alter table tags add column color text;
`;
// The file field kind (2c, task 5): field_definitions.kind carries a CHECK listing the kinds,
// and SQLite cannot alter a CHECK in place, so the table is rebuilt with "file" in the list.
// ticket_field_values references field_definitions(id), and dropping a referenced table with
// foreign keys on is refused while child rows exist, so the child is rebuilt alongside it:
// both new tables are filled, the old pair dropped (child first), and the new pair renamed
// into place. A rename rewrites the references other tables hold, so the child ends up
// pointing at the renamed parent. Nothing else references either table.
const M8 = `
create table field_definitions_new(id text primary key, project_id text not null references projects(id), name text not null, key text not null,
  kind text not null check(kind in('text','number','date','select','checkbox','file')), options text not null default '[]', required integer not null default 0,
  position integer not null, archived integer not null default 0, created_at text not null, unique(project_id, key));
insert into field_definitions_new select id, project_id, name, key, kind, options, required, position, archived, created_at from field_definitions;
create table ticket_field_values_new(ticket_id text not null references tickets(id), field_id text not null references field_definitions_new(id),
  value text not null, primary key(ticket_id, field_id));
insert into ticket_field_values_new select ticket_id, field_id, value from ticket_field_values;
drop table ticket_field_values;
drop table field_definitions;
alter table field_definitions_new rename to field_definitions;
alter table ticket_field_values_new rename to ticket_field_values;
`;
type Migration = string | ((db: DB) => void);
const MIGRATIONS: Migration[] = [M1, M2, M3, M4, M5, M6, M7, M8];

/** Applies migrations up to (not including index) `version`. Exported so a test can stop a
 *  fresh database at M4, seed pre-boards data, then call `migrate` to exercise the M5 backfill
 *  the way an upgrading install would actually hit it. */
export function migrateTo(db: DB, version: number): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < version; i++) {
    db.transaction(() => {
      const m = MIGRATIONS[i];
      if (typeof m === "string") db.exec(m);
      else m(db);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export function migrate(db: DB): void {
  migrateTo(db, MIGRATIONS.length);
}
