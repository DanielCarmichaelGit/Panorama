import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BUNDLED_PRICES, CostInput, estimateCost, sumEstimates } from "@boomerang/core";
import { addCostEntry, costByAgent, costByBoard, costByEpic, costByProject, getActor, getProject, listBoards, listCostEntries, listEpics, listProjectTimers, listTimers, type CostEntry, type CostRollup, type Period, type Timer } from "@boomerang/db";
import { getDb, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";
import { secondsOf, startTimerAs, stopOwnTimerAs } from "../services/timers";
import { actingAs, loadTicket, makeLog } from "./common";

// Timers and cost (milestone 3, task 6). The server measures time: a timer is opened and closed
// in services/timers.ts (which the rule engine runs through too) and its duration is never
// taken from the caller. Cost is priced once, at write time, from the bundled table, and every
// figure that leaves this file is an estimate: `usd` is a number (or null when a model was
// unknown) with `estimate: true` beside it, and the web renders it through `formatEstimate`,
// which puts the tilde on. Nothing here fetches a price.

const ROLLUP_PERIODS = ["week", "month", "all"] as const;
const GROUPINGS = ["agent", "epic", "board", "project"] as const;
const MetricsQuery = z.object({ projectId: z.string().min(1), period: z.enum(ROLLUP_PERIODS).default("week"), groupBy: z.enum(GROUPINGS).default("project") });
const CostBody = CostInput.extend({ note: z.string().max(2000).optional() }).strict();

/** The same figures on a ticket, an actor, an epic, a board, and a project. `usd` is null as soon
 *  as one entry is unpriced; `known` is the subtotal of the priced ones, so the UI can still say
 *  "at least". Time is whole seconds, an open timer counting up to now. */
export interface Figures {
  seconds: number;
  openTimers: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  usd: number | null;
  known: number;
  unpriced: number;
  entries: number;
}

const timeOf = (timers: Timer[], nowMs: number) => ({
  seconds: timers.reduce((s, t) => s + secondsOf(t, nowMs), 0),
  openTimers: timers.filter((t) => t.stoppedAt === null).length,
});
const noTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const costOf = (entries: CostEntry[]) => {
  const tokens = noTokens();
  for (const e of entries) {
    tokens.input += e.inputTokens; tokens.output += e.outputTokens; tokens.cacheRead += e.cacheReadTokens; tokens.cacheWrite += e.cacheWriteTokens;
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  const sum = sumEstimates(entries);
  return { tokens, usd: sum.usd, known: sum.known, unpriced: entries.filter((e) => e.usd === null).length, entries: entries.length, priceDate: sum.priceDate };
};
const fromRollup = (r: CostRollup) => ({ tokens: r.tokens, usd: r.usd, known: r.knownUsd, unpriced: r.unpriced, entries: r.entries });
const figures = (timers: Timer[], cost: ReturnType<typeof fromRollup>, nowMs: number): Figures => ({ ...timeOf(timers, nowMs), ...cost });

/** Calendar periods in UTC: the week runs Monday to Monday, the month first to first. */
export function periodFor(kind: (typeof ROLLUP_PERIODS)[number], now: Date): Period | undefined {
  if (kind === "all") return undefined;
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  if (kind === "month") return { from: new Date(Date.UTC(y, m, 1)).toISOString(), to: new Date(Date.UTC(y, m + 1, 1)).toISOString() };
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const start = Date.UTC(y, m, now.getUTCDate() - sinceMonday);
  return { from: new Date(start).toISOString(), to: new Date(start + 7 * 86_400_000).toISOString() };
}

const groupBy = <T, K extends string>(items: T[], key: (t: T) => K | null): Map<K, T[]> => {
  const out = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === null) continue;
    (out.get(k) ?? out.set(k, []).get(k)!).push(it);
  }
  return out;
};

export function metricsRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const log = makeLog(ctx);

  app.post("/api/v1/tickets/:id/timer/start", async (req: any) => {
    const db = getDb(ctx); const t = loadTicket(db, req.params.id); requireCan(req, "timer.use", t.projectId);
    return startTimerAs(actingAs(ctx, db, req), t);
  });

  app.post("/api/v1/tickets/:id/timer/stop", async (req: any) => {
    const db = getDb(ctx); const t = loadTicket(db, req.params.id); requireCan(req, "timer.use", t.projectId);
    return stopOwnTimerAs(actingAs(ctx, db, req), t);
  });

  app.post("/api/v1/tickets/:id/cost", async (req: any) => {
    const db = getDb(ctx); const t = loadTicket(db, req.params.id); requireCan(req, "cost.report", t.projectId);
    const { note, ...input } = CostBody.parse(req.body);
    const estimate = estimateCost(input);
    return db.transaction(() => {
      const entry = addCostEntry(db, { ticketId: t.id, actorId: req.actor.id, ...input, usd: estimate.usd, priceDate: estimate.priceDate, note: note ?? null }, iso());
      const tokens = entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheWriteTokens;
      log(db, req, "cost.added", { ticketId: t.id, actorId: req.actor.id, projectId: t.projectId, model: entry.model, tokens, usdEstimate: entry.usd, priceDate: entry.priceDate });
      return { ...entry, estimate: true };
    })();
  });

  app.get("/api/v1/tickets/:id/metrics", async (req: any) => {
    const db = getDb(ctx); const t = loadTicket(db, req.params.id); requireCan(req, "read", t.projectId);
    const nowMs = ctx.now().getTime();
    const timers = listTimers(db, t.id); const entries = listCostEntries(db, t.id);
    const { priceDate, ...total } = costOf(entries);
    // Dearest first, so the panel's breakdown reads top down: by the estimate, a group with no
    // estimate (an unpriced model among its entries) after every priced one, then by tokens,
    // then by name so equal figures keep a stable order.
    const bySpend = (a: { usd: number | null; tokens: { total: number } }, b: { usd: number | null; tokens: { total: number } }): number => {
      if (a.usd === null || b.usd === null) return a.usd === b.usd ? b.tokens.total - a.tokens.total : a.usd === null ? 1 : -1;
      return b.usd - a.usd || b.tokens.total - a.tokens.total;
    };
    const byModel = [...groupBy(entries, (e) => e.model)]
      .map(([model, list]) => { const { priceDate: _p, ...c } = costOf(list); return { model, ...c }; })
      .sort((a, b) => bySpend(a, b) || a.model.localeCompare(b.model));
    const actorIds = [...new Set([...timers.map((x) => x.actorId), ...entries.map((e) => e.actorId)])];
    const byActor = actorIds
      .map((actorId) => {
        const { priceDate: _p, ...c } = costOf(entries.filter((e) => e.actorId === actorId));
        return { actorId, name: getActor(db, actorId)?.name ?? actorId, ...figures(timers.filter((x) => x.actorId === actorId), c, nowMs) };
      })
      .sort((a, b) => bySpend(a, b) || b.seconds - a.seconds || a.actorId.localeCompare(b.actorId));
    return { ticketId: t.id, estimate: true, priceDate: priceDate ?? BUNDLED_PRICES.date, ...figures(timers, total, nowMs), byModel, byActor };
  });

  app.get("/api/v1/metrics", async (req: any) => {
    const q = MetricsQuery.parse(req.query);
    const db = getDb(ctx);
    const project = getProject(db, q.projectId);
    if (!project) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "read", project.id);
    const now = ctx.now(); const nowMs = now.getTime();
    const period = periodFor(q.period, now);
    const timers = listProjectTimers(db, project.id, period);
    const totalCost = costByProject(db, project.id, period);
    const total = figures(timers, fromRollup(totalCost), nowMs);

    type Group = { id: string; name: string } & Figures;
    let groups: Group[];
    if (q.groupBy === "project") {
      groups = [{ id: project.id, name: project.name, ...total }];
    } else if (q.groupBy === "agent") {
      const cost = new Map(costByAgent(db, project.id, period).map((r) => [r.actorId, r]));
      const time = groupBy(timers, (t) => t.actorId);
      const ids = [...new Set([...cost.keys(), ...time.keys()])].sort();
      groups = ids.map((id) => ({ id, name: getActor(db, id)?.name ?? id, ...figures(time.get(id) ?? [], fromRollup(cost.get(id) ?? emptyRollup()), nowMs) }));
    } else if (q.groupBy === "epic") {
      const time = groupBy(timers, (t) => t.epicId);
      groups = listEpics(db, project.id, { includeArchived: true })
        .map((e) => ({ id: e.id, name: e.name, archived: e.archived, ...figures(time.get(e.id) ?? [], fromRollup(costByEpic(db, e.id, period)), nowMs) }))
        .filter((g) => !g.archived || g.entries > 0 || g.seconds > 0 || g.openTimers > 0)
        .map(({ archived: _a, ...g }) => g);
    } else {
      const time = groupBy(timers, (t) => t.boardId);
      groups = listBoards(db, project.id).map((b) => ({ id: b.id, name: b.name, ...figures(time.get(b.id) ?? [], fromRollup(costByBoard(db, b.id, period)), nowMs) }));
    }
    return {
      projectId: project.id,
      estimate: true,
      priceDate: totalCost.priceDate ?? BUNDLED_PRICES.date,
      period: { kind: q.period, from: period?.from ?? null, to: period?.to ?? null },
      groupBy: q.groupBy,
      total,
      groups,
    };
  });
}

const emptyRollup = (): CostRollup => ({ tokens: noTokens(), usd: 0, knownUsd: 0, entries: 0, unpriced: 0, priceDate: null });
