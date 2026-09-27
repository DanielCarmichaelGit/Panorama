import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as d from "./index";

const NOW = "2026-09-25T10:00:00.000Z";
const LATER = "2026-09-25T11:00:00.000Z";
const LATEST = "2026-09-25T12:00:00.000Z";
const FAR = "2026-10-01T00:00:00.000Z";

function world() {
  const db = d.openDatabase(join(mkdtempSync(join(tmpdir(), "pan-")), "p.db"), null);
  d.migrate(db);
  const { project, boards } = d.createProject(db, { name: "Boomerang", key: "PAN" }, NOW);
  for (const id of ["ag1", "ag2"]) {
    d.insertActor(db, { id, kind: "agent", name: id, publicKey: id.repeat(32).slice(0, 64), scopes: null, status: "active", lastSeen: null, currentTicketId: null, createdAt: NOW });
  }
  const growth = d.createBoard(db, { projectId: project.id, name: "Growth", family: "sky" }, NOW);
  const e1 = d.createEpic(db, { projectId: project.id, name: "Onboarding" }, NOW);
  const e2 = d.createEpic(db, { projectId: project.id, name: "Billing" }, NOW);
  const t1 = d.createTicket(db, { projectId: project.id, title: "One", epicId: e1.id }, NOW);
  const t2 = d.createTicket(db, { projectId: project.id, title: "Two", epicId: e2.id, boardId: growth.id }, NOW);
  const t3 = d.createTicket(db, { projectId: project.id, title: "Quiet" }, NOW);
  return { db, project, boards, growth, e1, e2, t1, t2, t3 };
}

describe("timers", () => {
  it("opens one timer per actor per ticket, stops it, and lists what an actor has open", () => {
    const { db, t1, t2 } = world();
    const first = d.startTimer(db, { ticketId: t1.id, actorId: "ag1" }, NOW);
    expect(first).toEqual({ id: first.id, ticketId: t1.id, actorId: "ag1", startedAt: NOW, stoppedAt: null });
    expect(() => d.startTimer(db, { ticketId: t1.id, actorId: "ag1" }, LATER)).toThrow("timer_open");
    const other = d.startTimer(db, { ticketId: t2.id, actorId: "ag1" }, LATER);
    const byOther = d.startTimer(db, { ticketId: t1.id, actorId: "ag2" }, LATER);
    expect(d.listOpenTimers(db, "ag1").map((t) => t.id)).toEqual([first.id, other.id]);

    const stopped = d.stopTimer(db, { ticketId: t1.id, actorId: "ag1" }, LATER);
    expect(stopped).toEqual({ ...first, stoppedAt: LATER });
    expect(() => d.stopTimer(db, { ticketId: t1.id, actorId: "ag1" }, LATER)).toThrow("no_open_timer");
    expect(d.listOpenTimers(db, "ag1").map((t) => t.id)).toEqual([other.id]);
    // Once stopped, the same pair may open a new timer: the uniqueness is on open timers only.
    const again = d.startTimer(db, { ticketId: t1.id, actorId: "ag1" }, LATEST);
    expect(d.listTimers(db, t1.id).map((t) => t.id)).toEqual([first.id, byOther.id, again.id]);
  });

  it("holds the uniqueness in the schema, not only in the repository", () => {
    const { db, t1 } = world();
    d.startTimer(db, { ticketId: t1.id, actorId: "ag1" }, NOW);
    expect(() => db.prepare("insert into timers(id, ticket_id, actor_id, started_at) values('dup', ?, 'ag1', ?)").run(t1.id, LATER)).toThrow(/UNIQUE/);
    expect(() => db.prepare("insert into timers(id, ticket_id, actor_id, started_at) values('ghost', ?, 'nobody', ?)").run(t1.id, LATER)).toThrow(/FOREIGN KEY/);
  });

  it("totals a ticket's time, counting open timers up to now", () => {
    const { db, project, t1, t2 } = world();
    d.startTimer(db, { ticketId: t1.id, actorId: "ag1" }, NOW);
    d.stopTimer(db, { ticketId: t1.id, actorId: "ag1" }, LATER); // one hour, closed
    d.startTimer(db, { ticketId: t1.id, actorId: "ag2" }, LATER); // still open at LATEST: one hour so far
    d.startTimer(db, { ticketId: t2.id, actorId: "ag1" }, NOW); // another ticket
    expect(d.timerTotalsByTicket(db, t1.id, LATEST)).toEqual({ ms: 7_200_000, open: 1 });
    expect(d.timerTotalsByTicket(db, t2.id, LATEST)).toEqual({ ms: 7_200_000, open: 1 });
    expect(d.timerTotalsByTicket(db, "nothing", LATEST)).toEqual({ ms: 0, open: 0 });
    expect(d.timerTotalsByProject(db, project.id, { from: NOW, to: FAR }, LATEST)).toEqual({ ms: 14_400_000, open: 2 });
    expect(d.timerTotalsByProject(db, project.id, { from: LATER, to: FAR }, LATEST)).toEqual({ ms: 3_600_000, open: 1 });
  });
});

describe("cost entries", () => {
  const fixture = () => {
    const w = world();
    const { db, t1, t2 } = w;
    const a = d.addCostEntry(db, { ticketId: t1.id, actorId: "ag1", model: "anthropic/claude-x", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 100, usd: 0.5, priceDate: "2026-09-20" }, NOW);
    const b = d.addCostEntry(db, { ticketId: t1.id, actorId: "ag2", model: "mystery-9000", inputTokens: 10, outputTokens: 10, usd: null, priceDate: "2026-09-20", note: "no price" }, LATER);
    const c = d.addCostEntry(db, { ticketId: t2.id, actorId: "ag1", model: "anthropic/claude-x", inputTokens: 2000, outputTokens: 400, usd: 1, priceDate: "2026-09-18" }, LATEST);
    return { ...w, a, b, c };
  };

  it("stores an entry with cache tokens defaulting to zero and lists a ticket's entries oldest first", () => {
    const { db, t1, a, b } = fixture();
    expect(a).toEqual({ id: a.id, ticketId: t1.id, actorId: "ag1", model: "anthropic/claude-x", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 100, usd: 0.5, priceDate: "2026-09-20", note: null, createdAt: NOW });
    expect(b).toMatchObject({ cacheReadTokens: 0, cacheWriteTokens: 0, usd: null, note: "no price" });
    expect(d.listCostEntries(db, t1.id)).toEqual([a, b]);
    expect(() => d.addCostEntry(db, { ticketId: "ghost", actorId: "ag1", model: "m", inputTokens: 1, outputTokens: 1, usd: null, priceDate: "2026-09-20" }, NOW)).toThrow(/FOREIGN KEY/);
  });

  it("rolls up a ticket: token sums by kind, usd null once a model is unpriced, the known subtotal, and the oldest price date", () => {
    const { db, t1, t2, t3 } = fixture();
    expect(d.costByTicket(db, t1.id)).toEqual({
      tokens: { input: 1010, output: 210, cacheRead: 300, cacheWrite: 100, total: 1620 },
      usd: null, knownUsd: 0.5, entries: 2, unpriced: 1, priceDate: "2026-09-20",
    });
    expect(d.costByTicket(db, t2.id)).toEqual({
      tokens: { input: 2000, output: 400, cacheRead: 0, cacheWrite: 0, total: 2400 },
      usd: 1, knownUsd: 1, entries: 1, unpriced: 0, priceDate: "2026-09-18",
    });
    expect(d.costByTicket(db, t3.id)).toEqual({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, usd: 0, knownUsd: 0, entries: 0, unpriced: 0, priceDate: null });
  });

  it("rolls up by epic, board, and project, and narrows to a half-open period on created_at", () => {
    const { db, project, boards, growth, e1, e2 } = fixture();
    expect(d.costByEpic(db, e1.id)).toMatchObject({ entries: 2, usd: null, knownUsd: 0.5, unpriced: 1 });
    expect(d.costByEpic(db, e2.id)).toMatchObject({ entries: 1, usd: 1, unpriced: 0 });
    expect(d.costByBoard(db, boards[0].id)).toMatchObject({ entries: 2, knownUsd: 0.5 });
    expect(d.costByBoard(db, growth.id)).toMatchObject({ entries: 1, usd: 1 });
    expect(d.costByProject(db, project.id)).toEqual({
      tokens: { input: 3010, output: 610, cacheRead: 300, cacheWrite: 100, total: 4020 },
      usd: null, knownUsd: 1.5, entries: 3, unpriced: 1, priceDate: "2026-09-18",
    });
    expect(d.costByProject(db, project.id, { from: LATER, to: LATEST })).toMatchObject({ tokens: { input: 10, output: 10, total: 20 }, usd: null, knownUsd: 0, entries: 1, unpriced: 1 });
    expect(d.costByProject(db, project.id, { from: LATEST, to: FAR })).toMatchObject({ usd: 1, entries: 1, unpriced: 0, priceDate: "2026-09-18" });
    expect(d.costByEpic(db, e1.id, { from: FAR, to: FAR })).toMatchObject({ entries: 0, usd: 0 });
    expect(d.costByProject(db, "elsewhere")).toMatchObject({ entries: 0 });
  });

  it("rolls up by agent within a project and period", () => {
    const { db, project } = fixture();
    const all = d.costByAgent(db, project.id);
    expect(all.map((r) => r.actorId)).toEqual(["ag1", "ag2"]);
    expect(all[0]).toEqual({ actorId: "ag1", tokens: { input: 3000, output: 600, cacheRead: 300, cacheWrite: 100, total: 4000 }, usd: 1.5, knownUsd: 1.5, entries: 2, unpriced: 0, priceDate: "2026-09-18" });
    expect(all[1]).toMatchObject({ actorId: "ag2", usd: null, knownUsd: 0, entries: 1, unpriced: 1 });
    expect(d.costByAgent(db, project.id, { from: NOW, to: LATER }).map((r) => [r.actorId, r.entries])).toEqual([["ag1", 1]]);
    expect(d.costByAgent(db, "elsewhere")).toEqual([]);
  });
});
