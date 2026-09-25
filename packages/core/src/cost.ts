import { z } from "zod";
import bundled from "./prices.json";

/** USD per million tokens. Cache prices are optional: models.dev omits them for models with no
 *  cache, and the estimate then charges cache tokens at the input rate. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** The bundled snapshot of models.dev (`prices.json`, refreshed by `pnpm prices:update`). It is
 *  the only price source; nothing here or anywhere else in Boomerang fetches prices at runtime. */
export interface PriceTable {
  source: string;
  date: string;
  models: Record<string, ModelPrice>;
}

export const BUNDLED_PRICES: PriceTable = bundled;

/** What an agent reports after a turn. Tokens are whole and non-negative; the model is whatever
 *  the agent calls it, matched loosely against the table (see `findPrice`). */
export const CostInput = z
  .object({
    model: z.string().min(1).max(120),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CostInput = z.infer<typeof CostInput>;

/** An estimate, never a bill: `usd` is null when the model is not in the table, and `priceDate`
 *  says how old the prices behind the figure are. Always render through `formatEstimate`. */
export interface CostEstimate {
  usd: number | null;
  priceDate: string;
  matched: string | null;
}

/**
 * Finds the table key for a model name: exact first, then case-insensitive, then the id without
 * its provider prefix (so `claude-fable-5-1` finds `anthropic/claude-fable-5-1`). Surrounding
 * whitespace is ignored. Ties on a bare id go to the first key in sorted order.
 */
export function findPrice(reported: string, table: PriceTable = BUNDLED_PRICES): string | null {
  const model = reported.trim();
  if (Object.hasOwn(table.models, model)) return model;
  const keys = Object.keys(table.models);
  const lower = model.toLowerCase();
  const insensitive = keys.find((k) => k.toLowerCase() === lower);
  if (insensitive) return insensitive;
  const bare = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
  const byId = keys.find((k) => k.slice(k.indexOf("/") + 1).toLowerCase() === bare);
  return byId ?? null;
}

export function estimateCost(input: CostInput, table: PriceTable = BUNDLED_PRICES): CostEstimate {
  const matched = findPrice(input.model, table);
  if (matched === null) return { usd: null, priceDate: table.date, matched: null };
  const p = table.models[matched];
  const perMillion =
    input.inputTokens * p.input +
    input.outputTokens * p.output +
    (input.cacheReadTokens ?? 0) * (p.cacheRead ?? p.input) +
    (input.cacheWriteTokens ?? 0) * (p.cacheWrite ?? p.input);
  return { usd: perMillion / 1_000_000, priceDate: table.date, matched };
}

/** Two significant figures, never finer than a cent. */
export function roundEstimate(usd: number): number {
  if (usd <= 0) return 0;
  const step = 10 ** (Math.floor(Math.log10(usd)) - 1);
  const rounded = Math.round(usd / step) * step;
  return Math.round(rounded * 100) / 100;
}

const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Renders an estimate the way the owner asked: `~$9.40`, `~$940`, `~$12,000`, `<~$0.01` under a
 * cent, `~$0` for nothing spent, and `no price` when the model is unknown. The tilde is not
 * optional: a cost figure never appears without it.
 */
export function formatEstimate(usd: number | null): string {
  if (usd === null) return "no price";
  if (usd === 0) return "~$0";
  const r = roundEstimate(usd);
  if (r < 0.01) return "<~$0.01";
  if (r < 100) return `~$${r.toFixed(2)}`;
  return `~$${group(Math.round(r))}`;
}

export interface EstimateSum {
  usd: number | null;
  known: number;
  priceDate: string;
}

/**
 * Adds estimates. `usd` is null as soon as one input is null (a total that leaves out a model is
 * not a total), while `known` keeps the subtotal of the priced ones so the UI can still say
 * "at least ~$x". The price date is the oldest among the inputs, since the total is at least
 * that stale; an empty list reports the bundled date.
 */
export function sumEstimates(list: readonly Pick<CostEstimate, "usd" | "priceDate">[], table: PriceTable = BUNDLED_PRICES): EstimateSum {
  let known = 0;
  let complete = true;
  let priceDate: string | null = null;
  for (const e of list) {
    if (e.usd === null) complete = false;
    else known += e.usd;
    if (priceDate === null || e.priceDate < priceDate) priceDate = e.priceDate;
  }
  return { usd: complete ? known : null, known, priceDate: priceDate ?? table.date };
}
