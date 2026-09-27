import { Cron } from "croner";
import type { ChainEvent } from "@boomerang/core";
import {
  createTrigger,
  deleteTrigger,
  dueTriggers,
  getRule,
  listEventsOfType,
  listProjects,
  listRules,
  listTicketsDueBefore,
  listTriggers,
  markTriggerRun,
  updateTrigger,
  type DB,
  type Trigger,
} from "@boomerang/db";
import type { Ctx } from "../context";
import { appendSystemEvent, publishEvents, type OnEvents } from "./system";

// The scheduler (base spec section 9). Every 15 s it looks for triggers whose next run has come,
// fires them as `trigger.fired` chain events, and once a minute announces tickets whose due date
// has passed as `ticket.due_passed`. It never acts on tickets itself: the engine reacts to those
// events like any other. It runs only while the database is open: locked means nothing fires,
// and the first tick after unlock (or after start, with encryption off) is the catch-up, where
// each trigger's missed policy decides what happens to the runs that fell in the gap.

export interface SchedulerOptions {
  /** The clock the scheduler reads; the routes keep their own. */
  now?: () => Date;
  /** Between ticks, when started. */
  intervalMs?: number;
  /** An occurrence older than this at tick time was missed rather than merely due: the
   *  missed policy applies to it. Wide enough that a slow tick never counts as downtime. */
  graceMs?: number;
  /** Between due date scans. */
  dueScanMs?: number;
  log?: (message: string) => void;
  /** The engine, once wired: called after each tick's transaction commits, before the bus. */
  onEvents?: OnEvents;
}

/** run_all fires at most this many times for one trigger in one tick; the rest are dropped with a note. */
export const MAX_RUN_ALL = 100;
/** How many occurrences one trigger's gap is walked through before the walk stops. */
const ENUMERATE_CAP = 10_000;
const TICK_MS = 15_000;
const GRACE_MS = 60_000;
const DUE_SCAN_MS = 60_000;

/** The next occurrence of `cron` strictly after `from`, in `timezone`; null when there is none.
 *  Throws on a pattern or timezone croner rejects. */
export function nextRunAfter(cron: string, timezone: string, from: Date): Date | null {
  return new Cron(cron, { timezone }).nextRun(from);
}

/** The calendar day `at` falls on in this process's timezone, as YYYY-MM-DD. A due date is a
 *  day, and it has passed once that day has ended where the server runs. */
export function localDay(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

export interface ReconcileOptions {
  log?: (m: string) => void;
  /** Rule id to the `cron|timezone` last noted as rejected, so the note is written once per
   *  change rather than every tick. The scheduler keeps this across its ticks. */
  rejected?: Map<string, string>;
}

/**
 * Keeps triggers in step with rules: exactly one trigger for each rule whose event is a
 * schedule, carrying that schedule's cron, timezone and missed policy, and none for any other
 * rule. A new or changed schedule gets its first run computed from `now`; an edit never
 * creates missed runs, and a policy change alone leaves the next run where it was. The
 * trigger mirrors the rule's `enabled`: a paused rule keeps its trigger but not its place,
 * and resuming computes the next run from `now`, so the pause is not replayed as missed
 * runs. A schedule croner rejects gets no trigger and one note. The scheduler runs this
 * every tick, so a rule saved by a route is picked up within one interval; the rules routes
 * may call it directly after a save to make that immediate.
 */
export function reconcileTriggers(db: DB, now: Date, opts: ReconcileOptions = {}): void {
  const log = opts.log ?? (() => {});
  const rejected = opts.rejected ?? new Map<string, string>();
  const byRule = new Map<string, Trigger[]>();
  for (const t of listTriggers(db)) byRule.set(t.ruleId, [...(byRule.get(t.ruleId) ?? []), t]);
  for (const project of listProjects(db)) {
    for (const rule of listRules(db, project.id)) {
      const existing = byRule.get(rule.id) ?? [];
      if (rule.event.type !== "schedule") {
        for (const t of existing) deleteTrigger(db, t.id);
        rejected.delete(rule.id);
        continue;
      }
      const { cron, timezone } = rule.event;
      // A rule stored before the field existed, or written without parsing, reads as run_once.
      const missedPolicy = rule.event.missed ?? "run_once";
      let next: string | null;
      try {
        next = nextRunAfter(cron, timezone, now)?.toISOString() ?? null;
      } catch (e) {
        const key = `${cron}|${timezone}`;
        if (rejected.get(rule.id) !== key) {
          rejected.set(rule.id, key);
          log(`scheduler: rule ${rule.id} has a schedule croner rejects (${(e as Error).message}); it will not run`);
        }
        for (const t of existing) deleteTrigger(db, t.id);
        continue;
      }
      rejected.delete(rule.id);
      if (existing.length === 0) {
        createTrigger(db, { ruleId: rule.id, cron, timezone, nextRunAt: next, missedPolicy, enabled: rule.enabled });
        continue;
      }
      const [keep, ...extra] = existing;
      for (const t of extra) deleteTrigger(db, t.id);
      const patch: Parameters<typeof updateTrigger>[2] = {};
      if (keep.missedPolicy !== missedPolicy) patch.missedPolicy = missedPolicy;
      if (keep.cron !== cron || keep.timezone !== timezone) Object.assign(patch, { cron, timezone, nextRunAt: next });
      else if (keep.nextRunAt === null) patch.nextRunAt = next;
      if (keep.enabled !== rule.enabled) {
        patch.enabled = rule.enabled;
        if (rule.enabled) patch.nextRunAt = next;
      }
      if (Object.keys(patch).length > 0) updateTrigger(db, keep.id, patch);
    }
  }
}

export class Scheduler {
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly graceMs: number;
  private readonly dueScanMs: number;
  private readonly log: (m: string) => void;
  private readonly onEvents?: OnEvents;
  private timer: NodeJS.Timeout | null = null;
  /** True between the first tick with an open database and the first tick without one. */
  private armed = false;
  private lastDueScan: number | null = null;
  /** `${ticketId}:${dueDate}` for every due date already announced; seeded from the chain on arm. */
  private announced = new Set<string>();
  /** Schedules already noted as rejected, so the note is not repeated every tick. */
  private rejected = new Map<string, string>();

  constructor(private readonly ctx: Ctx, opts: SchedulerOptions = {}) {
    this.now = opts.now ?? ctx.now;
    this.intervalMs = opts.intervalMs ?? TICK_MS;
    this.graceMs = opts.graceMs ?? GRACE_MS;
    this.dueScanMs = opts.dueScanMs ?? DUE_SCAN_MS;
    this.log = opts.log ?? ((m) => console.warn(m));
    this.onEvents = opts.onEvents;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Safe to call at any time, locked included: returns the events it appended. */
  tick(): ChainEvent[] {
    const db = this.ctx.db;
    if (!db) {
      this.armed = false;
      return [];
    }
    const now = this.now();
    const out: ChainEvent[] = [];
    // The due date scan, and the due dates it announced, are remembered only once the pass
    // has committed: a rollback must leave them to be scanned and announced again next time.
    const announcedNow: string[] = [];
    let scanned = false;
    try {
      db.transaction(() => {
        if (!this.armed) this.arm(db);
        reconcileTriggers(db, now, { log: this.log, rejected: this.rejected });
        for (const t of dueTriggers(db, now.toISOString())) out.push(...this.fire(db, t, now));
        if (this.lastDueScan === null || now.getTime() - this.lastDueScan >= this.dueScanMs) {
          scanned = true;
          out.push(...this.scanDueDates(db, now, announcedNow));
        }
      })();
    } catch (e) {
      this.log(`scheduler: tick failed and rolled back: ${(e as Error).message}`);
      return [];
    }
    if (scanned) this.lastDueScan = now.getTime();
    for (const key of announcedNow) this.announced.add(key);
    publishEvents(this.ctx, db, out, this.onEvents, this.log);
    return out;
  }

  private arm(db: DB): void {
    this.announced = new Set(
      listEventsOfType(db, "ticket.due_passed").map((e) => {
        const p = e.payload as { ticketId?: string; dueDate?: string };
        return `${p.ticketId}:${p.dueDate}`;
      })
    );
    this.lastDueScan = null;
    this.rejected.clear();
    this.armed = true;
  }

  /**
   * Walks the occurrences from the trigger's next run up to now. Those older than the grace
   * window were missed and go by the missed policy: `skip` drops them, `run_once` folds them
   * into one fire, `run_all` fires each one (capped). An occurrence inside the window is simply
   * due and fires under every policy, `skip` included.
   */
  private fire(db: DB, t: Trigger, now: Date): ChainEvent[] {
    const cron = new Cron(t.cron, { timezone: t.timezone });
    const occurrences: Date[] = [];
    let cursor: Date | null = new Date(t.nextRunAt!);
    while (cursor && cursor.getTime() <= now.getTime() && occurrences.length < ENUMERATE_CAP) {
      occurrences.push(cursor);
      cursor = cron.nextRun(cursor);
    }
    if (occurrences.length === ENUMERATE_CAP) this.log(`scheduler: trigger ${t.id} had more than ${ENUMERATE_CAP} occurrences since ${t.nextRunAt}; the walk stopped there`);
    const isMissed = (d: Date) => now.getTime() - d.getTime() > this.graceMs;
    const missed = occurrences.filter(isMissed);
    const last = occurrences[occurrences.length - 1];

    let fires: { at: Date; missed: number }[];
    switch (t.missedPolicy) {
      case "skip":
        fires = last && !isMissed(last) ? [{ at: last, missed: 0 }] : [];
        break;
      case "run_once":
        fires = last ? [{ at: last, missed: missed.length }] : [];
        break;
      case "run_all": {
        // The newest occurrences are the ones still worth acting on, and the one due now is
        // always among them.
        const kept = occurrences.slice(-MAX_RUN_ALL);
        if (occurrences.length > MAX_RUN_ALL) this.log(`scheduler: trigger ${t.id} had ${occurrences.length} occurrences to run; fired the newest ${MAX_RUN_ALL} and dropped the older ${occurrences.length - MAX_RUN_ALL}`);
        fires = kept.map((at) => ({ at, missed: isMissed(at) ? 1 : 0 }));
        break;
      }
    }

    const nextRunAt = cron.nextRun(now)?.toISOString() ?? null;
    if (fires.length === 0) {
      updateTrigger(db, t.id, { nextRunAt });
      return [];
    }
    const iso = now.toISOString();
    const projectId = getRule(db, t.ruleId)?.projectId ?? null;
    const events = fires.map((f) =>
      appendSystemEvent(db, "trigger.fired", { ruleId: t.ruleId, triggerId: t.id, projectId, scheduledFor: f.at.toISOString(), missed: f.missed }, iso)
    );
    markTriggerRun(db, t.id, { lastRunAt: iso, nextRunAt });
    return events;
  }

  /** A due date is a calendar day; it has passed once that day has ended in this process's
   *  timezone, so the scan takes tickets due strictly before today (docs/webhooks.md). */
  private scanDueDates(db: DB, now: Date, announcedNow: string[]): ChainEvent[] {
    const events: ChainEvent[] = [];
    const iso = now.toISOString();
    for (const t of listTicketsDueBefore(db, localDay(now))) {
      const key = `${t.id}:${t.dueDate}`;
      if (this.announced.has(key) || announcedNow.includes(key)) continue;
      events.push(appendSystemEvent(db, "ticket.due_passed", { ticketId: t.id, projectId: t.projectId, dueDate: t.dueDate }, iso));
      announcedNow.push(key);
    }
    return events;
  }
}
