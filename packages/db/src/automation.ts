import { randomUUID } from "node:crypto";
import type { CanvasDoc, Condition, Rule, RuleAction, RuleEvent } from "@boomerang/core";
import type { DB } from "./open";

// Rules, their run log, schedule triggers, webhook destinations, and the outbox (milestone 3,
// task 3; migration M9). Timers and cost live in metrics.ts. Like every repository here these
// functions are non-transactional: the route or the engine wraps them.

const toRule = (r: any): Rule => ({
  id: r.id, projectId: r.project_id, name: r.name, enabled: !!r.enabled, event: JSON.parse(r.event), conditions: JSON.parse(r.conditions),
  actions: JSON.parse(r.actions), canvas: JSON.parse(r.canvas), createdAt: r.created_at, updatedAt: r.updated_at,
});

export function createRule(
  db: DB,
  input: { projectId: string; name: string; enabled?: boolean; event: RuleEvent; conditions: Condition[]; actions: RuleAction[]; canvas: CanvasDoc },
  now: string
): Rule {
  const id = randomUUID();
  db.prepare("insert into rules(id, project_id, name, enabled, event, conditions, actions, canvas, created_at, updated_at) values(?,?,?,?,?,?,?,?,?,?)")
    .run(id, input.projectId, input.name, input.enabled === false ? 0 : 1, JSON.stringify(input.event), JSON.stringify(input.conditions), JSON.stringify(input.actions), JSON.stringify(input.canvas), now, now);
  return getRule(db, id)!;
}
export const getRule = (db: DB, id: string): Rule | undefined => { const r = db.prepare("select * from rules where id = ?").get(id); return r ? toRule(r) : undefined; };
export const listRules = (db: DB, projectId: string, opts: { enabledOnly?: boolean } = {}): Rule[] => {
  const where = opts.enabledOnly ? "project_id = ? and enabled = 1" : "project_id = ?";
  return db.prepare(`select * from rules where ${where} order by created_at, id`).all(projectId).map(toRule);
};
export function updateRule(
  db: DB,
  id: string,
  patch: { name?: string; enabled?: boolean; event?: RuleEvent; conditions?: Condition[]; actions?: RuleAction[]; canvas?: CanvasDoc },
  now: string
): Rule {
  const cols: Record<string, unknown> = {};
  if (patch.name !== undefined) cols.name = patch.name;
  if (patch.enabled !== undefined) cols.enabled = patch.enabled ? 1 : 0;
  if (patch.event !== undefined) cols.event = JSON.stringify(patch.event);
  if (patch.conditions !== undefined) cols.conditions = JSON.stringify(patch.conditions);
  if (patch.actions !== undefined) cols.actions = JSON.stringify(patch.actions);
  if (patch.canvas !== undefined) cols.canvas = JSON.stringify(patch.canvas);
  cols.updated_at = now;
  const keys = Object.keys(cols);
  db.prepare(`update rules set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`).run(...keys.map((k) => cols[k]), id);
  return getRule(db, id)!;
}
/** A hard delete, which is a human action the route records. The rule's triggers go with it;
 *  its run log stays (rule_runs has no foreign key to rules, and is append-only besides). */
export function deleteRule(db: DB, id: string): void {
  db.prepare("delete from triggers where rule_id = ?").run(id);
  db.prepare("delete from rules where id = ?").run(id);
}

export type RuleRunOutcome = "applied" | "skipped" | "refused" | "error";
/** One firing of a rule: the chain event that fired it (`eventSeq`), the ticket it concerned
 *  when there was one, and a detail object for matched node ids, actions applied, and refusal
 *  reasons, whose shape the engine (task 4) owns. */
export interface RuleRun { id: string; ruleId: string; ticketId: string | null; eventSeq: number; firedAt: string; outcome: RuleRunOutcome; detail: Record<string, unknown> }
const toRun = (r: any): RuleRun => ({ id: r.id, ruleId: r.rule_id, ticketId: r.ticket_id, eventSeq: r.event_seq, firedAt: r.fired_at, outcome: r.outcome, detail: JSON.parse(r.detail) });

export function addRuleRun(db: DB, run: { ruleId: string; ticketId: string | null; eventSeq: number; outcome: RuleRunOutcome; detail: Record<string, unknown> }, now: string): RuleRun {
  const id = randomUUID();
  db.prepare("insert into rule_runs(id, rule_id, ticket_id, event_seq, fired_at, outcome, detail) values(?,?,?,?,?,?,?)")
    .run(id, run.ruleId, run.ticketId, run.eventSeq, now, run.outcome, JSON.stringify(run.detail));
  return toRun(db.prepare("select * from rule_runs where id = ?").get(id));
}
/** Newest first. `before` is the id of the last run already shown: the page continues from
 *  just past it in (fired_at, id) order, so runs sharing a timestamp are never skipped. */
export function listRuleRuns(db: DB, ruleId: string, opts: { limit?: number; before?: string } = {}): RuleRun[] {
  const limit = opts.limit ?? 50;
  if (opts.before === undefined) return db.prepare("select * from rule_runs where rule_id = ? order by fired_at desc, id desc limit ?").all(ruleId, limit).map(toRun);
  return db.prepare(
    `select * from rule_runs where rule_id = ? and (fired_at, id) < (select fired_at, id from rule_runs where id = ?)
     order by fired_at desc, id desc limit ?`
  ).all(ruleId, opts.before, limit).map(toRun);
}

export type MissedPolicy = "skip" | "run_once" | "run_all";
/** The scheduler's state for a rule whose event is a schedule. `nextRunAt` is computed by the
 *  scheduler (croner, task 5) and is null until it has; a null never comes due. */
export interface Trigger { id: string; ruleId: string; cron: string; timezone: string; nextRunAt: string | null; lastRunAt: string | null; missedPolicy: MissedPolicy; enabled: boolean }
const toTrigger = (r: any): Trigger => ({ id: r.id, ruleId: r.rule_id, cron: r.cron, timezone: r.timezone, nextRunAt: r.next_run_at, lastRunAt: r.last_run_at, missedPolicy: r.missed_policy, enabled: !!r.enabled });

export function createTrigger(db: DB, input: { ruleId: string; cron: string; timezone: string; nextRunAt?: string | null; missedPolicy?: MissedPolicy; enabled?: boolean }): Trigger {
  const id = randomUUID();
  db.prepare("insert into triggers(id, rule_id, cron, timezone, next_run_at, last_run_at, missed_policy, enabled) values(?,?,?,?,?,null,?,?)")
    .run(id, input.ruleId, input.cron, input.timezone, input.nextRunAt ?? null, input.missedPolicy ?? "run_once", input.enabled === false ? 0 : 1);
  return getTrigger(db, id)!;
}
export const getTrigger = (db: DB, id: string): Trigger | undefined => { const r = db.prepare("select * from triggers where id = ?").get(id); return r ? toTrigger(r) : undefined; };
export function listTriggers(db: DB, f: { ruleId?: string; projectId?: string } = {}): Trigger[] {
  const where = ["1 = 1"]; const args: unknown[] = [];
  if (f.ruleId) { where.push("t.rule_id = ?"); args.push(f.ruleId); }
  if (f.projectId) { where.push("r.project_id = ?"); args.push(f.projectId); }
  return db.prepare(`select t.* from triggers t join rules r on r.id = t.rule_id where ${where.join(" and ")} order by t.rule_id, t.id`).all(...args).map(toTrigger);
}
export function updateTrigger(db: DB, id: string, patch: { cron?: string; timezone?: string; nextRunAt?: string | null; missedPolicy?: MissedPolicy; enabled?: boolean }): Trigger {
  const cols: Record<string, unknown> = {};
  if (patch.cron !== undefined) cols.cron = patch.cron;
  if (patch.timezone !== undefined) cols.timezone = patch.timezone;
  if (patch.nextRunAt !== undefined) cols.next_run_at = patch.nextRunAt;
  if (patch.missedPolicy !== undefined) cols.missed_policy = patch.missedPolicy;
  if (patch.enabled !== undefined) cols.enabled = patch.enabled ? 1 : 0;
  const keys = Object.keys(cols);
  if (keys.length > 0) db.prepare(`update triggers set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`).run(...keys.map((k) => cols[k]), id);
  return getTrigger(db, id)!;
}
export const deleteTrigger = (db: DB, id: string): void => { db.prepare("delete from triggers where id = ?").run(id); };
/** Triggers whose next run is at or before `now`, on enabled triggers of enabled rules only:
 *  pausing the rule pauses its schedule. Oldest due first. */
export const dueTriggers = (db: DB, now: string): Trigger[] =>
  db.prepare("select t.* from triggers t join rules r on r.id = t.rule_id where t.enabled = 1 and r.enabled = 1 and t.next_run_at is not null and t.next_run_at <= ? order by t.next_run_at, t.id")
    .all(now).map(toTrigger);
export function markTriggerRun(db: DB, id: string, run: { lastRunAt: string; nextRunAt: string | null }): Trigger {
  db.prepare("update triggers set last_run_at = ?, next_run_at = ? where id = ?").run(run.lastRunAt, run.nextRunAt, id);
  return getTrigger(db, id)!;
}

/** A webhook destination as the API and UI see it: the secret is not on it. The outbox worker
 *  asks for the secret separately (`getDestinationSecret`) when it signs a delivery. */
export interface Destination { id: string; projectId: string; name: string; url: string; createdAt: string; archived: boolean }
const toDestination = (r: any): Destination => ({ id: r.id, projectId: r.project_id, name: r.name, url: r.url, createdAt: r.created_at, archived: !!r.archived });

export function createDestination(db: DB, input: { projectId: string; name: string; url: string; secret: string }, now: string): Destination {
  const id = randomUUID();
  db.prepare("insert into destinations(id, project_id, name, url, secret, created_at) values(?,?,?,?,?,?)").run(id, input.projectId, input.name, input.url, input.secret, now);
  return getDestination(db, id)!;
}
export const getDestination = (db: DB, id: string): Destination | undefined => { const r = db.prepare("select * from destinations where id = ?").get(id); return r ? toDestination(r) : undefined; };
export const getDestinationSecret = (db: DB, id: string): string | undefined => (db.prepare("select secret from destinations where id = ?").get(id) as { secret: string } | undefined)?.secret;
export const listDestinations = (db: DB, projectId: string, opts: { includeArchived?: boolean } = {}): Destination[] => {
  const where = opts.includeArchived ? "project_id = ?" : "project_id = ? and archived = 0";
  return db.prepare(`select * from destinations where ${where} order by created_at, id`).all(projectId).map(toDestination);
};
export function updateDestination(db: DB, id: string, patch: { name?: string; url?: string; secret?: string; archived?: boolean }): Destination {
  const cols: Record<string, unknown> = {};
  if (patch.name !== undefined) cols.name = patch.name;
  if (patch.url !== undefined) cols.url = patch.url;
  if (patch.secret !== undefined) cols.secret = patch.secret;
  if (patch.archived !== undefined) cols.archived = patch.archived ? 1 : 0;
  const keys = Object.keys(cols);
  if (keys.length > 0) db.prepare(`update destinations set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`).run(...keys.map((k) => cols[k]), id);
  return getDestination(db, id)!;
}

/** One pending or delivered webhook delivery. Written in the same transaction as the chain
 *  event it carries (`eventSeq`), retried by the worker until `deliveredAt` is set. */
export interface OutboxItem { id: string; destinationId: string; eventSeq: number; payload: unknown; attempts: number; nextAttemptAt: string; deliveredAt: string | null; lastError: string | null; createdAt: string }
const toOutbox = (r: any): OutboxItem => ({ id: r.id, destinationId: r.destination_id, eventSeq: r.event_seq, payload: JSON.parse(r.payload), attempts: r.attempts, nextAttemptAt: r.next_attempt_at, deliveredAt: r.delivered_at, lastError: r.last_error, createdAt: r.created_at });

export function enqueueOutbox(db: DB, input: { destinationId: string; eventSeq: number; payload: unknown }, now: string): OutboxItem {
  const id = randomUUID();
  db.prepare("insert into outbox(id, destination_id, event_seq, payload, attempts, next_attempt_at, created_at) values(?,?,?,?,0,?,?)")
    .run(id, input.destinationId, input.eventSeq, JSON.stringify(input.payload ?? null), now, now);
  return getOutboxItem(db, id)!;
}
export const getOutboxItem = (db: DB, id: string): OutboxItem | undefined => { const r = db.prepare("select * from outbox where id = ?").get(id); return r ? toOutbox(r) : undefined; };
/** Undelivered rows due at or before `now`, oldest attempt time first, so a row that keeps
 *  failing does not starve the rest. */
export const dueOutbox = (db: DB, now: string, limit = 100): OutboxItem[] =>
  db.prepare("select * from outbox where delivered_at is null and next_attempt_at <= ? order by next_attempt_at, created_at, id limit ?").all(now, limit).map(toOutbox);
/** Records one delivery attempt. On failure the worker supplies the next attempt time (its
 *  backoff is its own business); on success the row is marked delivered and the error cleared. */
export function markOutboxAttempt(db: DB, id: string, result: { ok: true; now: string } | { ok: false; error: string; now: string; nextAttemptAt: string }): OutboxItem {
  if (result.ok) db.prepare("update outbox set attempts = attempts + 1, delivered_at = ?, last_error = null where id = ?").run(result.now, id);
  else db.prepare("update outbox set attempts = attempts + 1, last_error = ?, next_attempt_at = ? where id = ?").run(result.error, result.nextAttemptAt, id);
  return getOutboxItem(db, id)!;
}
/** A next attempt time no clock reaches: a parked row stays for the record but is never due. */
export const OUTBOX_PARKED_AT = "9999-12-31T00:00:00.000Z";
/** Sets a row aside without counting an attempt: its destination is archived or gone, so there
 *  is nothing to deliver to. The row keeps its history and `dueOutbox` never returns it again. */
export function parkOutbox(db: DB, id: string, error: string): OutboxItem {
  db.prepare("update outbox set last_error = ?, next_attempt_at = ? where id = ?").run(error, OUTBOX_PARKED_AT, id);
  return getOutboxItem(db, id)!;
}
/** Removes rows delivered before `before`; returns how many went. Undelivered rows are never
 *  purged here: a delivery that gave up is the worker's to flag, not to forget. */
export const purgeDelivered = (db: DB, before: string): number =>
  db.prepare("delete from outbox where delivered_at is not null and delivered_at < ?").run(before).changes;
