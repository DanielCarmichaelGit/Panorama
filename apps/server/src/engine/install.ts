import type { FastifyInstance } from "fastify";
import type { Ctx } from "../context";
import { runRules } from "./runRules";

/**
 * Hands every request's committed events to the engine before the response goes out. Route
 * handlers run their transactions synchronously and return, so by onSend everything on
 * `req.emitted` has committed; running here rather than in onResponse means a client that
 * acts on the reply (an agent asking for its next ticket) already sees where the rules left
 * things. What the engine appends joins `req.emitted` after the route's own events, so the
 * stream publishes cause before effect. The engine never fails a request: a fire that throws
 * is its own error run, and anything past that is swallowed here.
 */
export function installEngine(app: FastifyInstance, ctx: Ctx): void {
  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode >= 400 || !req.emitted?.length) return payload;
    try {
      req.emitted.push(...runRules(ctx, req.emitted));
    } catch (e) {
      app.log.error(e);
    }
    return payload;
  });
}
