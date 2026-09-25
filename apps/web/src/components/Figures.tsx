import type { Figures } from "../lib/hooks";
import { costText, estimateTitle, formatDuration, formatTokens } from "../lib/metrics";

/**
 * The three figures every metrics surface shows, in mono: time on timers as hours and minutes,
 * tokens of every kind, and the cost as an estimate. The cost carries the price date and the
 * words "this could be lower" on hover, and says "at least" when an unpriced model is in the
 * mix, so no dollar figure ever appears bare. Each number sits in its own element so a test
 * (or a screen reader) reads it whole.
 */
export function FigureSpans({ figures, priceDate }: { figures: Figures; priceDate: string }) {
  return (
    <>
      <span className="figure" title="Time on timers">
        <span className="mono">{formatDuration(figures.seconds)}</span>
      </span>
      <span className="figure">
        <span className="mono">{formatTokens(figures.tokens.total)}</span>
        <span className="muted">tokens</span>
      </span>
      <span className="figure">
        <span className="mono" title={estimateTitle(priceDate)}>{costText(figures)}</span>
      </span>
    </>
  );
}
