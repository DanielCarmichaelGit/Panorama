import type { Actor, Scopes } from "@panorama/core";
import type { DB } from "./open";
const toActor = (r: any): Actor => ({ id: r.id, kind: r.kind, name: r.name, publicKey: r.public_key, scopes: r.scopes ? JSON.parse(r.scopes) : null, status: r.status, lastSeen: r.last_seen, createdAt: r.created_at });
export const insertActor = (db: DB, a: Actor): void => { db.prepare("insert into actors(id, kind, name, public_key, scopes, status, last_seen, created_at) values(?,?,?,?,?,?,?,?)").run(a.id, a.kind, a.name, a.publicKey, a.scopes ? JSON.stringify(a.scopes) : null, a.status, a.lastSeen, a.createdAt); };
export const getActor = (db: DB, id: string): Actor | undefined => { const r = db.prepare("select * from actors where id = ?").get(id); return r ? toActor(r) : undefined; };
export const listActors = (db: DB): Actor[] => db.prepare("select * from actors order by created_at").all().map(toActor);
export const setActorStatus = (db: DB, id: string, status: Actor["status"], scopes: Scopes | null): void => { db.prepare("update actors set status = ?, scopes = ? where id = ?").run(status, scopes ? JSON.stringify(scopes) : null, id); };
export const touchActor = (db: DB, id: string, now: string): void => { db.prepare("update actors set last_seen = ? where id = ?").run(now, id); };
export const countPending = (db: DB): number => (db.prepare("select count(*) c from actors where status = 'pending'").get() as { c: number }).c;
