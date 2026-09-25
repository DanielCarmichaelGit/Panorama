import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { formatEstimate } from "@boomerang/core";

// Rendering of the figures the server already measured and priced. Every dollar figure the app
// shows passes through `costText`, so the tilde and the "at least" wording are decided in one
// place; the price date rides beside it as a hover title through `estimateTitle`. Nothing here
// touches the price table: `formatEstimate` comes from core's cost-format module, which never
// imports it, so the browser bundle stays free of it (checked after every web build).

export type MetricsPeriod = "week" | "month" | "all";
export type MetricsGroupBy = "agent" | "epic" | "board" | "project";

export const PERIODS: { id: MetricsPeriod; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
];

/** The period a `?period=` value names, the week when it names none. */
export function periodFrom(raw: string | null): MetricsPeriod {
  return PERIODS.some((p) => p.id === raw) ? (raw as MetricsPeriod) : "week";
}

export const periodLabel = (period: MetricsPeriod): string => PERIODS.find((p) => p.id === period)?.label ?? "This week";

/**
 * The period every metrics surface shares, kept in the URL as `?period=` so a link carries it and
 * the Queue, the Board and the Agents view agree. The week is the default and leaves the URL clean.
 */
export function usePeriod(): [MetricsPeriod, (next: MetricsPeriod) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = periodFrom(searchParams.get("period"));
  const setPeriod = useCallback(
    (next: MetricsPeriod) => {
      const params = new URLSearchParams(searchParams);
      if (next === "week") params.delete("period");
      else params.set("period", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  return [period, setPeriod];
}

/** Whole hours and minutes: `2h 5m`, `12m`, `<1m` for a few seconds, `0m` for none. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s > 0 && s < 60) return "<1m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Token counts: whole under a thousand, then thousands or millions to one decimal. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** What a cost figure needs to render: the total, the priced subtotal, and how many entries had no price. */
export interface CostFigure {
  usd: number | null;
  known: number;
  unpriced: number;
}

/**
 * The cost as the owner asked to see it: `~$9.40` when every entry was priced, `at least ~$1.50`
 * when an unpriced model sits beside priced ones, and `no price` when nothing could be priced.
 */
export function costText(f: CostFigure): string {
  if (f.unpriced > 0) return f.known > 0 ? `at least ${formatEstimate(f.known)}` : "no price";
  return formatEstimate(f.usd ?? 0);
}

/** The hover title on every cost figure: where the prices came from, when, and that the figure could be lower. */
export function estimateTitle(priceDate: string): string {
  return `Estimate from models.dev prices dated ${priceDate}; this could be lower`;
}

/** True when there is anything to show: time on the clock, a timer running, or a cost entry. */
export function hasFigures(f: { seconds: number; openTimers: number; entries: number }): boolean {
  return f.seconds > 0 || f.openTimers > 0 || f.entries > 0;
}
