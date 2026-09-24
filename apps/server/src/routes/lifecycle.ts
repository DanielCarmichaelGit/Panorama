import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { ARGON, SetupInput, UnlockInput, verifyRequest } from "@panorama/core";
import { appendEvent, insertActor, migrate, openDatabase, writeConfig } from "@panorama/db";
import { getDb, requireCan } from "../auth";
import { record } from "../bus";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export const dbFile = (ctx: Ctx) => join(ctx.dataDir, "panorama.db");

const weakKdf = (argon: { iterations: number; memorySize: number; parallelism: number }) =>
  argon.iterations < ARGON.iterations || argon.memorySize < ARGON.memorySize || argon.parallelism < ARGON.parallelism;

export function lifecycleRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/api/v1/health", async () => ({ ok: true }));

  app.get("/api/v1/status", async () => {
    if (!ctx.config) return { state: "uninitialized" };
    const { kdfSalt, argon, humanPublicKey, encryption } = ctx.config;
    return { state: ctx.db ? "unlocked" : "locked", kdfSalt, argon, humanPublicKey, encryption };
  });

  app.post("/api/v1/setup", async (req) => {
    if (ctx.config) throw new HttpError(409, "already_setup", "Panorama is already set up");
    const file = dbFile(ctx);
    // A database without a config.json is still somebody's data: never open it with a new key.
    if (existsSync(file)) throw new HttpError(409, "already_setup", "A database is already in this data directory");
    const input = SetupInput.parse(req.body);
    if (input.encryption !== (input.dbKey !== null)) throw new HttpError(400, "validation", "dbKey must be present exactly when encryption is on");
    if (!ctx.allowFastKdf && weakKdf(input.argon)) throw new HttpError(400, "weak_kdf", "Those Argon2 parameters are too weak for a password that guards everything");
    const ok = await verifyRequest(input.publicKey, req.headers as any, "POST", req.url, req.rawBody ?? "", ctx.now().getTime());
    if (!ok) throw new HttpError(401, "bad_signature", "Setup must be signed by the key it registers");

    // First run on a fresh machine: PANORAMA_DATA_DIR need not exist yet.
    mkdirSync(ctx.dataDir, { recursive: true });
    const db = openDatabase(file, input.dbKey);
    try {
      chmodSync(file, 0o600);
      migrate(db);
      const now = ctx.now().toISOString();
      db.transaction(() => {
        insertActor(db, { id: "human", kind: "human", name: "Owner", publicKey: input.publicKey, scopes: null, status: "active", lastSeen: now, createdAt: now });
        const ev = appendEvent(db, { actorId: "human", type: "system.setup", payload: { encryption: input.encryption }, signature: String(req.headers["x-pan-sig"]), now });
        record(req, ev);
      })();
      const config = { kdfSalt: input.kdfSalt, argon: input.argon, humanPublicKey: input.publicKey, encryption: input.encryption };
      writeConfig(ctx.dataDir, config);
      ctx.config = config;
      ctx.db = db;
      ctx.fileKey = input.encryption ? Buffer.from(input.dbKey as string, "hex") : null;
      return { ok: true };
    } catch (e) {
      // Nothing here existed before this request, so take the whole half-built database with us.
      db.close();
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
      throw e;
    }
  });

  app.post("/api/v1/unlock", async (req) => {
    if (!ctx.config) throw new HttpError(409, "not_setup", "Panorama is not set up");
    if (ctx.db) return { ok: true };
    const encryption = ctx.config.encryption;
    const { dbKey } = UnlockInput.parse(req.body);
    try {
      ctx.db = openDatabase(dbFile(ctx), dbKey);
    } catch (e) {
      if (e instanceof Error && e.message === "bad_key") throw new HttpError(401, "bad_key", "That key does not open this database");
      throw new HttpError(500, "open_failed", "The database is there but could not be opened", { reason: (e as Error).message });
    }
    migrate(ctx.db);
    ctx.fileKey = encryption ? Buffer.from(dbKey, "hex") : null;
    return { ok: true };
  });

  app.post("/api/v1/lock", async (req) => {
    requireCan(req, "lock");
    if (!ctx.config?.encryption) throw new HttpError(409, "not_encrypted", "Locking needs encryption to be on");
    const ev = appendEvent(getDb(ctx), { actorId: req.actor.id, type: "system.locked", payload: {}, signature: req.sig, now: ctx.now().toISOString() });
    record(req, ev);
    ctx.bus.closeAll();
    ctx.db!.close(); ctx.db = null;
    ctx.fileKey = null;
    return { ok: true };
  });
}
