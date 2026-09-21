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
const MIGRATIONS = [M1];
export function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) db.transaction(() => { db.exec(MIGRATIONS[i]); db.pragma(`user_version = ${i + 1}`); })();
}
