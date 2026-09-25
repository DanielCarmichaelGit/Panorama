import type { FastifyInstance } from "fastify";
import type { Ctx } from "../context";
import { runRules } from "./runRules";

export interface EngineOptions {
  /** Where an engine failure is reported when the app's own logger is off. Default console.error. */
  log?: (message: string, error: unknown) => void;
}

/**
 * Hands every request's committed events to the engine before the response goes out. Route
 * handlers run their transactions synchronously and return, so by onSend everything on
 * `req.emitted` has committed; running here rather than in onResponse means a client that
 * acts on the reply (an agent asking for its next ticket) already sees where the rules left
 * things. Each fire's events join `req.emitted` as that fire commits, after the route's own,
 * so the stream publishes cause before effect and a failure later in the run cannot drop
 * what already happened. The engine never fails a request: a fire that throws is its own
 * error run, and anything past that is logged here.
 */
export function installEngine(app: FastifyInstance, ctx: Ctx, opts: EngineOptions = {}): void {
  // Fastify with `logger: false` installs a no-op logger with no level; a real one has one.
  const loggerOff = typeof (app.log as { level?: unknown }).level !== "string";
  const fallback = opts.log ?? ((message: string, error: unknown) => console.error(message, error));
  const report = (req: { log: FastifyInstance["log"] }, message: string, error: unknown) => {
    req.log.error({ err: error }, message);
    if (loggerOff) fallback(message, error);
  };
  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode >= 400 || !req.emitted?.length) return payload;
    const emitted = req.emitted;
    try {
      runRules(ctx, emitted, { sink: (events) => emitted.push(...events), log: (message, error) => report(req, message, error) });
    } catch (error) {
      report(req, "engine: run failed", error);
    }
    return payload;
  });
}
