import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import * as d from "@boomerang/db";
import { setupApp } from "../test/helpers";
import { BACKOFF_MS, checkWebhookUrl, enqueueNotification, MAX_ATTEMPTS, OutboxWorker } from "./outbox";

interface Received { headers: IncomingMessage["headers"]; body: string }

/** A destination on a port of its own: records every request, answers with `status`. */
function fakeDestination(): Promise<{ url: string; received: Received[]; status: { code: number }; close: () => Promise<void> }> {
  const received: Received[] = []; const status = { code: 200 };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { received.push({ headers: req.headers, body }); res.statusCode = status.code; res.end("ok"); });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${port}/hook`, received, status, close: () => new Promise((r) => server.close(() => r())) });
  }));
}

const sig = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
const T = (s: string) => new Date(s);
const servers: { close: () => Promise<void> }[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

async function world(opts: { allowPrivate?: boolean } = {}) {
  const s = await setupApp(false);
  const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
  const dest = await fakeDestination(); servers.push(dest);
  const clock = { now: T("2026-09-25T10:00:00.000Z") };
  const iso = () => clock.now.toISOString();
  const db = () => s.app.ctx.db!;
  const secret = "ab".repeat(32);
  const destination = d.createDestination(db(), { projectId: project.id, name: "Hook", url: dest.url, secret }, iso());
  const ticket = d.createTicket(db(), { projectId: project.id, title: "T" }, iso());
  const event = d.appendEvent(db(), { actorId: "human", type: "ticket.created", payload: { id: ticket.id, projectId: project.id }, signature: "s", now: iso() });
  const notes: string[] = [];
  const worker = new OutboxWorker(s.app.ctx, { now: () => clock.now, allowPrivate: opts.allowPrivate ?? true, log: (m) => notes.push(m) });
  const enqueue = (payload: unknown = { ticketId: ticket.id, title: "T" }) => enqueueNotification(db(), destination.id, event.seq, payload, iso());
  return { s, project, dest, clock, db, secret, destination, ticket, event, worker, enqueue, notes };
}

describe("outbox worker", () => {
  it("delivers a due row with a valid HMAC and the delivery headers, then marks it delivered", async () => {
    const w = await world();
    const item = w.enqueue();
    await w.worker.tick();
    expect(w.dest.received).toHaveLength(1);
    const r = w.dest.received[0];
    expect(r.headers["content-type"]).toBe("application/json");
    expect(r.headers["x-boomerang-signature"]).toBe(sig(w.secret, r.body));
    expect(r.headers["x-boomerang-event"]).toBe("ticket.created");
    expect(r.headers["x-boomerang-delivery"]).toBe(item.id);
    expect(JSON.parse(r.body)).toEqual({ id: item.id, event: "ticket.created", eventSeq: w.event.seq, at: "2026-09-25T10:00:00.000Z", payload: { ticketId: w.ticket.id, title: "T" } });
    expect(d.getOutboxItem(w.db(), item.id)).toMatchObject({ attempts: 1, deliveredAt: "2026-09-25T10:00:00.000Z", lastError: null });
    await w.worker.tick();
    expect(w.dest.received).toHaveLength(1);
  });

  it("retries a failing destination with exponential backoff and gives up after eight attempts with webhook.failed and needs_human", async () => {
    const w = await world();
    w.dest.status.code = 500;
    const item = w.enqueue();
    expect(BACKOFF_MS).toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
    expect(MAX_ATTEMPTS).toBe(8);
    const expectedDelays = [30_000, 120_000, 600_000, 3_600_000, 21_600_000, 21_600_000, 21_600_000];
    for (let attempt = 1; attempt <= 7; attempt++) {
      await w.worker.tick();
      expect(w.dest.received).toHaveLength(attempt);
      const row = d.getOutboxItem(w.db(), item.id)!;
      expect(row.attempts).toBe(attempt);
      expect(row.lastError).toBe("status 500");
      expect(row.deliveredAt).toBeNull();
      expect(new Date(row.nextAttemptAt).getTime() - w.clock.now.getTime()).toBe(expectedDelays[attempt - 1]);
      // Not due yet: nothing goes out until the backoff has elapsed.
      await w.worker.tick();
      expect(w.dest.received).toHaveLength(attempt);
      w.clock.now = new Date(w.clock.now.getTime() + expectedDelays[attempt - 1]);
    }
    await w.worker.tick();
    expect(w.dest.received).toHaveLength(8);
    const row = d.getOutboxItem(w.db(), item.id)!;
    expect(row.attempts).toBe(8);
    expect(row.deliveredAt).toBeNull();
    const failed = d.listEvents(w.db()).filter((e) => e.type === "webhook.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].actorId).toBe("system");
    expect(failed[0].payload).toEqual({ outboxId: item.id, destinationId: w.destination.id, projectId: w.project.id, eventSeq: w.event.seq, ticketId: w.ticket.id, attempts: 8, error: "status 500" });
    expect(d.getTicket(w.db(), w.ticket.id)!.flags).toContain("needs_human");
    expect(d.listEvents(w.db()).filter((e) => e.type === "ticket.flag_set").map((e) => e.payload)).toEqual([{ id: w.ticket.id, projectId: w.project.id, flag: "needs_human", cause: "webhook" }]);
    // Given up for good: a later tick, however far ahead, does not try again.
    w.clock.now = new Date(w.clock.now.getTime() + 7 * 24 * 3_600_000);
    await w.worker.tick();
    expect(w.dest.received).toHaveLength(8);
  });

  it("purges delivered rows after seven days and keeps undelivered ones", async () => {
    const w = await world();
    const delivered = w.enqueue();
    await w.worker.tick();
    expect(d.getOutboxItem(w.db(), delivered.id)!.deliveredAt).not.toBeNull();
    w.clock.now = T("2026-10-01T10:00:00.000Z");
    await w.worker.tick();
    expect(d.getOutboxItem(w.db(), delivered.id)).toBeDefined();
    w.dest.status.code = 503;
    const stuck = w.enqueue();
    w.clock.now = T("2026-10-03T10:00:00.000Z");
    await w.worker.tick();
    expect(d.getOutboxItem(w.db(), delivered.id)).toBeUndefined();
    expect(d.getOutboxItem(w.db(), stuck.id)).toBeDefined();
  });

  it("skips a row whose destination was archived without calling it, and never picks it up again", async () => {
    const w = await world();
    const item = w.enqueue();
    d.updateDestination(w.db(), w.destination.id, { archived: true });
    await w.worker.tick();
    expect(w.dest.received).toHaveLength(0);
    const row = d.getOutboxItem(w.db(), item.id)!;
    expect(row.deliveredAt).toBeNull();
    expect(row.lastError).toBe("destination archived");
    expect(d.dueOutbox(w.db(), "9999-01-01T00:00:00.000Z")).toHaveLength(0);
    expect(d.listEvents(w.db()).filter((e) => e.type === "webhook.failed")).toHaveLength(0);
    expect(() => w.enqueue()).toThrow("destination_archived");
    expect(() => enqueueNotification(w.db(), "nope", w.event.seq, {}, w.clock.now.toISOString())).toThrow("no_destination");
  });

  it("refuses loopback and private addresses unless private webhooks are allowed", async () => {
    const w = await world({ allowPrivate: false });
    const item = w.enqueue();
    await w.worker.tick();
    expect(w.dest.received).toHaveLength(0);
    const row = d.getOutboxItem(w.db(), item.id)!;
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/private/);
    expect(await checkWebhookUrl("http://127.0.0.1:8080/x", { allowPrivate: false })).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("http://10.1.2.3/x", { allowPrivate: false })).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("http://192.168.1.1/x", { allowPrivate: false })).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("http://169.254.169.254/latest", { allowPrivate: false })).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("http://[::1]/x", { allowPrivate: false })).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("http://localhost/x", { allowPrivate: false })).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("ftp://example.com/x", { allowPrivate: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/http/) });
    expect(await checkWebhookUrl("http://10.1.2.3/x", { allowPrivate: true })).toMatchObject({ ok: true, address: "10.1.2.3" });
    const before = process.env.BOOMERANG_ALLOW_PRIVATE_WEBHOOKS;
    process.env.BOOMERANG_ALLOW_PRIVATE_WEBHOOKS = "1";
    try {
      const open = new OutboxWorker(w.s.app.ctx, { now: () => w.clock.now });
      w.clock.now = T("2026-09-25T10:01:00.000Z");
      await open.tick();
      expect(w.dest.received).toHaveLength(1);
    } finally {
      if (before === undefined) delete process.env.BOOMERANG_ALLOW_PRIVATE_WEBHOOKS; else process.env.BOOMERANG_ALLOW_PRIVATE_WEBHOOKS = before;
    }
  });

  it("does nothing while locked", async () => {
    const s = await setupApp(true);
    const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
    const dest = await fakeDestination(); servers.push(dest);
    const db = s.app.ctx.db!;
    const now = "2026-09-25T10:00:00.000Z";
    const destination = d.createDestination(db, { projectId: project.id, name: "Hook", url: dest.url, secret: "cd".repeat(32) }, now);
    const ev = d.appendEvent(db, { actorId: "human", type: "destination.test", payload: { id: destination.id, projectId: project.id }, signature: "s", now });
    enqueueNotification(db, destination.id, ev.seq, { test: true }, now);
    await s.human("POST", "/api/v1/lock");
    const worker = new OutboxWorker(s.app.ctx, { now: () => T(now), allowPrivate: true });
    await worker.tick();
    expect(dest.received).toHaveLength(0);
  });
});
