import type { Family } from "@panorama/core";

export function Chip({ family, children, onClick }: { family: Family; children: React.ReactNode; onClick?: () => void }) {
  const style = { background: `var(--${family}-top)`, color: `var(--${family}-ink)` };
  return onClick ? (
    <button type="button" className="chip" style={style} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>
  ) : (
    <span className="chip" style={style}>{children}</span>
  );
}
