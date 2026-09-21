import { canonical } from "./canonical";
import { sha256Hex } from "./hash";

export const GENESIS = "0".repeat(64);
export interface ChainEvent { seq: number; prevHash: string; hash: string; actorId: string; type: string; payload: unknown; createdAt: string }

export function hashEvent(e: Omit<ChainEvent, "hash">): string {
  return sha256Hex(e.prevHash + canonical({ seq: e.seq, actorId: e.actorId, type: e.type, payload: e.payload, createdAt: e.createdAt }));
}

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
