import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { migrate, openDatabase, readConfig } from "@panorama/db";
import type { Ctx } from "./context";
import { installErrorHandler, notFoundBody } from "./errors";
import { dbFile, lifecycleRoutes } from "./routes/lifecycle";

export async function buildApp(opts: { dataDir: string; now?: () => Date; webDist?: string }) {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  const ctx: Ctx = { dataDir: opts.dataDir, db: null, config: readConfig(opts.dataDir), now: opts.now ?? (() => new Date()), nonces: new Map() };
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

  const OPEN = new Set(["/api/v1/health", "/api/v1/status", "/api/v1/setup", "/api/v1/unlock"]);
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || OPEN.has(path)) return;
    if (!ctx.db) return reply.status(423).header("retry-after", "30").send({ error: { code: "locked", message: "Panorama is locked" } });
  });

  lifecycleRoutes(app, ctx);

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
