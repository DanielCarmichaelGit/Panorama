import type { FastifyInstance } from "fastify";
import type { Ctx } from "../context";
import { OutboxWorker, type OutboxOptions } from "./outbox";
import { Scheduler, type SchedulerOptions } from "./scheduler";
import type { OnEvents } from "./system";

export interface WorkersOptions {
  scheduler?: SchedulerOptions;
  outbox?: OutboxOptions;
  /** The engine's entry point, handed every event the workers append; wired by the process
   *  entry point once the engine exists, so the workers never import it. */
  onEvents?: OnEvents;
}

/**
 * Starts both workers on their intervals and ties them to the app: an unlock (or setup) is
 * followed by an immediate tick, so the catch-up does not wait for the next interval, and a
 * lock is noticed by the next tick on its own, since each tick reads the open database or
 * nothing. Closing the app stops them.
 */
export function installWorkers(app: FastifyInstance, ctx: Ctx, opts: WorkersOptions = {}): { scheduler: Scheduler; outbox: OutboxWorker } {
  const scheduler = new Scheduler(ctx, { onEvents: opts.onEvents, ...opts.scheduler });
  const outbox = new OutboxWorker(ctx, { onEvents: opts.onEvents, ...opts.outbox });
  app.addHook("onResponse", async (req, reply) => {
    if (reply.statusCode !== 200) return;
    const path = req.url.split("?")[0];
    if (path === "/api/v1/unlock" || path === "/api/v1/setup") {
      scheduler.tick();
      void outbox.tick();
    }
  });
  app.addHook("onClose", async () => {
    scheduler.stop();
    outbox.stop();
  });
  scheduler.start();
  outbox.start();
  return { scheduler, outbox };
}

export { enqueueNotification, OutboxWorker } from "./outbox";
export { nextRunAfter, reconcileTriggers, Scheduler } from "./scheduler";
export { openSecret, sealSecret } from "./secrets";
