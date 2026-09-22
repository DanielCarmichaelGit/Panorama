import { canonical } from "./canonical";
import { sha256Hex } from "./hash";

export const GENESIS = "0".repeat(64);
export interface ChainEvent { seq: number; prevHash: string; hash: string; actorId: string; type: string; payload: unknown; createdAt: string }

export function hashEvent(e: Omit<ChainEvent, "hash">): string {
  return sha256Hex(e.prevHash + canonical({ seq: e.seq, actorId: e.actorId, type: e.type, payload: e.payload, createdAt: e.createdAt }));
}

/**
 * Walks a run of events and checks that each one follows the previous. It starts from
 * whatever seq the first event carries, so a caller verifying a whole chain must also
 * check that the first seq is 1: without that check a chain whose head was cut off and
 * re-hashed from GENESIS still verifies. The server's verify route does both, and then
 * compares the result against the last signed checkpoint.
 */
export function verifyChain(events: ChainEvent[], startPrev: string = GENESIS): { ok: true; head: string } | { ok: false; brokenAt: number } {
  let prev = startPrev;
  let expectedSeq = events.length ? events[0].seq : 1;
  for (const e of events) {
    if (e.seq !== expectedSeq || e.prevHash !== prev || hashEvent(e) !== e.hash) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
    expectedSeq += 1;
  }
  return { ok: true, head: prev };
}
