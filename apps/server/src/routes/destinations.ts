import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDestination, getDestination, getProject, listDestinations, updateDestination, type DB } from "@boomerang/db";
import { getDb, requireCan } from "../auth";
import { changedKeys } from "../changed";
import type { Ctx } from "../context";
import { HttpError } from "../errors";
import { enqueueNotification } from "../workers/outbox";
import { sealSecret } from "../workers/secrets";
import { makeLog } from "./common";

// Webhook destinations: where `emit_webhook` posts to. Human only (`destination.edit`); an
// agent gets 403 before any lookup, whether or not the id exists. The secret is generated here,
// returned exactly once (on create and on rotate), and never listed; at rest it is sealed under
// the server's key when encryption is on (workers/secrets.ts). The url's scheme is checked here;
// where it points is checked at send time by the outbox worker, so a name that later resolves
// somewhere private is refused then.

const url = z.string().max(2000).refine((u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } }, "an http or https url");
const name = z.string().trim().min(1).max(80);
export const CreateDestinationInput = z.object({ projectId: z.string().min(1), name, url }).strict();
export const UpdateDestinationInput = z.object({ name: name.optional(), url: url.optional(), archived: z.boolean().optional() }).strict();

const newSecret = () => randomBytes(32).toString("hex");

export function destinationRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const log = makeLog(ctx);
  const loadDestination = (db: DB, id: string) => {
    const d = getDestination(db, id);
    if (!d) throw new HttpError(404, "not_found", "No such destination");
    return d;
  };

  app.get("/api/v1/destinations", async (req: any) => {
    requireCan(req, "destination.edit");
    const db = getDb(ctx); const projectId = String(req.query.projectId ?? "");
    if (!getProject(db, projectId)) throw new HttpError(404, "not_found", "No such project");
    return listDestinations(db, projectId, { includeArchived: req.query.includeArchived === "1" || req.query.includeArchived === "true" });
  });

  app.post("/api/v1/destinations", async (req) => {
    requireCan(req, "destination.edit");
    const db = getDb(ctx); const input = CreateDestinationInput.parse(req.body);
    if (!getProject(db, input.projectId)) throw new HttpError(404, "not_found", "No such project");
    const secret = newSecret();
    return db.transaction(() => {
      const d = createDestination(db, { ...input, secret: sealSecret(ctx.fileKey, secret) }, iso());
      log(db, req, "destination.created", { id: d.id, projectId: d.projectId, name: d.name, url: d.url });
      return { ...d, secret };
    })();
  });

  app.patch("/api/v1/destinations/:id", async (req: any) => {
    requireCan(req, "destination.edit");
    const db = getDb(ctx); const d = loadDestination(db, req.params.id);
    const patch = UpdateDestinationInput.parse(req.body);
    return db.transaction(() => {
      const out = updateDestination(db, d.id, patch);
      log(db, req, "destination.updated", { id: d.id, projectId: d.projectId, changed: changedKeys(d, patch), patch });
      return out;
    })();
  });

  app.post("/api/v1/destinations/:id/rotate", async (req: any) => {
    requireCan(req, "destination.edit");
    const db = getDb(ctx); const d = loadDestination(db, req.params.id);
    const secret = newSecret();
    return db.transaction(() => {
      const out = updateDestination(db, d.id, { secret: sealSecret(ctx.fileKey, secret) });
      log(db, req, "destination.rotated", { id: d.id, projectId: d.projectId });
      return { ...out, secret };
    })();
  });

  /** Queues a test delivery; the outbox worker sends it like any other, so the owner sees the
   *  real signature and headers arrive. */
  app.post("/api/v1/destinations/:id/test", async (req: any) => {
    requireCan(req, "destination.edit");
    const db = getDb(ctx); const d = loadDestination(db, req.params.id);
    if (d.archived) throw new HttpError(409, "archived", "That destination is archived");
    return db.transaction(() => {
      const ev = log(db, req, "destination.test", { id: d.id, projectId: d.projectId });
      return enqueueNotification(db, d.id, ev.seq, { test: true, destinationId: d.id, name: d.name, projectId: d.projectId }, iso());
    })();
  });
}
