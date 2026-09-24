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

export function inScope(actor: Actor, projectId: string): boolean {
  if (actor.kind === "human") return true;
  const scopes = actor.scopes;
  return !!scopes && (scopes.projects === "*" || scopes.projects.includes(projectId));
}

const NONCE_TTL_MS = 120_000;
const SWEEP_EVERY_MS = 30_000;
const FUTURE_TOLERANCE_MS = 5_000;
const PRESENCE_THROTTLE_MS = 30_000;

/**
 * Presence is not a chain event: it carries no signature and is never appended to the
 * event log, so it is published straight to the bus instead of going through `record`.
 * Throttled to once per agent per 30s so a busy agent doesn't put a frame on the human's
 * stream for every request; `visibleTo` in bus.ts already keeps it off other agents'
 * streams since its payload carries no `projectId` and its type is not `agent.approved`.
 */
function publishPresence(ctx: Ctx, actor: Actor, nowMs: number, lastSeen: string): void {
  if (actor.kind !== "agent") return;
  const last = ctx.agentSeenAt.get(actor.id) ?? 0;
  if (nowMs - last < PRESENCE_THROTTLE_MS) return;
  ctx.agentSeenAt.set(actor.id, nowMs);
  ctx.bus.publish({ seq: nowMs, type: "agent.seen", payload: { id: actor.id, lastSeen, currentTicketId: actor.currentTicketId }, at: lastSeen });
}

export function installAuth(app: FastifyInstance, ctx: Ctx, openPaths: Set<string>): void {
  let lastSweep = 0;
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || openPaths.has(path)) return;
    const db = getDb(ctx);
    const actor = getActor(db, String(req.headers["x-pan-actor"] ?? ""));
    if (!actor) throw new HttpError(401, "unknown_actor", "Unknown actor");
    const nowMs = ctx.now().getTime();
    // signRequest hashes a UTF-8 string, so a binary multipart body cannot be signed byte for
    // byte. Those uploads sign the empty string instead: the actor, path, timestamp and nonce
    // are still bound, just not the file bytes themselves.
    const contentType = String(req.headers["content-type"] ?? "");
    const signedBody = contentType.startsWith("multipart/") ? "" : (req as any).rawBody ?? "";
    const ok = await verifyRequest(actor.publicKey, req.headers as any, req.method, req.url, signedBody, nowMs);
    if (!ok) throw new HttpError(401, "bad_signature", "Signature check failed");

    // The nonce cache is memory only, so a request captured before this process started
    // could otherwise be replayed once the cache is empty again.
    const ts = Number(req.headers["x-pan-ts"]);
    if (ts > nowMs + FUTURE_TOLERANCE_MS) throw new HttpError(401, "bad_signature", "Request is dated in the future");
    if (ts < ctx.startedAt) throw new HttpError(401, "stale", "Request is older than this server run");

    if (actor.status === "pending") throw new HttpError(403, "pending", "This agent key is waiting for approval");
    if (actor.status === "revoked") throw new HttpError(403, "revoked", "This agent key was revoked");

    if (nowMs - lastSweep >= SWEEP_EVERY_MS) {
      lastSweep = nowMs;
      for (const [k, exp] of ctx.nonces) if (exp < nowMs) ctx.nonces.delete(k);
    }
    const nonce = `${actor.id}:${req.headers["x-pan-nonce"]}`;
    if (ctx.nonces.has(nonce)) throw new HttpError(401, "replay", "Nonce already used");
    ctx.nonces.set(nonce, nowMs + NONCE_TTL_MS);

    const nowIso = ctx.now().toISOString();
    touchActor(db, actor.id, nowIso);
    publishPresence(ctx, actor, nowMs, nowIso);
    req.actor = actor; req.sig = String(req.headers["x-pan-sig"]);
  });
}
