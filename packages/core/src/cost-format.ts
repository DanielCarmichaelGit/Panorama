// Rendering and summing of cost estimates. This module must never import the price table
// (`prices.json`) or `cost.ts`: the web bundle uses it to show figures the server already
// estimated, and the 149 KB table has no business in the browser. A test reads this file and
// checks its imports.

/** An estimate as stored or returned by the server: `usd` null when the model was unknown,
 *  `priceDate` the date of the table that produced it. */
export interface PricedFigure {
  usd: number | null;
  priceDate: string;
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
  priceDate: string | null;
}

/**
 * Adds estimates. `usd` is null as soon as one input is null (a total that leaves out a model is
 * not a total), while `known` keeps the subtotal of the priced ones so the UI can still say
 * "at least ~$x". The price date is the oldest among the inputs, since the total is at least
 * that stale; an empty list has nothing behind it and reports null.
 */
export function sumEstimates(list: readonly PricedFigure[]): EstimateSum {
  let known = 0;
  let complete = true;
  let priceDate: string | null = null;
  for (const e of list) {
    if (e.usd === null) complete = false;
    else known += e.usd;
    if (priceDate === null || e.priceDate < priceDate) priceDate = e.priceDate;
  }
  return { usd: complete ? known : null, known, priceDate };
}
