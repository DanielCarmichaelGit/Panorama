import type { Family } from "@panorama/core";

// Chips are labels here. Clicking one to filter a view arrives with the Board.
export function Chip({ family, children }: { family: Family; children: React.ReactNode }) {
  return <span className="chip" style={{ background: `var(--${family}-top)`, color: `var(--${family}-ink)` }}>{children}</span>;
}
