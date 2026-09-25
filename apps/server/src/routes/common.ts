import type { FastifyRequest } from "fastify";
import type { Ticket } from "@boomerang/core";
import { appendEvent, getTicket, type DB } from "@boomerang/db";
import { record } from "../bus";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

/** Appends a signed event inside the caller's transaction and records it for the stream. */
export const makeLog = (ctx: Ctx) => (db: DB, req: FastifyRequest, type: string, payload: unknown) => {
  const ev = appendEvent(db, { actorId: req.actor.id, type, payload, signature: req.sig, now: ctx.now().toISOString() });
  record(req, ev);
  return ev;
};

/** A ticket a route may act on: an archived one is gone as far as the API is concerned. */
export function loadTicket(db: DB, id: string): Ticket {
  const t = getTicket(db, id);
  if (!t || t.archived) throw new HttpError(404, "not_found", "No such ticket");
  return t;
}
