import { GENESIS, hashEvent, type ChainEvent } from "@panorama/core";
import type { DB } from "./open";
const toEvent = (r: any): ChainEvent => ({ seq: r.seq, prevHash: r.prev_hash, hash: r.hash, actorId: r.actor_id, type: r.type, payload: JSON.parse(r.payload), createdAt: r.created_at });

export function appendEvent(db: DB, e: { actorId: string; type: string; payload: unknown; signature: string; now: string }): ChainEvent {
  const last = db.prepare("select seq, hash from events order by seq desc limit 1").get() as { seq: number; hash: string } | undefined;
  // Normalise through JSON so the hashed payload equals what listEvents reads back.
  const payload = JSON.parse(JSON.stringify(e.payload ?? null));
  const base = { seq: (last?.seq ?? 0) + 1, prevHash: last?.hash ?? GENESIS, actorId: e.actorId, type: e.type, payload, createdAt: e.now };
  const ev = { ...base, hash: hashEvent(base) };
  db.prepare("insert into events(seq, prev_hash, hash, actor_id, type, payload, signature, created_at) values(?,?,?,?,?,?,?,?)")
    .run(ev.seq, ev.prevHash, ev.hash, ev.actorId, ev.type, JSON.stringify(payload), e.signature, ev.createdAt);
  return ev;
}
export const listEvents = (db: DB, afterSeq = 0): ChainEvent[] => db.prepare("select * from events where seq > ? order by seq").all(afterSeq).map(toEvent);
export function latestCheckpoint(db: DB): { seq: number; headHash: string } | null {
  const r = db.prepare("select seq, head_hash from checkpoints order by seq desc limit 1").get() as any;
  return r ? { seq: r.seq, headHash: r.head_hash } : null;
}
export const addCheckpoint = (db: DB, c: { seq: number; headHash: string; signature: string; now: string }): void => {
  db.prepare("insert or replace into checkpoints(seq, head_hash, signature, created_at) values(?,?,?,?)").run(c.seq, c.headHash, c.signature, c.now);
};
