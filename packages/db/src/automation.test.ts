import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CanvasDoc, RuleEvent } from "@boomerang/core";
import * as d from "./index";

const NOW = "2026-09-25T10:00:00.000Z";
const LATER = "2026-09-25T11:00:00.000Z";
const LATEST = "2026-09-25T12:00:00.000Z";
const MOVED: RuleEvent = { type: "ticket.moved" };
const CANVAS: CanvasDoc = { nodes: [{ id: "n1", kind: "event", position: { x: 0, y: 0 }, data: { type: "ticket.moved" } }], edges: [] };

function world() {
  const db = d.openDatabase(join(mkdtempSync(join(tmpdir(), "pan-")), "p.db"), null);
  d.migrate(db);
  const { project, lanes } = d.createProject(db, { name: "Boomerang", key: "PAN" }, NOW);
  d.insertActor(db, { id: "human", kind: "human", name: "Owner", publicKey: "11".repeat(32), scopes: null, status: "active", lastSeen: null, currentTicketId: null, createdAt: NOW });
  const ticket = d.createTicket(db, { projectId: project.id, title: "One" }, NOW);
  const event = d.appendEvent(db, { actorId: "human", type: "ticket.moved", payload: { ticketId: ticket.id }, signature: "s", now: NOW });
  const rule = d.createRule(db, { projectId: project.id, name: "Pipeline", event: MOVED, conditions: [], actions: [{ type: "set_flag", flag: "blocked" }], canvas: CANVAS }, NOW);
  return { db, project, lanes, ticket, event, rule };
}

describe("M9 migration", () => {
  it("brings a fresh database to version 9 with every foreign key intact", () => {
    const { db } = world();
    expect(db.pragma("user_version", { simple: true })).toBe(9);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("upgrades a version 8 database with existing rows, keeping fields and foreign keys", () => {
    const db = d.openDatabase(join(mkdtempSync(join(tmpdir(), "pan-")), "p.db"), null);
    d.migrateTo(db, 8);
    const { project } = d.createProject(db, { name: "Boomerang", key: "PAN" }, NOW);
    const t = d.createTicket(db, { projectId: project.id, title: "x" }, NOW);
    d.createField(db, { projectId: project.id, name: "Points", key: "points", kind: "number" }, NOW);
    d.setTicketFields(db, t.id, { points: 3 });
    expect(() => db.prepare("select 1 from rules").get()).toThrow(/no such table/);

    d.migrate(db);

    expect(db.pragma("user_version", { simple: true })).toBe(9);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(d.getTicketFields(db, t.id)).toEqual({ points: 3 });
    expect(d.listRules(db, project.id)).toEqual([]);
    db.close();
  });
});

describe("rules", () => {
  it("creates a rule enabled by default, reads it back, and lists by project", () => {
    const { db, project, rule } = world();
    expect(rule).toMatchObject({ projectId: project.id, name: "Pipeline", enabled: true, event: MOVED, conditions: [], actions: [{ type: "set_flag", flag: "blocked" }], canvas: CANVAS, createdAt: NOW, updatedAt: NOW });
    expect(d.getRule(db, rule.id)).toEqual(rule);
    const off = d.createRule(db, { projectId: project.id, name: "Paused", enabled: false, event: MOVED, conditions: [], actions: [], canvas: CANVAS }, LATER);
    expect(d.listRules(db, project.id).map((r) => r.id)).toEqual([rule.id, off.id]);
    expect(d.listRules(db, project.id, { enabledOnly: true }).map((r) => r.id)).toEqual([rule.id]);
    expect(d.listRules(db, "elsewhere")).toEqual([]);
  });

  it("patches a rule, bumping updated_at, and leaves untouched fields alone", () => {
    const { db, rule } = world();
    const updated = d.updateRule(db, rule.id, { name: "Renamed", enabled: false, conditions: [{ kind: "flag", op: "is", value: "blocked" }] }, LATER);
    expect(updated).toMatchObject({ name: "Renamed", enabled: false, conditions: [{ kind: "flag", op: "is", value: "blocked" }], actions: rule.actions, canvas: CANVAS, createdAt: NOW, updatedAt: LATER });
    expect(d.getRule(db, rule.id)).toEqual(updated);
  });

  it("deletes a rule with its triggers while its run log survives", () => {
    const { db, rule, ticket, event } = world();
    const trigger = d.createTrigger(db, { ruleId: rule.id, cron: "0 9 * * *", timezone: "UTC", nextRunAt: LATER });
    d.addRuleRun(db, { ruleId: rule.id, ticketId: ticket.id, eventSeq: event.seq, outcome: "applied", detail: { matched: ["n1"] } }, NOW);
    d.deleteRule(db, rule.id);
    expect(d.getRule(db, rule.id)).toBeUndefined();
    expect(d.getTrigger(db, trigger.id)).toBeUndefined();
    expect(d.listRuleRuns(db, rule.id)).toHaveLength(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("rule runs", () => {
  it("records a run against the chain event that fired it and pages newest first", () => {
    const { db, rule, ticket, event } = world();
    const a = d.addRuleRun(db, { ruleId: rule.id, ticketId: ticket.id, eventSeq: event.seq, outcome: "applied", detail: { matched: ["n1"], applied: ["set_flag"] } }, NOW);
    const b = d.addRuleRun(db, { ruleId: rule.id, ticketId: null, eventSeq: event.seq, outcome: "refused", detail: { reasons: ["gate"] } }, LATER);
    const c = d.addRuleRun(db, { ruleId: rule.id, ticketId: ticket.id, eventSeq: event.seq, outcome: "error", detail: {} }, LATEST);
    expect(a).toEqual({ id: a.id, ruleId: rule.id, ticketId: ticket.id, eventSeq: event.seq, firedAt: NOW, outcome: "applied", detail: { matched: ["n1"], applied: ["set_flag"] } });
    expect(b.ticketId).toBeNull();
    expect(d.listRuleRuns(db, rule.id).map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    expect(d.listRuleRuns(db, rule.id, { limit: 1 })).toEqual([c]);
    expect(d.listRuleRuns(db, rule.id, { limit: 5, before: c.id })).toEqual([b, a]);
    expect(d.listRuleRuns(db, rule.id, { before: a.id })).toEqual([]);
    expect(d.listRuleRuns(db, "other")).toEqual([]);
  });

  it("is append-only, needs a real chain event, and accepts only the four outcomes", () => {
    const { db, rule, ticket, event } = world();
    const run = d.addRuleRun(db, { ruleId: rule.id, ticketId: ticket.id, eventSeq: event.seq, outcome: "skipped", detail: {} }, NOW);
    expect(() => db.prepare("update rule_runs set outcome = 'applied' where id = ?").run(run.id)).toThrow(/append-only/);
    expect(() => db.prepare("delete from rule_runs where id = ?").run(run.id)).toThrow(/append-only/);
    expect(() => d.addRuleRun(db, { ruleId: rule.id, ticketId: ticket.id, eventSeq: 999, outcome: "applied", detail: {} }, NOW)).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare("insert into rule_runs(id, rule_id, event_seq, fired_at, outcome, detail) values('x', ?, ?, ?, 'maybe', '{}')").run(rule.id, event.seq, NOW)).toThrow(/CHECK/);
  });
});

describe("triggers", () => {
  it("creates a trigger with the run_once policy by default and lists by rule or project", () => {
    const { db, project, rule } = world();
    const t = d.createTrigger(db, { ruleId: rule.id, cron: "*/5 * * * *", timezone: "Europe/London", nextRunAt: LATER });
    expect(t).toEqual({ id: t.id, ruleId: rule.id, cron: "*/5 * * * *", timezone: "Europe/London", nextRunAt: LATER, lastRunAt: null, missedPolicy: "run_once", enabled: true });
    expect(d.listTriggers(db, { ruleId: rule.id })).toEqual([t]);
    expect(d.listTriggers(db, { projectId: project.id })).toEqual([t]);
    expect(d.listTriggers(db, { projectId: "elsewhere" })).toEqual([]);
    expect(d.updateTrigger(db, t.id, { missedPolicy: "run_all", enabled: false, cron: "0 * * * *" })).toMatchObject({ missedPolicy: "run_all", enabled: false, cron: "0 * * * *" });
    expect(() => db.prepare("update triggers set missed_policy = 'later' where id = ?").run(t.id)).toThrow(/CHECK/);
  });

  it("reports due triggers only when the trigger and its rule are enabled, and marks a run", () => {
    const { db, project, rule } = world();
    const due = d.createTrigger(db, { ruleId: rule.id, cron: "0 9 * * *", timezone: "UTC", nextRunAt: NOW });
    d.createTrigger(db, { ruleId: rule.id, cron: "0 9 * * *", timezone: "UTC", nextRunAt: LATER });
    d.createTrigger(db, { ruleId: rule.id, cron: "0 9 * * *", timezone: "UTC", nextRunAt: NOW, enabled: false });
    d.createTrigger(db, { ruleId: rule.id, cron: "0 9 * * *", timezone: "UTC", nextRunAt: null });
    const paused = d.createRule(db, { projectId: project.id, name: "Paused", enabled: false, event: MOVED, conditions: [], actions: [], canvas: CANVAS }, NOW);
    d.createTrigger(db, { ruleId: paused.id, cron: "0 9 * * *", timezone: "UTC", nextRunAt: NOW });

    expect(d.dueTriggers(db, NOW).map((t) => t.id)).toEqual([due.id]);
    expect(d.dueTriggers(db, LATER)).toHaveLength(2);
    const marked = d.markTriggerRun(db, due.id, { lastRunAt: NOW, nextRunAt: LATER });
    expect(marked).toMatchObject({ lastRunAt: NOW, nextRunAt: LATER });
    expect(d.dueTriggers(db, NOW)).toEqual([]);
    d.deleteTrigger(db, due.id);
    expect(d.getTrigger(db, due.id)).toBeUndefined();
  });
});

describe("destinations", () => {
  it("keeps the secret out of the mapped row and hands it out only on request", () => {
    const { db, project } = world();
    const dest = d.createDestination(db, { projectId: project.id, name: "Eval service", url: "https://example.test/hook", secret: "shh" }, NOW);
    expect(dest).toEqual({ id: dest.id, projectId: project.id, name: "Eval service", url: "https://example.test/hook", createdAt: NOW, archived: false });
    expect(Object.keys(dest)).not.toContain("secret");
    expect(d.getDestinationSecret(db, dest.id)).toBe("shh");
    expect(d.getDestinationSecret(db, "ghost")).toBeUndefined();
    expect(d.updateDestination(db, dest.id, { name: "Evals", secret: "new" })).toMatchObject({ name: "Evals", url: dest.url });
    expect(d.getDestinationSecret(db, dest.id)).toBe("new");
  });

  it("hides archived destinations unless asked", () => {
    const { db, project } = world();
    const a = d.createDestination(db, { projectId: project.id, name: "A", url: "https://a.test", secret: "a" }, NOW);
    const b = d.createDestination(db, { projectId: project.id, name: "B", url: "https://b.test", secret: "b" }, LATER);
    d.updateDestination(db, a.id, { archived: true });
    expect(d.listDestinations(db, project.id).map((x) => x.id)).toEqual([b.id]);
    expect(d.listDestinations(db, project.id, { includeArchived: true }).map((x) => x.id)).toEqual([a.id, b.id]);
    expect(d.getDestination(db, a.id)!.archived).toBe(true);
  });
});

describe("outbox", () => {
  it("enqueues against the event, serves due rows oldest first, records attempts, and purges delivered rows", () => {
    const { db, project, event } = world();
    const dest = d.createDestination(db, { projectId: project.id, name: "A", url: "https://a.test", secret: "a" }, NOW);
    const first = d.enqueueOutbox(db, { destinationId: dest.id, eventSeq: event.seq, payload: { type: "ticket.moved" } }, NOW);
    const second = d.enqueueOutbox(db, { destinationId: dest.id, eventSeq: event.seq, payload: { n: 2 } }, LATER);
    expect(first).toEqual({ id: first.id, destinationId: dest.id, eventSeq: event.seq, payload: { type: "ticket.moved" }, attempts: 0, nextAttemptAt: NOW, deliveredAt: null, lastError: null, createdAt: NOW });
    expect(d.dueOutbox(db, NOW).map((o) => o.id)).toEqual([first.id]);
    expect(d.dueOutbox(db, LATER).map((o) => o.id)).toEqual([first.id, second.id]);
    expect(d.dueOutbox(db, LATER, 1).map((o) => o.id)).toEqual([first.id]);

    const retryAt = "2026-09-25T10:00:30.000Z";
    const failed = d.markOutboxAttempt(db, first.id, { ok: false, error: "503", now: NOW, nextAttemptAt: retryAt });
    expect(failed).toMatchObject({ attempts: 1, lastError: "503", nextAttemptAt: retryAt, deliveredAt: null });
    expect(d.dueOutbox(db, NOW)).toEqual([]);
    expect(d.dueOutbox(db, retryAt).map((o) => o.id)).toEqual([first.id]);

    const delivered = d.markOutboxAttempt(db, first.id, { ok: true, now: LATER });
    expect(delivered).toMatchObject({ attempts: 2, lastError: null, deliveredAt: LATER });
    expect(d.dueOutbox(db, LATEST).map((o) => o.id)).toEqual([second.id]);

    expect(d.purgeDelivered(db, LATER)).toBe(0);
    expect(d.purgeDelivered(db, LATEST)).toBe(1);
    expect(d.getOutboxItem(db, first.id)).toBeUndefined();
    expect(d.getOutboxItem(db, second.id)).toEqual(second);
    expect(() => d.enqueueOutbox(db, { destinationId: "ghost", eventSeq: event.seq, payload: {} }, NOW)).toThrow(/FOREIGN KEY/);
  });
});
