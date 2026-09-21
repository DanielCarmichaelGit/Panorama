import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { SetupInput, UnlockInput, verifyRequest } from "@panorama/core";
import { appendEvent, insertActor, migrate, openDatabase, writeConfig } from "@panorama/db";
import { getDb, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export const dbFile = (ctx: Ctx) => join(ctx.dataDir, "panorama.db");

export function lifecycleRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/api/v1/health", async () => ({ ok: true }));

  app.get("/api/v1/status", async () => {
    if (!ctx.config) return { state: "uninitialized" };
    const { kdfSalt, argon, humanPublicKey, encryption } = ctx.config;
    return { state: ctx.db ? "unlocked" : "locked", kdfSalt, argon, humanPublicKey, encryption };
  });

  app.post("/api/v1/setup", async (req) => {
    if (ctx.config) throw new HttpError(409, "already_setup", "Panorama is already set up");
    const input = SetupInput.parse(req.body);
    if (input.encryption !== (input.dbKey !== null)) throw new HttpError(400, "validation", "dbKey must be present exactly when encryption is on");
    const ok = await verifyRequest(input.publicKey, req.headers as any, "POST", req.url, req.rawBody ?? "", ctx.now().getTime());
    if (!ok) throw new HttpError(401, "bad_signature", "Setup must be signed by the key it registers");
    const db = openDatabase(dbFile(ctx), input.dbKey);
    migrate(db);
    const now = ctx.now().toISOString();
    db.transaction(() => {
      insertActor(db, { id: "human", kind: "human", name: "Owner", publicKey: input.publicKey, scopes: null, status: "active", lastSeen: now, createdAt: now });
      appendEvent(db, { actorId: "human", type: "system.setup", payload: { encryption: input.encryption }, signature: String(req.headers["x-pan-sig"]), now });
    })();
    const config = { kdfSalt: input.kdfSalt, argon: input.argon, humanPublicKey: input.publicKey, encryption: input.encryption };
    writeConfig(ctx.dataDir, config);
    ctx.config = config;
    ctx.db = db;
    return { ok: true };
  });

  app.post("/api/v1/unlock", async (req) => {
    if (!ctx.config) throw new HttpError(409, "not_setup", "Panorama is not set up");
    if (ctx.db) return { ok: true };
    const { dbKey } = UnlockInput.parse(req.body);
    try {
      ctx.db = openDatabase(dbFile(ctx), dbKey);
    } catch {
      throw new HttpError(401, "bad_key", "That key does not open this database");
    }
    migrate(ctx.db);
    return { ok: true };
  });

  app.post("/api/v1/lock", async (req) => {
    requireCan(req, "lock");
    if (!ctx.config?.encryption) throw new HttpError(409, "not_encrypted", "Locking needs encryption to be on");
    appendEvent(getDb(ctx), { actorId: req.actor.id, type: "system.locked", payload: {}, signature: req.sig, now: ctx.now().toISOString() });
    ctx.db!.close(); ctx.db = null;
    return { ok: true };
  });
}
