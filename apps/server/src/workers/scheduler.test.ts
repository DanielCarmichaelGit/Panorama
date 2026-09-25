import { describe, expect, it } from "vitest";
import type { CanvasDoc, ChainEvent, RuleEvent } from "@boomerang/core";
import * as d from "@boomerang/db";
import { setupApp } from "../test/helpers";
import { nextRunAfter, Scheduler } from "./scheduler";

// The scheduler keeps its own clock: routes still sign against real time, so tests advance
// only the clock the scheduler reads.
const T = (s: string) => new Date(s);
const CANVAS: CanvasDoc = { nodes: [{ id: "n1", kind: "schedule", position: { x: 0, y: 0 }, data: { cron: "*/5 * * * *", timezone: "UTC" } }], edges: [] };
const EVERY_FIVE: RuleEvent = { type: "schedule", cron: "*/5 * * * *", timezone: "UTC" };
const EVERY_MINUTE: RuleEvent = { type: "schedule", cron: "* * * * *", timezone: "UTC" };

async function world(encryption = false) {
  const s = await setupApp(encryption);
  const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
  const clock = { now: T("2026-09-25T10:02:00.000Z") };
  const notes: string[] = [];
  const published: { type: string; payload: any }[] = [];
  s.app.ctx.bus.subscribe((e: { type: string; payload: unknown }) => published.push({ type: e.type, payload: e.payload }));
  const handed: ChainEvent[] = [];
  const sched = new Scheduler(s.app.ctx, { now: () => clock.now, log: (m) => notes.push(m), onEvents: (_db, evs) => handed.push(...evs) });
  const db = () => s.app.ctx.db!;
  const rule = (event: RuleEvent, enabled = true) =>
    d.createRule(db(), { projectId: project.id, name: "R", enabled, event, conditions: [], actions: [{ type: "set_flag", flag: "blocked" }], canvas: CANVAS }, clock.now.toISOString());
  const fired = () => d.listEvents(db()).filter((e) => e.type === "trigger.fired");
  return { s, project, clock, notes, published, handed, sched, db, rule, fired };
}

describe("nextRunAfter", () => {
  it("computes the next occurrence strictly after a time, in the trigger's timezone", () => {
    expect(nextRunAfter("*/5 * * * *", "UTC", T("2026-09-25T10:00:00.000Z"))?.toISOString()).toBe("2026-09-25T10:05:00.000Z");
    expect(nextRunAfter("0 9 * * *", "America/New_York", T("2026-09-25T10:00:00.000Z"))?.toISOString()).toBe("2026-09-25T13:00:00.000Z");
    expect(() => nextRunAfter("not a cron", "UTC", T("2026-09-25T10:00:00.000Z"))).toThrow();
  });
});

describe("scheduler", () => {
  it("fires a due trigger once, marks the run, and hands the event to the bus and the engine hook", async () => {
    const w = await world();
    const r = w.rule(EVERY_MINUTE);
    const t = d.createTrigger(w.db(), { ruleId: r.id, cron: "* * * * *", timezone: "UTC", nextRunAt: "2026-09-25T10:02:00.000Z" });
    w.sched.tick();
    const evs = w.fired();
    expect(evs).toHaveLength(1);
    expect(evs[0].actorId).toBe("system");
    expect(evs[0].payload).toEqual({ ruleId: r.id, triggerId: t.id, projectId: w.project.id, scheduledFor: "2026-09-25T10:02:00.000Z", missed: 0 });
    expect(d.getTrigger(w.db(), t.id)).toMatchObject({ lastRunAt: "2026-09-25T10:02:00.000Z", nextRunAt: "2026-09-25T10:03:00.000Z" });
    expect(w.published.map((p) => p.type)).toContain("trigger.fired");
    expect(w.handed.map((e) => e.type)).toEqual(["trigger.fired"]);
    w.sched.tick();
    expect(w.fired()).toHaveLength(1);
    w.clock.now = T("2026-09-25T10:03:10.000Z");
    w.sched.tick();
    expect(w.fired()).toHaveLength(2);
  });

  it("applies the missed policy: skip fires nothing for the past, run_once fires once, run_all fires each occurrence", async () => {
    const w = await world();
    const mk = (policy: d.MissedPolicy) => d.createTrigger(w.db(), { ruleId: w.rule(EVERY_FIVE).id, cron: "*/5 * * * *", timezone: "UTC", nextRunAt: "2026-09-25T09:00:00.000Z", missedPolicy: policy });
    const skip = mk("skip"); const once = mk("run_once"); const all = mk("run_all");
    w.sched.tick();
    const by = (id: string) => w.fired().filter((e) => (e.payload as any).triggerId === id);
    expect(by(skip.id)).toHaveLength(0);
    expect(by(once.id)).toHaveLength(1);
    expect(by(once.id)[0].payload).toMatchObject({ scheduledFor: "2026-09-25T10:00:00.000Z", missed: 13 });
    const each = by(all.id);
    expect(each).toHaveLength(13);
    expect(each.map((e) => (e.payload as any).scheduledFor)).toEqual([...Array(13)].map((_, i) => new Date(Date.UTC(2026, 8, 25, 9, i * 5)).toISOString()));
    for (const id of [skip.id, once.id, all.id]) expect(d.getTrigger(w.db(), id)!.nextRunAt).toBe("2026-09-25T10:05:00.000Z");
  });

  it("caps run_all at 100 fires and notes it", async () => {
    const w = await world();
    const t = d.createTrigger(w.db(), { ruleId: w.rule(EVERY_MINUTE).id, cron: "* * * * *", timezone: "UTC", nextRunAt: "2026-09-25T07:00:00.000Z", missedPolicy: "run_all" });
    w.sched.tick();
    expect(w.fired()).toHaveLength(100);
    expect(w.notes.join("\n")).toMatch(/100/);
    expect(w.notes.join("\n")).toContain(t.id);
    expect(d.getTrigger(w.db(), t.id)!.nextRunAt).toBe("2026-09-25T10:03:00.000Z");
  });

  it("computes a first run for a trigger without one, and never fires a disabled rule", async () => {
    const w = await world();
    const fresh = d.createTrigger(w.db(), { ruleId: w.rule(EVERY_FIVE).id, cron: "*/5 * * * *", timezone: "UTC" });
    const off = d.createTrigger(w.db(), { ruleId: w.rule(EVERY_FIVE, false).id, cron: "*/5 * * * *", timezone: "UTC", nextRunAt: "2026-09-25T10:00:00.000Z" });
    w.sched.tick();
    expect(w.fired()).toHaveLength(0);
    expect(d.getTrigger(w.db(), fresh.id)!.nextRunAt).toBe("2026-09-25T10:05:00.000Z");
    expect(d.getTrigger(w.db(), off.id)!.nextRunAt).toBe("2026-09-25T10:00:00.000Z");
  });

  it("keeps triggers in step with rules: creates for a schedule rule, updates on a cron change, deletes when the event changes", async () => {
    const w = await world();
    const r = w.rule(EVERY_FIVE);
    w.sched.tick();
    let ts = d.listTriggers(w.db(), { ruleId: r.id });
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ cron: "*/5 * * * *", timezone: "UTC", nextRunAt: "2026-09-25T10:05:00.000Z" });
    d.updateRule(w.db(), r.id, { event: EVERY_MINUTE }, w.clock.now.toISOString());
    w.sched.tick();
    ts = d.listTriggers(w.db(), { ruleId: r.id });
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ cron: "* * * * *", nextRunAt: "2026-09-25T10:03:00.000Z" });
    d.updateRule(w.db(), r.id, { event: { type: "ticket.moved" } }, w.clock.now.toISOString());
    w.sched.tick();
    expect(d.listTriggers(w.db(), { ruleId: r.id })).toHaveLength(0);
  });

  it("does nothing while locked and catches up on unlock", async () => {
    const w = await world(true);
    const t = d.createTrigger(w.db(), { ruleId: w.rule(EVERY_FIVE).id, cron: "*/5 * * * *", timezone: "UTC", nextRunAt: "2026-09-25T10:05:00.000Z", missedPolicy: "run_once" });
    w.sched.tick();
    expect(w.fired()).toHaveLength(0);
    expect((await w.s.human("POST", "/api/v1/lock")).status).toBe(200);
    w.clock.now = T("2026-09-25T11:02:00.000Z");
    expect(() => w.sched.tick()).not.toThrow();
    expect((await w.s.app.inject({ method: "POST", url: "/api/v1/unlock", payload: { dbKey: w.s.keys.dbKeyHex } })).statusCode).toBe(200);
    w.sched.tick();
    const evs = w.fired();
    expect(evs).toHaveLength(1);
    expect(evs[0].payload).toMatchObject({ triggerId: t.id, scheduledFor: "2026-09-25T11:00:00.000Z", missed: 12 });
    expect(d.getTrigger(w.db(), t.id)!.nextRunAt).toBe("2026-09-25T11:05:00.000Z");
  });

  it("emits ticket.due_passed once per ticket, skipping archived tickets and remembering across a restart", async () => {
    const w = await world();
    const iso = w.clock.now.toISOString();
    const mk = (title: string, dueDate: string | null) => {
      const t = d.createTicket(w.db(), { projectId: w.project.id, title }, iso);
      return dueDate ? d.updateTicket(w.db(), t.id, { dueDate }, iso) : t;
    };
    const passed = mk("passed", "2026-09-20"); mk("future", "2026-09-30"); mk("none", null);
    const gone = mk("archived", "2026-09-19"); d.archiveTicket(w.db(), gone.id, iso);
    w.sched.tick();
    const due = () => d.listEvents(w.db()).filter((e) => e.type === "ticket.due_passed");
    expect(due()).toHaveLength(1);
    expect(due()[0].payload).toEqual({ ticketId: passed.id, projectId: w.project.id, dueDate: "2026-09-20" });
    w.clock.now = T("2026-09-25T10:04:00.000Z");
    w.sched.tick();
    expect(due()).toHaveLength(1);
    const again = new Scheduler(w.s.app.ctx, { now: () => w.clock.now });
    again.tick();
    expect(due()).toHaveLength(1);
    // A due date moved forward that passes again is a new deadline and fires again.
    d.updateTicket(w.db(), passed.id, { dueDate: "2026-09-22" }, iso);
    w.clock.now = T("2026-09-25T10:06:00.000Z");
    again.tick();
    expect(due()).toHaveLength(2);
    expect(due()[1].payload).toMatchObject({ ticketId: passed.id, dueDate: "2026-09-22" });
  });

  it("runs on a timer that can be started and stopped", async () => {
    const w = await world();
    d.createTrigger(w.db(), { ruleId: w.rule(EVERY_MINUTE).id, cron: "* * * * *", timezone: "UTC", nextRunAt: "2026-09-25T10:02:00.000Z" });
    const timed = new Scheduler(w.s.app.ctx, { now: () => w.clock.now, intervalMs: 5 });
    timed.start();
    await new Promise((r) => setTimeout(r, 40));
    timed.stop();
    expect(w.fired()).toHaveLength(1);
  });
});
