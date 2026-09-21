import type { FastifyInstance } from "fastify";
import { CheckpointInput, GENESIS, verifyChain, verifyText, type ChainEvent } from "@panorama/core";
import { addCheckpoint, latestCheckpoint, listEvents, type DB } from "@panorama/db";
import { getDb, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export type ChainReason = "hash" | "truncated" | "checkpoint_mismatch" | "checkpoint_signature" | "empty";
export type ChainBroken = { ok: false; brokenAt: number; reason: ChainReason };
export type ChainVerified = { ok: true; head: string; seq: number; checkpointSeq: number | null };

/**
 * Verifies the whole chain and then anchors it to the last checkpoint the owner signed.
 * The chain walk alone proves internal consistency, which an attacker with the database
 * file can recreate: it must also end where the owner last signed that it ended.
 */
async function verifyFully(ctx: Ctx, db: DB): Promise<{ result: ChainVerified | ChainBroken; events: ChainEvent[] }> {
  const events = listEvents(db);
  const broken = (brokenAt: number, reason: ChainReason) => ({ result: { ok: false as const, brokenAt, reason }, events });
  if (events.length === 0) return broken(1, "empty");
  if (events[0].seq !== 1) return broken(1, "truncated");
  const chain = verifyChain(events, GENESIS);
  if (!chain.ok) return broken(chain.brokenAt, "hash");

  const lastSeq = events[events.length - 1].seq;
  const cp = latestCheckpoint(db);
  if (cp) {
    if (!(await verifyText(ctx.config!.humanPublicKey, `${cp.seq}:${cp.headHash}`, cp.signature))) return broken(cp.seq, "checkpoint_signature");
    const at = events.find((e) => e.seq === cp.seq);
    if (!at) return broken(lastSeq + 1, "truncated");
    if (at.hash !== cp.headHash) return broken(cp.seq, "checkpoint_mismatch");
  }
  return { result: { ok: true, head: chain.head, seq: lastSeq, checkpointSeq: cp?.seq ?? null }, events };
}

export function chainRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/api/v1/chain/verify", async (req) => {
    requireCan(req, "checkpoint.create");
    const { result, events } = await verifyFully(ctx, getDb(ctx));
    if (!result.ok) return result;
    // The browser keeps its own anchor and asks for the hash at that seq, which catches a
    // rollback of the checkpoints table that the server alone cannot see.
    const asked = (req.query as { anchorSeq?: string } | undefined)?.anchorSeq;
    if (asked === undefined) return result;
    const anchorSeq = Number(asked);
    return { ...result, anchorHash: (Number.isInteger(anchorSeq) ? events.find((e) => e.seq === anchorSeq)?.hash : null) ?? null };
  });

  app.post("/api/v1/checkpoints", async (req) => {
    requireCan(req, "checkpoint.create");
    const db = getDb(ctx);
    const input = CheckpointInput.parse(req.body);
    const { result } = await verifyFully(ctx, db);
    const good =
      result.ok &&
      input.seq === result.seq &&
      input.headHash === result.head &&
      (await verifyText(ctx.config!.humanPublicKey, `${input.seq}:${input.headHash}`, input.signature));
    if (!good) throw new HttpError(400, "bad_checkpoint", "Checkpoint does not match the verified chain head");
    addCheckpoint(db, { seq: input.seq, headHash: input.headHash, signature: input.signature, now: ctx.now().toISOString() });
    return { ok: true };
  });
}
