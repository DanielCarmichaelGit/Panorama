import { describe, expect, it } from "vitest";
import { AGENT_ACTIONS, ARGON_FAST, BUNDLED_PRICES, deriveKeys, estimateCost, randomHex, signRequest, type AgentAction } from "@boomerang/core";
import { listEvents } from "@boomerang/db";
import { buildApp } from "./app";
import { humanKeys, tempDir } from "./test/helpers";

// A world with its own clock, so a test can measure a timer and place cost entries on either
// side of a period boundary. setupApp in test/helpers.ts takes no `now`; see presence.test.ts
// for the same reasoning about not adding one there. Requests are signed at the clock's time,
// since the server refuses a signature more than a minute away from its own now.
async function world(startAt = "2026-09-23T10:00:00.000Z") {
  let at = Date.parse(startAt);
  const clock = { now: () => new Date(at), advance: (ms: number) => { at += ms; }, set: (iso: string) => { at = Date.parse(iso); } };
  const dir = tempDir();
  const app = await buildApp({ dataDir: dir, allowFastKdf: true, now: clock.now });
  const client = (seed: Uint8Array, actorId: string) => async (method: string, url: string, body?: unknown) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = { ...(await signRequest(seed, actorId, method, url, payload, at)) };
    if (payload) headers["content-type"] = "application/json";
    const res = await app.inject({ method, url, payload: payload || undefined, headers });
    return { status: res.statusCode, json: res.body ? res.json() : null };
  };
  const keys = await humanKeys();
  const human = client(keys.seed, "human");
  const setup = await human("POST", "/api/v1/setup", { publicKey: keys.publicKeyHex, kdfSalt: "00".repeat(16), argon: ARGON_FAST, encryption: false, dbKey: null });
  if (setup.status !== 200) throw new Error(`setup failed: ${JSON.stringify(setup.json)}`);
  const { project, lanes } = (await human("POST", "/api/v1/projects", { name: "Boomerang", key: "PAN" })).json;
  const agentWith = async (actions: AgentAction[]) => {
    const ak = await deriveKeys("agent-secret-" + randomHex(4), "11".repeat(16), ARGON_FAST);
    const id = (await app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker-" + randomHex(4), publicKey: ak.publicKeyHex } })).json().id;
    await human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: [project.id], actions } });
    return { agent: client(ak.seed, id), agentId: id };
  };
  const ticket = async (title = "Ship the thing") => (await human("POST", "/api/v1/tickets", { projectId: project.id, title })).json;
  const lane = (name: string) => lanes.find((l: any) => l.name === name);
  return { app, human, project, lanes, lane, clock, agentWith, ticket };
}

const PRICED = "anthropic/claude-fable-5-1";
const UNPRICED = "acme/mystery-model-9";
const EVERYTHING = [...AGENT_ACTIONS];

describe("timers", () => {
  it("lets an agent with timer.use own a timer: start, refuse a second start, stop with the duration, refuse a stop with none open", async () => {
    const w = await world();
    const t = await w.ticket();
    const { agent, agentId } = await w.agentWith(EVERYTHING);
    const started = await agent("POST", `/api/v1/tickets/${t.id}/timer/start`);
    expect(started.status).toBe(200);
    expect(started.json).toMatchObject({ ticketId: t.id, actorId: agentId, startedAt: "2026-09-23T10:00:00.000Z", stoppedAt: null });
    const again = await agent("POST", `/api/v1/tickets/${t.id}/timer/start`);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("timer_open");

    w.clock.advance(90_000);
    const stopped = await agent("POST", `/api/v1/tickets/${t.id}/timer/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.json).toMatchObject({ ticketId: t.id, actorId: agentId, seconds: 90, stoppedAt: "2026-09-23T10:01:30.000Z" });
    const none = await agent("POST", `/api/v1/tickets/${t.id}/timer/stop`);
    expect(none.status).toBe(404);
    expect(none.json.error.code).toBe("timer_not_open");

    const events = listEvents(w.app.ctx.db!).filter((e) => e.type.startsWith("timer."));
    expect(events.map((e) => [e.type, e.actorId])).toEqual([["timer.started", agentId], ["timer.stopped", agentId]]);
    expect(events[0].payload).toEqual({ ticketId: t.id, actorId: agentId, projectId: w.project.id });
    expect(events[1].payload).toEqual({ ticketId: t.id, actorId: agentId, projectId: w.project.id, seconds: 90 });
  });

  it("keeps timers per actor: the human's timer is not the agent's, and each stops its own", async () => {
    const w = await world();
    const t = await w.ticket();
    const { agent } = await w.agentWith(EVERYTHING);
    expect((await w.human("POST", `/api/v1/tickets/${t.id}/timer/start`)).status).toBe(200);
    expect((await agent("POST", `/api/v1/tickets/${t.id}/timer/start`)).status).toBe(200);
    w.clock.advance(10_000);
    expect((await agent("POST", `/api/v1/tickets/${t.id}/timer/stop`)).json.seconds).toBe(10);
    const metrics = (await w.human("GET", `/api/v1/tickets/${t.id}/metrics`)).json;
    expect(metrics.openTimers).toBe(1);
    expect(metrics.seconds).toBe(20);
  });

  it("refuses an agent without timer.use, and one outside the project", async () => {
    const w = await world();
    const t = await w.ticket();
    const { agent } = await w.agentWith(["read", "ticket.move"]);
    const refused = await agent("POST", `/api/v1/tickets/${t.id}/timer/start`);
    expect(refused.status).toBe(403);
    expect(refused.json.error.message).toBe("This key may not perform timer.use");
    expect((await agent("POST", `/api/v1/tickets/${t.id}/timer/stop`)).status).toBe(403);
    expect((await w.human("POST", "/api/v1/tickets/nope/timer/start")).status).toBe(404);
  });

  it("stops every open timer on a ticket when it enters a done lane, attributing the stop to the mover with auto true", async () => {
    const w = await world();
    const t = await w.ticket();
    const { agent, agentId } = await w.agentWith(EVERYTHING);
    expect((await agent("POST", `/api/v1/tickets/${t.id}/timer/start`)).status).toBe(200);
    expect((await w.human("POST", `/api/v1/tickets/${t.id}/timer/start`)).status).toBe(200);
    w.clock.advance(45_000);
    // Done needs a human sign-off; the human provides it and moves the ticket.
    expect((await w.human("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_human_signoff", payload: {} })).status).toBe(200);
    const moved = await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: w.lane("Done").id });
    expect(moved.status).toBe(200);
    const metrics = (await w.human("GET", `/api/v1/tickets/${t.id}/metrics`)).json;
    expect(metrics.openTimers).toBe(0);
    expect(metrics.seconds).toBe(90);
    const stops = listEvents(w.app.ctx.db!).filter((e) => e.type === "timer.stopped");
    expect(stops).toHaveLength(2);
    expect(stops.every((e) => e.actorId === "human")).toBe(true);
    expect(stops.map((e) => (e.payload as any).actorId).sort()).toEqual([agentId, "human"].sort());
    expect(stops.every((e) => (e.payload as any).auto === true && (e.payload as any).seconds === 45)).toBe(true);
    // The agent's timer is gone, so its own stop finds nothing.
    expect((await agent("POST", `/api/v1/tickets/${t.id}/timer/stop`)).status).toBe(404);
  });

  it("stops an agent's open timers everywhere when the owner revokes it", async () => {
    const w = await world();
    const a = await w.ticket("a"); const b = await w.ticket("b");
    const { agent, agentId } = await w.agentWith(EVERYTHING);
    await agent("POST", `/api/v1/tickets/${a.id}/timer/start`);
    await agent("POST", `/api/v1/tickets/${b.id}/timer/start`);
    w.clock.advance(30_000);
    expect((await w.human("POST", `/api/v1/agents/${agentId}/revoke`)).status).toBe(200);
    expect((await w.human("GET", `/api/v1/tickets/${a.id}/metrics`)).json).toMatchObject({ openTimers: 0, seconds: 30 });
    expect((await w.human("GET", `/api/v1/tickets/${b.id}/metrics`)).json).toMatchObject({ openTimers: 0, seconds: 30 });
    const types = listEvents(w.app.ctx.db!).map((e) => e.type);
    expect(types.slice(-3)).toEqual(["timer.stopped", "timer.stopped", "agent.revoked"]);
    const stop = listEvents(w.app.ctx.db!).find((e) => e.type === "timer.stopped")!;
    expect(stop.actorId).toBe("human");
    expect(stop.payload).toMatchObject({ actorId: agentId, seconds: 30, auto: true });
  });
});

describe("cost", () => {
  it("stores an estimate from the bundled table with its price date, and emits cost.added", async () => {
    const w = await world();
    const t = await w.ticket();
    const { agent, agentId } = await w.agentWith(EVERYTHING);
    const body = { model: PRICED, inputTokens: 100_000, outputTokens: 20_000, cacheReadTokens: 400_000, note: "first turn" };
    const res = await agent("POST", `/api/v1/tickets/${t.id}/cost`, body);
    expect(res.status).toBe(200);
    const expected = estimateCost({ model: PRICED, inputTokens: 100_000, outputTokens: 20_000, cacheReadTokens: 400_000 });
    expect(expected.usd).not.toBeNull();
    expect(res.json).toMatchObject({ ticketId: t.id, actorId: agentId, model: PRICED, inputTokens: 100_000, outputTokens: 20_000, cacheReadTokens: 400_000, cacheWriteTokens: 0, usd: expected.usd, priceDate: BUNDLED_PRICES.date, note: "first turn", estimate: true });
    const ev = listEvents(w.app.ctx.db!).find((e) => e.type === "cost.added")!;
    expect(ev.actorId).toBe(agentId);
    expect(ev.payload).toEqual({ ticketId: t.id, actorId: agentId, projectId: w.project.id, model: PRICED, tokens: 520_000, usdEstimate: expected.usd, priceDate: BUNDLED_PRICES.date });
  });

  it("keeps an unpriced model's tokens with usd null, and the ticket total then says null with the known subtotal", async () => {
    const w = await world();
    const t = await w.ticket();
    const { agent, agentId } = await w.agentWith(EVERYTHING);
    const priced = (await agent("POST", `/api/v1/tickets/${t.id}/cost`, { model: PRICED, inputTokens: 1_000_000, outputTokens: 0 })).json;
    const unpriced = await agent("POST", `/api/v1/tickets/${t.id}/cost`, { model: UNPRICED, inputTokens: 10, outputTokens: 5 });
    expect(unpriced.status).toBe(200);
    expect(unpriced.json).toMatchObject({ usd: null, priceDate: BUNDLED_PRICES.date, estimate: true });
    const ev = listEvents(w.app.ctx.db!).filter((e) => e.type === "cost.added").at(-1)!;
    expect(ev.payload).toMatchObject({ model: UNPRICED, tokens: 15, usdEstimate: null });

    const m = (await agent("GET", `/api/v1/tickets/${t.id}/metrics`)).json;
    expect(m).toMatchObject({ estimate: true, usd: null, known: priced.usd, unpriced: 1, entries: 2, priceDate: BUNDLED_PRICES.date, seconds: 0, openTimers: 0 });
    expect(m.tokens).toEqual({ input: 1_000_010, output: 5, cacheRead: 0, cacheWrite: 0, total: 1_000_015 });
    expect(m.byModel).toEqual([
      { model: PRICED, tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_000_000 }, usd: priced.usd, known: priced.usd, unpriced: 0, entries: 1 },
      { model: UNPRICED, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, usd: null, known: 0, unpriced: 1, entries: 1 },
    ]);
    expect(m.byActor).toEqual([{ actorId: agentId, name: expect.any(String), seconds: 0, openTimers: 0, tokens: { input: 1_000_010, output: 5, cacheRead: 0, cacheWrite: 0, total: 1_000_015 }, usd: null, known: priced.usd, unpriced: 1, entries: 2 }]);
  });

  it("refuses an agent without cost.report, a bad body, and never a human", async () => {
    const w = await world();
    const t = await w.ticket();
    const { agent } = await w.agentWith(["read", "timer.use"]);
    const refused = await agent("POST", `/api/v1/tickets/${t.id}/cost`, { model: PRICED, inputTokens: 1, outputTokens: 1 });
    expect(refused.status).toBe(403);
    expect(refused.json.error.message).toBe("This key may not perform cost.report");
    expect((await w.human("POST", `/api/v1/tickets/${t.id}/cost`, { model: PRICED, inputTokens: -1, outputTokens: 1 })).status).toBe(400);
    expect((await w.human("POST", `/api/v1/tickets/${t.id}/cost`, { model: PRICED, inputTokens: 1, outputTokens: 1, bogus: true })).status).toBe(400);
    expect((await w.human("POST", `/api/v1/tickets/${t.id}/cost`, { model: PRICED, inputTokens: 1, outputTokens: 1 })).status).toBe(200);
  });

  it("caps every token field at 50,000,000 and writes nothing for a larger one", async () => {
    const w = await world();
    const t = await w.ticket();
    const CAP = 50_000_000;
    for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) {
      const res = await w.human("POST", `/api/v1/tickets/${t.id}/cost`, { model: PRICED, inputTokens: 0, outputTokens: 0, [field]: CAP + 1 });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe("validation");
      expect(JSON.stringify(res.json.error.details)).toContain(field);
    }
    expect((await w.human("GET", `/api/v1/tickets/${t.id}/metrics`)).json).toMatchObject({ entries: 0, tokens: { total: 0 } });
    expect(listEvents(w.app.ctx.db!).some((e) => e.type === "cost.added")).toBe(false);
    expect((await w.human("POST", `/api/v1/tickets/${t.id}/cost`, { model: PRICED, inputTokens: CAP, outputTokens: CAP, cacheReadTokens: CAP, cacheWriteTokens: CAP })).status).toBe(200);
  });

  it("refuses an agent scoped to another project, on cost and on timers, writing nothing", async () => {
    const w = await world();
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: other.project.id, title: "not theirs" })).json;
    const { agent } = await w.agentWith(EVERYTHING); // scoped to PAN only
    expect((await agent("POST", `/api/v1/tickets/${t.id}/cost`, { model: PRICED, inputTokens: 10, outputTokens: 10 })).status).toBe(403);
    expect((await agent("POST", `/api/v1/tickets/${t.id}/timer/start`)).status).toBe(403);
    expect((await agent("POST", `/api/v1/tickets/${t.id}/timer/stop`)).status).toBe(403);
    expect((await agent("GET", `/api/v1/tickets/${t.id}/metrics`)).status).toBe(403);
    expect((await w.human("GET", `/api/v1/tickets/${t.id}/metrics`)).json).toMatchObject({ entries: 0, openTimers: 0, seconds: 0 });
    expect(listEvents(w.app.ctx.db!).some((e) => e.type.startsWith("timer.") || e.type === "cost.added")).toBe(false);
  });

  it("orders the ticket's models and actors by estimated cost, unpriced last, then by tokens", async () => {
    const w = await world();
    const t = await w.ticket();
    const { agent: a1, agentId: id1 } = await w.agentWith(EVERYTHING);
    const { agent: a2, agentId: id2 } = await w.agentWith(EVERYTHING);
    const dear = "anthropic/claude-fable-5-1"; // $50 per million output tokens
    const cheap = "anthropic/claude-opus-4-7"; // $5 per million input tokens
    // Fewer tokens but more money on the dear model; the cheap one has eight times the tokens.
    await a1("POST", `/api/v1/tickets/${t.id}/cost`, { model: dear, inputTokens: 0, outputTokens: 50_000 });
    await a2("POST", `/api/v1/tickets/${t.id}/cost`, { model: cheap, inputTokens: 400_000, outputTokens: 0 });
    await a2("POST", `/api/v1/tickets/${t.id}/cost`, { model: UNPRICED, inputTokens: 9_000_000, outputTokens: 0 });
    const m = (await w.human("GET", `/api/v1/tickets/${t.id}/metrics`)).json;
    expect(m.byModel.map((x: any) => x.model)).toEqual([dear, cheap, UNPRICED]);
    expect(m.byModel[0].usd).toBeGreaterThan(m.byModel[1].usd);
    expect(m.byModel[0].tokens.total).toBeLessThan(m.byModel[1].tokens.total);
    // Actor 2's total is unpriced (one of its entries has no price), so actor 1 leads despite fewer tokens.
    expect(m.byActor.map((x: any) => x.actorId)).toEqual([id1, id2]);
    expect(m.byActor[1]).toMatchObject({ usd: null, unpriced: 1 });
  });
});

describe("GET /api/v1/metrics", () => {
  async function populated() {
    const w = await world("2026-09-23T10:00:00.000Z"); // a Wednesday
    const { agent: a1, agentId: id1 } = await w.agentWith(EVERYTHING);
    const { agent: a2, agentId: id2 } = await w.agentWith(EVERYTHING);
    const epic = (await w.human("POST", "/api/v1/epics", { projectId: w.project.id, name: "Retries" })).json;
    const t1 = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "one", epicId: epic.id })).json;
    const t2 = await w.ticket("two");
    await a1("POST", `/api/v1/tickets/${t1.id}/cost`, { model: PRICED, inputTokens: 1_000_000, outputTokens: 0 });
    await a2("POST", `/api/v1/tickets/${t2.id}/cost`, { model: UNPRICED, inputTokens: 100, outputTokens: 0 });
    await a1("POST", `/api/v1/tickets/${t1.id}/timer/start`);
    w.clock.advance(60_000);
    await a1("POST", `/api/v1/tickets/${t1.id}/timer/stop`);
    return { ...w, a1, a2, id1, id2, epic, t1, t2 };
  }
  const price = estimateCost({ model: PRICED, inputTokens: 1_000_000, outputTokens: 0 }).usd!;

  it("rolls up the project by agent, epic and board with the same shape per group, always marked as an estimate with a price date", async () => {
    const w = await populated();
    const byAgent = await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&period=all&groupBy=agent`);
    expect(byAgent.status).toBe(200);
    expect(byAgent.json).toMatchObject({ projectId: w.project.id, estimate: true, priceDate: BUNDLED_PRICES.date, period: { kind: "all", from: null, to: null }, groupBy: "agent" });
    expect(byAgent.json.total).toEqual({ seconds: 60, openTimers: 0, tokens: { input: 1_000_100, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_000_100 }, usd: null, known: price, unpriced: 1, entries: 2 });
    const groups = byAgent.json.groups.map((g: any) => [g.id, g.seconds, g.usd, g.known, g.unpriced, g.tokens.total]).sort();
    expect(groups).toEqual([[w.id1, 60, price, price, 0, 1_000_000], [w.id2, 0, null, 0, 1, 100]].sort());
    expect(byAgent.json.groups.every((g: any) => typeof g.name === "string")).toBe(true);

    const byEpic = (await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&period=all&groupBy=epic`)).json;
    expect(byEpic.groups).toEqual([{ id: w.epic.id, name: "Retries", seconds: 60, openTimers: 0, tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_000_000 }, usd: price, known: price, unpriced: 0, entries: 1 }]);

    const byBoard = (await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&period=all&groupBy=board`)).json;
    expect(byBoard.groups).toHaveLength(1);
    expect(byBoard.groups[0]).toMatchObject({ name: expect.any(String), seconds: 60, usd: null, known: price, unpriced: 1, entries: 2 });

    const byProject = (await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&groupBy=project`)).json;
    expect(byProject.groups).toEqual([{ id: w.project.id, name: "Boomerang", ...byProject.total }]);
  });

  it("bounds week and month on the calendar in UTC, counting a timer where it began and a cost entry when it was written", async () => {
    const w = await populated(); // entries written on Wed 2026-09-23
    w.clock.set("2026-09-27T23:59:00.000Z"); // Sunday, same ISO week (Mon 21 to Mon 28)
    const sameWeek = (await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&period=week`)).json;
    expect(sameWeek.period).toEqual({ kind: "week", from: "2026-09-21T00:00:00.000Z", to: "2026-09-28T00:00:00.000Z" });
    expect(sameWeek.total).toMatchObject({ seconds: 60, entries: 2 });

    w.clock.set("2026-09-28T00:00:00.000Z"); // Monday: a new week, still September
    const nextWeek = (await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&period=week`)).json;
    expect(nextWeek.period).toEqual({ kind: "week", from: "2026-09-28T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z" });
    expect(nextWeek.total).toEqual({ seconds: 0, openTimers: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, usd: 0, known: 0, unpriced: 0, entries: 0 });
    expect(nextWeek.priceDate).toBe(BUNDLED_PRICES.date);
    const month = (await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&period=month`)).json;
    expect(month.period).toEqual({ kind: "month", from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" });
    expect(month.total).toMatchObject({ seconds: 60, entries: 2 });

    w.clock.set("2026-10-01T00:00:00.000Z");
    expect((await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&period=month`)).json.total.entries).toBe(0);
    expect((await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&period=all`)).json.total.entries).toBe(2);
  });

  it("needs read on the project, a real project, and a known period and grouping", async () => {
    const w = await populated();
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    expect((await w.a1("GET", `/api/v1/metrics?projectId=${w.project.id}`)).status).toBe(200);
    expect((await w.a1("GET", `/api/v1/metrics?projectId=${other.project.id}`)).status).toBe(403);
    expect((await w.a1("GET", `/api/v1/tickets/${w.t1.id}/metrics`)).status).toBe(200);
    expect((await w.human("GET", "/api/v1/metrics?projectId=nope")).status).toBe(404);
    expect((await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&period=year`)).status).toBe(400);
    expect((await w.human("GET", `/api/v1/metrics?projectId=${w.project.id}&groupBy=lane`)).status).toBe(400);
  });
});
