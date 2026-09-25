import { randomUUID } from "node:crypto";
import type { DB } from "./open";

// Timers and cost entries with their rollups (milestone 3, task 3; migration M9). The server
// measures time and prices tokens; this module only stores and sums. Every cost figure here is
// the estimate made at write time, so a rollup is as much an estimate as its entries.

/** A half-open window on a row's own timestamp: `from` inclusive, `to` exclusive, ISO strings. */
export interface Period { from: string; to: string }
const inPeriod = (col: string, period: Period | undefined, args: unknown[]): string => {
  if (!period) return "";
  args.push(period.from, period.to);
  return ` and ${col} >= ? and ${col} < ?`;
};

export interface Timer { id: string; ticketId: string; actorId: string; startedAt: string; stoppedAt: string | null }
const toTimer = (r: any): Timer => ({ id: r.id, ticketId: r.ticket_id, actorId: r.actor_id, startedAt: r.started_at, stoppedAt: r.stopped_at });

/** Opens a timer, or throws "timer_open" when this actor already has one open on this ticket
 *  (the partial unique index `timers_open` holds that rule at the schema level too). */
export function startTimer(db: DB, input: { ticketId: string; actorId: string }, now: string): Timer {
  const id = randomUUID();
  try {
    db.prepare("insert into timers(id, ticket_id, actor_id, started_at, stopped_at) values(?,?,?,?,null)").run(id, input.ticketId, input.actorId, now);
  } catch (e) {
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("timer_open");
    throw e;
  }
  return getTimer(db, id)!;
}
/** Stops the actor's open timer on the ticket, or throws "no_open_timer". */
export function stopTimer(db: DB, input: { ticketId: string; actorId: string }, now: string): Timer {
  const open = db.prepare("select id from timers where ticket_id = ? and actor_id = ? and stopped_at is null").get(input.ticketId, input.actorId) as { id: string } | undefined;
  if (!open) throw new Error("no_open_timer");
  db.prepare("update timers set stopped_at = ? where id = ?").run(now, open.id);
  return getTimer(db, open.id)!;
}
export const getTimer = (db: DB, id: string): Timer | undefined => { const r = db.prepare("select * from timers where id = ?").get(id); return r ? toTimer(r) : undefined; };
export const listTimers = (db: DB, ticketId: string): Timer[] => db.prepare("select * from timers where ticket_id = ? order by started_at, id").all(ticketId).map(toTimer);
export const listOpenTimers = (db: DB, actorId: string): Timer[] => db.prepare("select * from timers where actor_id = ? and stopped_at is null order by started_at, id").all(actorId).map(toTimer);

/** Elapsed milliseconds across timers, an open timer counting up to `now`, plus how many are open. */
export interface TimerTotals { ms: number; open: number }
function sumTimers(rows: Timer[], now: string): TimerTotals {
  const end = Date.parse(now);
  let ms = 0; let open = 0;
  for (const t of rows) {
    if (t.stoppedAt === null) open++;
    ms += Math.max(0, (t.stoppedAt === null ? end : Date.parse(t.stoppedAt)) - Date.parse(t.startedAt));
  }
  return { ms, open };
}
export const timerTotalsByTicket = (db: DB, ticketId: string, now: string): TimerTotals => sumTimers(listTimers(db, ticketId), now);
/** Timers started inside the period on the project's tickets (a timer belongs to the period it
 *  began in, so a long session is never split or counted twice). */
export function timerTotalsByProject(db: DB, projectId: string, period: Period, now: string): TimerTotals {
  const args: unknown[] = [projectId];
  const clause = inPeriod("tm.started_at", period, args);
  return sumTimers(db.prepare(`select tm.* from timers tm join tickets t on t.id = tm.ticket_id where t.project_id = ?${clause}`).all(...args).map(toTimer), now);
}

/** The project's timers with the epic and board of their ticket, so a rollup can group time the
 *  way it groups cost. Like `timerTotalsByProject`, a timer belongs to the period it began in. */
export function listProjectTimers(db: DB, projectId: string, period?: Period): (Timer & { epicId: string | null; boardId: string | null })[] {
  const args: unknown[] = [projectId];
  const clause = inPeriod("tm.started_at", period, args);
  return (db.prepare(`select tm.*, t.epic_id, t.board_id from timers tm join tickets t on t.id = tm.ticket_id where t.project_id = ?${clause} order by tm.started_at, tm.id`).all(...args) as any[])
    .map((r) => ({ ...toTimer(r), epicId: r.epic_id ?? null, boardId: r.board_id ?? null }));
}

/** What an agent reported for a turn plus the estimate made from the bundled table at write
 *  time: `usd` null when the model was unknown, `priceDate` the table's date. Satisfies
 *  `PricedFigure` from @boomerang/core, so `sumEstimates` and `formatEstimate` take it as is. */
export interface CostEntry {
  id: string; ticketId: string; actorId: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
  usd: number | null; priceDate: string; note: string | null; createdAt: string;
}
const toCost = (r: any): CostEntry => ({
  id: r.id, ticketId: r.ticket_id, actorId: r.actor_id, model: r.model, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
  cacheReadTokens: r.cache_read_tokens, cacheWriteTokens: r.cache_write_tokens, usd: r.usd_estimate, priceDate: r.price_date, note: r.note, createdAt: r.created_at,
});

export function addCostEntry(
  db: DB,
  input: { ticketId: string; actorId: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; usd: number | null; priceDate: string; note?: string | null },
  now: string
): CostEntry {
  const id = randomUUID();
  db.prepare("insert into cost_entries(id, ticket_id, actor_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd_estimate, price_date, note, created_at) values(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, input.ticketId, input.actorId, input.model, input.inputTokens, input.outputTokens, input.cacheReadTokens ?? 0, input.cacheWriteTokens ?? 0, input.usd, input.priceDate, input.note ?? null, now);
  return toCost(db.prepare("select * from cost_entries where id = ?").get(id));
}
export const listCostEntries = (db: DB, ticketId: string): CostEntry[] => db.prepare("select * from cost_entries where ticket_id = ? order by created_at, id").all(ticketId).map(toCost);

/**
 * A sum over cost entries. `usd` is null as soon as one entry is unpriced (a total that leaves
 * a model out is not a total), `knownUsd` is the subtotal of the priced ones so the UI can say
 * "at least", and `priceDate` is the oldest table date behind any entry, since the total is at
 * least that stale. The same rule `sumEstimates` in @boomerang/core applies to a list.
 */
export interface CostRollup {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  usd: number | null; knownUsd: number; entries: number; unpriced: number; priceDate: string | null;
}
const ROLLUP = `count(*) as entries, coalesce(sum(c.input_tokens), 0) as input, coalesce(sum(c.output_tokens), 0) as output,
  coalesce(sum(c.cache_read_tokens), 0) as cache_read, coalesce(sum(c.cache_write_tokens), 0) as cache_write,
  coalesce(sum(c.usd_estimate), 0) as known, coalesce(sum(case when c.usd_estimate is null then 1 else 0 end), 0) as unpriced, min(c.price_date) as price_date`;
const toRollup = (r: any): CostRollup => ({
  tokens: { input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite: r.cache_write, total: r.input + r.output + r.cache_read + r.cache_write },
  usd: r.unpriced > 0 ? null : r.known, knownUsd: r.known, entries: r.entries, unpriced: r.unpriced, priceDate: r.price_date,
});
const FROM = "from cost_entries c join tickets t on t.id = c.ticket_id";
function rollup(db: DB, where: string, id: string, period?: Period): CostRollup {
  const args: unknown[] = [id];
  return toRollup(db.prepare(`select ${ROLLUP} ${FROM} where ${where} = ?${inPeriod("c.created_at", period, args)}`).get(...args));
}
export const costByTicket = (db: DB, ticketId: string, period?: Period): CostRollup => rollup(db, "c.ticket_id", ticketId, period);
export const costByEpic = (db: DB, epicId: string, period?: Period): CostRollup => rollup(db, "t.epic_id", epicId, period);
export const costByBoard = (db: DB, boardId: string, period?: Period): CostRollup => rollup(db, "t.board_id", boardId, period);
export const costByProject = (db: DB, projectId: string, period?: Period): CostRollup => rollup(db, "t.project_id", projectId, period);
/** One rollup per actor that reported cost on the project's tickets, in actor id order. */
export function costByAgent(db: DB, projectId: string, period?: Period): (CostRollup & { actorId: string })[] {
  const args: unknown[] = [projectId];
  const clause = inPeriod("c.created_at", period, args);
  return (db.prepare(`select c.actor_id, ${ROLLUP} ${FROM} where t.project_id = ?${clause} group by c.actor_id order by c.actor_id`).all(...args) as any[])
    .map((r) => ({ actorId: r.actor_id, ...toRollup(r) }));
}
