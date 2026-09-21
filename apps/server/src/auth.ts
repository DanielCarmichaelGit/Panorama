import type { FastifyInstance, FastifyRequest } from "fastify";
import { can, verifyRequest, type Action, type Actor } from "@panorama/core";
import { getActor, touchActor, type DB } from "@panorama/db";
import type { Ctx } from "./context";
import { HttpError } from "./errors";

declare module "fastify" { interface FastifyRequest { actor: Actor; sig: string } }

export function getDb(ctx: Ctx): DB {
  if (!ctx.db) throw new HttpError(423, "locked", "Panorama is locked");
  return ctx.db;
}

export function requireCan(req: FastifyRequest, action: Action, projectId?: string): void {
  if (!can(req.actor, action, projectId)) throw new HttpError(403, "forbidden", `This key may not perform ${action}`);
}

export function installAuth(app: FastifyInstance, ctx: Ctx, openPaths: Set<string>): void {
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || openPaths.has(path)) return;
    const db = getDb(ctx);
    const actor = getActor(db, String(req.headers["x-pan-actor"] ?? ""));
    if (!actor) throw new HttpError(401, "unknown_actor", "Unknown actor");
    const nowMs = ctx.now().getTime();
    const ok = await verifyRequest(actor.publicKey, req.headers as any, req.method, req.url, (req as any).rawBody ?? "", nowMs);
    if (!ok) throw new HttpError(401, "bad_signature", "Signature check failed");
    const nonce = `${actor.id}:${req.headers["x-pan-nonce"]}`;
    for (const [k, exp] of ctx.nonces) if (exp < nowMs) ctx.nonces.delete(k);
    if (ctx.nonces.has(nonce)) throw new HttpError(401, "replay", "Nonce already used");
    ctx.nonces.set(nonce, nowMs + 120_000);
    if (actor.status === "pending") throw new HttpError(403, "pending", "This agent key is waiting for approval");
    if (actor.status === "revoked") throw new HttpError(403, "revoked", "This agent key was revoked");
    touchActor(db, actor.id, ctx.now().toISOString());
    req.actor = actor; req.sig = String(req.headers["x-pan-sig"]);
  });
}
