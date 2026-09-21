import type { FastifyInstance } from "fastify";
import { CheckpointInput, verifyChain, verifyText } from "@panorama/core";
import { addCheckpoint, latestCheckpoint, listEvents } from "@panorama/db";
import { getDb, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export function chainRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/api/v1/chain/verify", async (req) => {
    requireCan(req, "checkpoint.create");
    const db = getDb(ctx); const events = listEvents(db); const result = verifyChain(events);
    if (!result.ok) return result;
    return { ok: true, head: result.head, seq: events.length ? events[events.length - 1].seq : 0, checkpointSeq: latestCheckpoint(db)?.seq ?? null };
  });
  app.post("/api/v1/checkpoints", async (req) => {
    requireCan(req, "checkpoint.create");
    const db = getDb(ctx); const input = CheckpointInput.parse(req.body);
    const events = listEvents(db); const result = verifyChain(events);
    if (!result.ok || result.head !== input.headHash || !(await verifyText(ctx.config!.humanPublicKey, input.headHash, input.signature)))
      throw new HttpError(400, "bad_checkpoint", "Checkpoint does not match the verified chain head");
    addCheckpoint(db, { seq: events[events.length - 1].seq, headHash: input.headHash, signature: input.signature, now: ctx.now().toISOString() });
    return { ok: true };
  });
}
