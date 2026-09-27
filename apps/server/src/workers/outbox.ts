import { createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
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

// The outbox worker (base spec section 9; delivery format in docs/webhooks.md). Every 5 s it
// takes the due rows, at most PER_DESTINATION per destination and in turns across
// destinations, and POSTs each to its destination, signed with the destination's secret.
// Any 2xx marks the row delivered; anything else records the error and schedules the next
// attempt on the backoff below. After the last attempt the row is parked for the record, a
// `webhook.failed` event is appended, and the ticket the payload names, if any, is flagged
// needs_human. Delivered rows are purged after seven days.

/** Waits before attempts 2 to 6; every later attempt waits the last value again. */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
export const MAX_ATTEMPTS = 8;
export const PURGE_AFTER_MS = 7 * 24 * 3_600_000;
/** Rows one tick takes for one destination, at most. */
export const PER_DESTINATION = 5;
/** Due rows one tick looks at before the per-destination cap, so many destinations all get a turn. */
const DUE_LIMIT = 1000;
const TICK_MS = 5_000;
const TIMEOUT_MS = 10_000;
/** Hard ceiling on one delivery attempt, DNS, connect and body included. */
const DEADLINE_MS = 20_000;

export interface OutboxOptions {
  now?: () => Date;
  intervalMs?: number;
  /** Socket idle timeout for one request. */
  timeoutMs?: number;
  /** Overall deadline for one attempt: DNS, connect, and the response body. */
  deadlineMs?: number;
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

/** HMAC-SHA256 over the exact body bytes, keyed by the secret's hex string as UTF-8 bytes. */
export const signBody = (secret: string, body: string): string => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

// The address guard works on bytes, not spellings. IPv4 ranges: unspecified, loopback,
// private, link-local, carrier-grade NAT, IETF protocol assignments (192.0.0.0/24),
// benchmarking (198.18.0.0/15), multicast and reserved. IPv6: unspecified, loopback, unique
// local, link-local, multicast. An IPv6 address that carries an IPv4 one (v4-mapped
// ::ffff:0:0/96, v4-compatible ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16) is judged by the
// IPv4 it carries, whichever way it was written.
const v4Block = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) v4Block.addSubnet(net, bits, "ipv4");
const v6Block = new BlockList();
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) v6Block.addSubnet(net, bits, "ipv6");

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function v6Groups(ip: string): number[] | null {
  const s = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (isIP(s) !== 6) return null;
  let parts = s.split("::");
  if (parts.length > 2) return null;
  const expand = (chunk: string): number[] => {
    if (chunk === "") return [];
    return chunk.split(":").flatMap((p) => {
      if (p.includes(".")) { const q = p.split(".").map(Number); return [(q[0] << 8) | q[1], (q[2] << 8) | q[3]]; }
      return [parseInt(p, 16)];
    });
  };
  const head = expand(parts[0]); const tail = parts.length === 2 ? expand(parts[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (parts.length === 1 && fill !== 0)) return null;
  return [...head, ...Array(fill).fill(0), ...tail];
}

const v4FromGroups = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return v4Block.check(ip, "ipv4");
  const g = v6Groups(ip);
  if (!g) return true; // not an address at all: never deliver to it
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(5) && g[5] === 0xffff) return v4Block.check(v4FromGroups(g[6], g[7]), "ipv4");
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Block.check(v4FromGroups(g[6], g[7]), "ipv4");
  if (g[0] === 0x2002) return v4Block.check(v4FromGroups(g[1], g[2]), "ipv4");
  if (zeroTo(6)) {
    if (g[6] === 0 && g[7] <= 1) return true; // :: and ::1
    return v4Block.check(v4FromGroups(g[6], g[7]), "ipv4");
  }
  return v6Block.check(g.map((x) => x.toString(16)).join(":"), "ipv6");
}

export type UrlCheck = { ok: true; address: string; family: 4 | 6 } | { ok: false; reason: string };

/**
 * The SSRF guard, run at send time: only http and https, no credentials in the url, and the
 * name resolved now, so a record that changed since the destination was saved is judged as it
 * stands. The address returned is the one the connection is pinned to.
 */
export async function checkWebhookUrl(url: string, opts: { allowPrivate: boolean }): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "not a valid url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "only http and https urls are delivered to" };
  if (u.username || u.password) return { ok: false, reason: "urls with credentials are refused" };
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

type LookupCb = (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;

/** One POST, pinned to the checked address, no redirects followed. Resolves with the status. */
function post(url: string, body: string, headers: Record<string, string>, pin: { address: string; family: 4 | 6 }, timeoutMs: number, signal: AbortSignal): Promise<number> {
  const u = new URL(url);
  const request = u.protocol === "https:" ? httpsRequest : httpRequest;
  // Node 22's happy eyeballs asks the lookup for every address ({all: true}) and expects an
  // array; the classic form wants (address, family). Serve both, and turn the family race off
  // since there is exactly one address to use.
  const lookup = (_host: string, opts: unknown, cb?: LookupCb) => {
    const callback = (typeof opts === "function" ? opts : cb) as LookupCb;
    const all = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all === true;
    if (all) callback(null, [{ address: pin.address, family: pin.family }]);
    else callback(null, pin.address, pin.family);
  };
  // autoSelectFamily is accepted by Node's request options but missing from these typings.
  const options: RequestOptions & { autoSelectFamily: boolean } = {
    method: "POST",
    headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
    timeout: timeoutMs,
    signal,
    lookup: lookup as never,
    autoSelectFamily: false,
  };
  return new Promise((resolve, reject) => {
    const req = request(u, options, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`timed out after ${timeoutMs} ms`)));
    req.on("error", reject);
    req.end(body);
  });
}

/** At most `cap` rows per destination, taken in turns across destinations in the order the
 *  rows came due, so a destination that is down and retrying cannot hold the others behind it. */
export function inTurns(items: OutboxItem[], cap: number): OutboxItem[] {
  const byDestination = new Map<string, OutboxItem[]>();
  for (const item of items) {
    const rows = byDestination.get(item.destinationId) ?? [];
    if (rows.length < cap) rows.push(item);
    byDestination.set(item.destinationId, rows);
  }
  const out: OutboxItem[] = [];
  for (let i = 0; i < cap; i++) for (const rows of byDestination.values()) if (rows[i]) out.push(rows[i]);
  return out;
}

/** Runs `work` against a deadline that also aborts whatever honours the signal; a lookup that
 *  ignores it is still abandoned when the race settles. */
function withDeadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const reason = new Error(`deadline of ${ms} ms passed`);
  const timer = setTimeout(() => ac.abort(reason), ms);
  const expired = new Promise<never>((_, reject) => ac.signal.addEventListener("abort", () => reject(reason)));
  return Promise.race([work(ac.signal), expired]).finally(() => clearTimeout(timer));
}

export class OutboxWorker {
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly deadlineMs: number;
  private readonly allowPrivate: boolean;
  private readonly log: (m: string) => void;
  private readonly onEvents?: OnEvents;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly ctx: Ctx, opts: OutboxOptions = {}) {
    this.now = opts.now ?? ctx.now;
    this.intervalMs = opts.intervalMs ?? TICK_MS;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.deadlineMs = opts.deadlineMs ?? DEADLINE_MS;
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

  /** One pass over the due rows, a few per destination. A pass still in flight makes the next one a no-op. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const db = this.ctx.db;
      if (!db) return;
      const now = this.now();
      purgeDelivered(db, new Date(now.getTime() - PURGE_AFTER_MS).toISOString());
      for (const item of inTurns(dueOutbox(db, now.toISOString(), DUE_LIMIT), PER_DESTINATION)) {
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
      error = await withDeadline(this.deadlineMs, async (signal) => {
        const check = await checkWebhookUrl(dest.url, { allowPrivate: this.allowPrivate });
        if (!check.ok) return check.reason;
        const status = await post(dest.url, body, {
          "content-type": "application/json",
          "user-agent": "Boomerang",
          "x-boomerang-signature": signBody(secret, body),
          "x-boomerang-event": event,
          "x-boomerang-delivery": item.id,
        }, check, this.timeoutMs, signal);
        return status >= 200 && status < 300 ? null : `status ${status}`;
      });
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
