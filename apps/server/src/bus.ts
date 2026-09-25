import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ChainEvent } from "@boomerang/core";
import { inScope } from "./auth";
import type { Ctx } from "./context";

declare module "fastify" {
  interface FastifyRequest {
    emitted?: ChainEvent[];
  }
}

export interface StreamEvent {
  seq: number;
  type: string;
  payload: unknown;
  at: string;
}

const HEARTBEAT_MS = 15_000;

export class EventBus {
  private subscribers = new Set<(e: StreamEvent) => void>();
  // Keyed by the raw response, valued by the connecting actor's id, so a later revoke can find
  // and end just that actor's stream(s) without touching anyone else's.
  private streams = new Map<FastifyReply["raw"], string>();

  subscribe(fn: (e: StreamEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(e: StreamEvent): void {
    for (const fn of this.subscribers) fn(e);
  }

  /** Tracked so closeAll can end every open stream response, e.g. when the database locks. */
  track(raw: FastifyReply["raw"], actorId: string): () => void {
    this.streams.set(raw, actorId);
    return () => this.streams.delete(raw);
  }

  closeAll(): void {
    for (const raw of this.streams.keys()) raw.end();
    this.streams.clear();
  }

  /**
   * A stream is opened with the actor's status and scopes as they stood at connect time, and
   * never re-checked afterward: an agent revoked mid-stream would otherwise keep receiving
   * in-scope events until it happens to disconnect on its own. So a revoke ends that agent's
   * stream(s) directly, telling it why before doing so.
   */
  closeFor(actorId: string): void {
    for (const [raw, id] of this.streams) {
      if (id !== actorId) continue;
      if (!raw.writableEnded) raw.write("event: revoked\ndata: {}\n\n");
      raw.end();
      this.streams.delete(raw);
    }
  }
}

/**
 * Records a committed event on the request so the onResponse hook can publish it once the
 * response is known to have succeeded. Route handlers run their db.transaction(...)()
 * synchronously before returning, so anything recorded here has already committed.
 */
export function record(req: FastifyRequest, ev: ChainEvent): void {
  (req.emitted ??= []).push(ev);
}

function payloadProjectId(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "projectId" in payload) {
    const p = (payload as { projectId?: unknown }).projectId;
    return typeof p === "string" ? p : undefined;
  }
  return undefined;
}

function visibleTo(actor: FastifyRequest["actor"], ev: StreamEvent): boolean {
  if (actor.kind === "human") return true;
  const projectId = payloadProjectId(ev.payload);
  if (projectId) return inScope(actor, projectId);
  // Evidence types are shared by every project, so an agent in any project may see them change.
  if (ev.type.startsWith("evidence_type.")) return true;
  // agent.revoked is not relayed here: closeFor ends that agent's stream directly with its own
  // "revoked" frame instead, so the connection doesn't linger to also receive the business event.
  if (ev.type === "agent.approved") {
    const id = (ev.payload as { id?: unknown } | null)?.id;
    return id === actor.id;
  }
  return false;
}

export function installStream(app: FastifyInstance, ctx: Ctx): void {
  app.addHook("onResponse", async (req, reply) => {
    if (reply.statusCode >= 400 || !req.emitted?.length) return;
    for (const ev of req.emitted) {
      ctx.bus.publish({ seq: ev.seq, type: ev.type, payload: ev.payload, at: ev.createdAt });
      if (ev.type === "agent.revoked") {
        const id = (ev.payload as { id?: unknown } | null)?.id;
        if (typeof id === "string") { ctx.bus.closeFor(id); ctx.agentSeenAt.delete(id); }
      }
    }
  });

  app.get("/api/v1/stream", async (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    });
    raw.on("error", () => {});
    raw.write(": connected\n\n");

    const untrack = ctx.bus.track(raw, req.actor.id);
    const unsubscribe = ctx.bus.subscribe((ev) => {
      if (raw.writableEnded || !visibleTo(req.actor, ev)) return;
      raw.write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.payload)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (raw.writableEnded) return;
      raw.write(": ping\n\n");
    }, HEARTBEAT_MS);
    heartbeat.unref();

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      untrack();
    });
  });
}
