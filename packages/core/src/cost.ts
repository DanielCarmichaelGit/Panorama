import { z } from "zod";
import bundled from "./prices.json";
import type { PricedFigure } from "./cost-format";

// Estimating a cost from tokens needs the price table, so this module is for the server only.
// Rendering and summing live in `cost-format.ts`, which the browser can import without the table.

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

/** When an agent reports a bare model id (`claude-sonnet-5`, no provider) that several providers
 *  list, the first-party vendor wins over the gateways reselling it, in this order; providers not
 *  listed here fall back to alphabetical order. `scripts/prices-update.mjs` states the same rule. */
export const PROVIDER_PRIORITY = ["anthropic", "openai", "google", "xai", "mistral", "deepseek", "meta"] as const;

/** The most tokens one field of one report may carry: fifty million, far above any single turn
 *  a model can take today, so a typo or a misplaced total cannot put a nonsense figure on a
 *  ticket. A report is per turn; a day's worth arrives as many reports. */
export const MAX_TOKENS_PER_FIELD = 50_000_000;
const tokens = z.number().int().nonnegative().max(MAX_TOKENS_PER_FIELD);

/** What an agent reports after a turn. Tokens are whole, non-negative and capped per field; the
 *  model is whatever the agent calls it, matched loosely against the table (see `findPrice`).
 *  The route and the MCP tool both validate with this schema. */
export const CostInput = z
  .object({
    model: z.string().min(1).max(120),
    inputTokens: tokens,
    outputTokens: tokens,
    cacheReadTokens: tokens.optional(),
    cacheWriteTokens: tokens.optional(),
  })
  .strict();
export type CostInput = z.infer<typeof CostInput>;

/** An estimate, never a bill: `usd` is null when the model is not in the table, and `priceDate`
 *  says how old the prices behind the figure are. Always render through `formatEstimate`. */
export interface CostEstimate extends PricedFigure {
  matched: string | null;
}

const providerRank = (key: string): number => {
  const rank = (PROVIDER_PRIORITY as readonly string[]).indexOf(key.slice(0, key.indexOf("/")));
  return rank === -1 ? PROVIDER_PRIORITY.length : rank;
};

/**
 * Finds the table key for a model name: exact first, then case-insensitive, then the id without
 * its provider prefix (so `claude-fable-5-1` finds `anthropic/claude-fable-5-1`). Surrounding
 * whitespace is ignored. When several providers list the same bare id, `PROVIDER_PRIORITY`
 * decides (anthropic, openai, google, xai, mistral, deepseek, meta), then alphabetical order.
 */
export function findPrice(reported: string, table: PriceTable = BUNDLED_PRICES): string | null {
  const model = reported.trim();
  if (Object.hasOwn(table.models, model)) return model;
  const keys = Object.keys(table.models);
  const lower = model.toLowerCase();
  const insensitive = keys.find((k) => k.toLowerCase() === lower);
  if (insensitive) return insensitive;
  const bare = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
  const candidates = keys.filter((k) => k.slice(k.indexOf("/") + 1).toLowerCase() === bare);
  candidates.sort((a, b) => providerRank(a) - providerRank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return candidates[0] ?? null;
}

/**
 * Prices a turn from the table. When the table has no cache price for the model, cache tokens are
 * charged at the input rate: that overestimates cache reads (normally a tenth of input) and
 * underestimates cache writes (normally a quarter above input). The figure is an estimate either
 * way, and the words next to it say so.
 */
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
