import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { migrate, openDatabase, readConfig } from "@boomerang/db";
import { installAuth } from "./auth";
import { EventBus, installStream } from "./bus";
import type { Ctx } from "./context";
import { installErrorHandler, notFoundBody } from "./errors";
import { dbFile, lifecycleRoutes } from "./routes/lifecycle";
import { agentRoutes } from "./routes/agents";
import { attachmentRoutes } from "./routes/attachments";
import { chainRoutes } from "./routes/chain";
import { modelRoutes } from "./routes/model";
import { projectRoutes } from "./routes/projects";
import { threadRoutes } from "./routes/thread";
import { ticketRoutes } from "./routes/tickets";

export async function buildApp(opts: { dataDir: string; now?: () => Date; webDist?: string; allowFastKdf?: boolean }): Promise<ReturnType<typeof Fastify> & { ctx: Ctx }> {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576, forceCloseConnections: true });
  const now = opts.now ?? (() => new Date());
  const ctx: Ctx = {
    dataDir: opts.dataDir,
    db: null,
    config: readConfig(opts.dataDir),
    now,
    nonces: new Map(),
    startedAt: now().getTime(),
    allowFastKdf: opts.allowFastKdf === true,
    fileKey: null,
    bus: new EventBus(),
    agentSeenAt: new Map(),
  };
  if (ctx.config && !ctx.config.encryption) {
    ctx.db = openDatabase(dbFile(ctx), null);
    migrate(ctx.db);
  }

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e: any) {
      e.statusCode = 400;
      done(e);
    }
  });
  installErrorHandler(app);

  await app.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 5 } });

  const OPEN = new Set(["/api/v1/health", "/api/v1/status", "/api/v1/setup", "/api/v1/unlock"]);
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || OPEN.has(path)) return;
    if (!ctx.db) return reply.status(423).header("retry-after", "30").send({ error: { code: "locked", message: "Boomerang is locked" } });
  });

  installAuth(app, ctx, new Set([...OPEN, "/api/v1/agents/register"]));

  lifecycleRoutes(app, ctx);
  agentRoutes(app, ctx);
  projectRoutes(app, ctx);
  ticketRoutes(app, ctx);
  modelRoutes(app, ctx);
  threadRoutes(app, ctx);
  chainRoutes(app, ctx);
  attachmentRoutes(app, ctx);
  installStream(app, ctx);

  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/") ? reply.status(404).send(notFoundBody) : reply.sendFile("index.html")
    );
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send(notFoundBody));
  }

  app.addHook("onClose", async () => {
    ctx.db?.close();
    ctx.db = null;
  });

  return Object.assign(app, { ctx });
}
