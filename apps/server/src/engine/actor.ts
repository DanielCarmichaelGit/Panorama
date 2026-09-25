import type { Actor } from "@boomerang/core";
import { getActor, insertActor, type DB } from "@boomerang/db";

/**
 * The actor rule actions are attributed to. The actor table admits only humans and agents,
 * so the engine is a reserved agent-shaped row with a fixed id: its public key is not a key
 * at all (`verifyText` fails on it, so no request can sign as the engine), it has no scopes
 * (so `can` refuses it everything a request could ask), and it is never assigned a ticket.
 * The rules see it as kind "system" (services/tickets.ts `Acting.kind`); the chain sees its
 * id on every event a rule caused. Created on the engine's first fire, not at migration, so
 * a database that never runs a rule never carries it.
 */
export const ENGINE_ACTOR_ID = "engine";

export function ensureEngineActor(db: DB, now: string): Actor {
  const existing = getActor(db, ENGINE_ACTOR_ID);
  if (existing) return existing;
  const actor: Actor = { id: ENGINE_ACTOR_ID, kind: "agent", name: "Engine", publicKey: "engine", scopes: null, status: "active", lastSeen: null, currentTicketId: null, createdAt: now };
  insertActor(db, actor);
  return actor;
}
