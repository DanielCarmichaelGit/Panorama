import type { ChainEvent } from "@boomerang/core";
import { appendEvent, type DB } from "@boomerang/db";
import type { Ctx } from "../context";

/** Events the server appends on its own (a schedule firing, a due date passing, a delivery
 *  giving up) carry this actor and no signature: nobody signed them, and the chain hash is
 *  what binds them. */
export const SYSTEM_ACTOR = "system";

/** Hands committed events on: the engine hook first, if one was wired, then the stream bus,
 *  the same order the routes' onResponse path gives request-made events. */
export type OnEvents = (db: DB, events: ChainEvent[]) => void;

export const appendSystemEvent = (db: DB, type: string, payload: unknown, now: string): ChainEvent =>
  appendEvent(db, { actorId: SYSTEM_ACTOR, type, payload, signature: "", now });

/** Call after the transaction that appended `events` has committed, never inside it. */
export function publishEvents(ctx: Ctx, db: DB, events: ChainEvent[], onEvents?: OnEvents, log: (m: string) => void = console.warn): void {
  if (events.length === 0) return;
  if (onEvents) {
    try {
      onEvents(db, events);
    } catch (e) {
      log(`workers: event hook failed: ${(e as Error).message}`);
    }
  }
  for (const ev of events) ctx.bus.publish({ seq: ev.seq, type: ev.type, payload: ev.payload, at: ev.createdAt });
}
