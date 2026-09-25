import { createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { ChainEvent } from "@boomerang/core";
import {
  dueOutbox,
  enqueueOutbox,
  getDestination,
  getDestinationSecret,
  getEvent,
  getTicket,
  markOutboxAttempt,
  OUTBOX_PARKED_AT,
  parkOutbox,
  purgeDelivered,
  setFlag,
  type DB,
  type OutboxItem,
} from "@boomerang/db";
import type { Ctx } from "../context";
import { openSecret } from "./secrets";
import { appendSystemEvent, publishEvents, type OnEvents } from "./system";

// The outbox worker (base spec section 9). Every 5 s it takes the due rows and POSTs each to its
// destination, signed with the destination's secret. Any 2xx marks the row delivered; anything
// else records the error and schedules the next attempt on the backoff below. After the last
// attempt the row is parked for the record, a `webhook.failed` event is appended, and the ticket
// the payload names, if any, is flagged needs_human. Delivered rows are purged after seven days.

/** Waits before attempts 2 to 6; every later attempt waits the last value again. */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
export const MAX_ATTEMPTS = 8;
export const PURGE_AFTER_MS = 7 * 24 * 3_600_000;
const TICK_MS = 5_000;
const TIMEOUT_MS = 10_000;

export interface OutboxOptions {
  now?: () => Date;
  intervalMs?: number;
  timeoutMs?: number;
  /** Allow loopback and private destinations. Defaults to BOOMERANG_ALLOW_PRIVATE_WEBHOOKS=1. */
  allowPrivate?: boolean;
  log?: (message: string) => void;
  /** The engine, once wired: gets `webhook.failed` and the flag event it may cause. */
  onEvents?: OnEvents;
}

/**
 * The engine's entry point for `emit_webhook`: one outbox row for one chain event, written in
 * the caller's transaction. Throws `Error("no_destination")` or `Error("destination_archived")`,
 * which the engine reports in the rule's run log.
 */
export function enqueueNotification(db: DB, destinationId: string, eventSeq: number, payload: unknown, now: string = new Date().toISOString()): OutboxItem {
  const dest = getDestination(db, destinationId);
  if (!dest) throw new Error("no_destination");
  if (dest.archived) throw new Error("destination_archived");
  return enqueueOutbox(db, { destinationId, eventSeq, payload }, now);
}

export const signBody = (secret: string, body: string): string => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const v4 = (ip: string): number[] | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  return m ? m.slice(1).map(Number) : null;
};

/** Loopback, link-local, private, carrier-grade NAT, multicast, reserved, and unspecified. */
export function isPrivateAddress(ip: string): boolean {
  const q = v4(ip);
  if (q) {
    const [a, b] = q;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPrivateAddress(mapped[1]);
  const head = s.split(":")[0];
  if (head.length === 4 && /^f[cd]/.test(head)) return true; // fc00::/7
  if (head.length === 4 && /^fe[89ab]/.test(head)) return true; // fe80::/10
  if (head === "64" && s.startsWith("64:ff9b:")) return true; // NAT64
  return false;
}

export type UrlCheck = { ok: true; address: string; family: 4 | 6 } | { ok: false; reason: string };

/**
 * The SSRF guard, run at send time: only http and https, and the name resolved now, so a
 * record that changed since the destination was saved is judged as it stands. The address
 * returned is the one the connection is pinned to.
 */
export async function checkWebhookUrl(url: string, opts: { allowPrivate: boolean }): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "not a valid url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "only http and https urls are delivered to" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let address: string; let family: 4 | 6;
  const literal = isIP(host);
  if (literal) {
    address = host; family = literal as 4 | 6;
  } else {
    try {
      const r = await dnsLookup(host);
      address = r.address; family = r.family as 4 | 6;
    } catch (e) {
      return { ok: false, reason: `could not resolve ${host}: ${(e as Error).message}` };
    }
  }
  if (!opts.allowPrivate && isPrivateAddress(address)) return { ok: false, reason: `refused: ${host} resolves to the private address ${address} (set BOOMERANG_ALLOW_PRIVATE_WEBHOOKS=1 to allow)` };
  return { ok: true, address, family };
}

/** One POST, pinned to the checked address, no redirects followed. Resolves with the status. */
function post(url: string, body: string, headers: Record<string, string>, pin: { address: string; family: 4 | 6 }, timeoutMs: number): Promise<number> {
  const u = new URL(url);
  const request = u.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(u, {
      method: "POST",
      headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
      timeout: timeoutMs,
      lookup: ((_host: string, _opts: unknown, cb: (err: Error | null, address: string, family: number) => void) => cb(null, pin.address, pin.family)) as never,
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`timed out after ${timeoutMs} ms`)));
    req.on("error", reject);
    req.end(body);
  });
}

export class OutboxWorker {
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly allowPrivate: boolean;
  private readonly log: (m: string) => void;
  private readonly onEvents?: OnEvents;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly ctx: Ctx, opts: OutboxOptions = {}) {
    this.now = opts.now ?? ctx.now;
    this.intervalMs = opts.intervalMs ?? TICK_MS;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.allowPrivate = opts.allowPrivate ?? process.env.BOOMERANG_ALLOW_PRIVATE_WEBHOOKS === "1";
    this.log = opts.log ?? ((m) => console.warn(m));
    this.onEvents = opts.onEvents;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over the due rows. A pass still in flight makes the next one a no-op. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const db = this.ctx.db;
      if (!db) return;
      const now = this.now();
      purgeDelivered(db, new Date(now.getTime() - PURGE_AFTER_MS).toISOString());
      for (const item of dueOutbox(db, now.toISOString())) {
        if (this.ctx.db !== db) return; // locked meanwhile
        await this.deliver(db, item, now);
      }
    } catch (e) {
      this.log(`outbox: tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async deliver(db: DB, item: OutboxItem, now: Date): Promise<void> {
    const dest = getDestination(db, item.destinationId);
    if (!dest) { parkOutbox(db, item.id, "destination missing"); return; }
    if (dest.archived) { parkOutbox(db, item.id, "destination archived"); return; }
    const iso = now.toISOString();
    const event = getEvent(db, item.eventSeq)?.type ?? "unknown";
    const body = JSON.stringify({ id: item.id, event, eventSeq: item.eventSeq, at: iso, payload: item.payload });

    let error: string | null = null;
    try {
      const secret = openSecret(this.ctx.fileKey, getDestinationSecret(db, dest.id) ?? "");
      const check = await checkWebhookUrl(dest.url, { allowPrivate: this.allowPrivate });
      if (!check.ok) error = check.reason;
      else {
        const status = await post(dest.url, body, {
          "content-type": "application/json",
          "user-agent": "Boomerang",
          "x-boomerang-signature": signBody(secret, body),
          "x-boomerang-event": event,
          "x-boomerang-delivery": item.id,
        }, check, this.timeoutMs);
        if (status < 200 || status >= 300) error = `status ${status}`;
      }
    } catch (e) {
      error = (e as Error).message;
    }
    if (this.ctx.db !== db) return; // locked during the request: nothing to record against
    if (error === null) { markOutboxAttempt(db, item.id, { ok: true, now: iso }); return; }

    const attempts = item.attempts + 1;
    if (attempts < MAX_ATTEMPTS) {
      const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
      markOutboxAttempt(db, item.id, { ok: false, error, now: iso, nextAttemptAt: new Date(now.getTime() + wait).toISOString() });
      return;
    }
    this.giveUp(db, item, dest.projectId, attempts, error, iso);
  }

  /** The last attempt failed: park the row, say so on the chain, and flag the ticket if there is one. */
  private giveUp(db: DB, item: OutboxItem, projectId: string, attempts: number, error: string, iso: string): void {
    const events: ChainEvent[] = [];
    db.transaction(() => {
      markOutboxAttempt(db, item.id, { ok: false, error, now: iso, nextAttemptAt: OUTBOX_PARKED_AT });
      const p = item.payload as { ticketId?: unknown } | null;
      const ticketId = p && typeof p === "object" && typeof p.ticketId === "string" ? p.ticketId : null;
      events.push(appendSystemEvent(db, "webhook.failed", { outboxId: item.id, destinationId: item.destinationId, projectId, eventSeq: item.eventSeq, ticketId, attempts, error }, iso));
      const ticket = ticketId ? getTicket(db, ticketId) : undefined;
      if (ticket && !ticket.archived && !ticket.flags.includes("needs_human")) {
        setFlag(db, ticket.id, "needs_human", true, iso);
        events.push(appendSystemEvent(db, "ticket.flag_set", { id: ticket.id, projectId: ticket.projectId, flag: "needs_human", cause: "webhook" }, iso));
      }
    })();
    this.log(`outbox: delivery ${item.id} to destination ${item.destinationId} gave up after ${attempts} attempts: ${error}`);
    publishEvents(this.ctx, db, events, this.onEvents, this.log);
  }
}
