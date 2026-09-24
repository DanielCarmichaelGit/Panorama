import type { Family } from "@panorama/core";
import { FAMILY } from "./families";
const C = Math.cos(Math.PI / 6), S = 0.5;
const r = (n: number) => Math.round(n * 100) / 100 + 0;
export const isoPoint = (x: number, y: number, z: number, unit = 22): [number, number] => [r((x - y) * C * unit), r((x + y) * S * unit - z * unit)];
const pts = (p: [number, number][]) => p.map((q) => q.join(",")).join(" ");
export function isoBoxFaces(x: number, y: number, z: number, w: number, d: number, h: number, unit = 22) {
  const P = (a: number, b: number, c: number) => isoPoint(a, b, c, unit);
  return {
    left: pts([P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)]),
    right: pts([P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)]),
    top: pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)]),
  };
}
export function IsoBox(p: { x: number; y: number; z: number; w: number; d: number; h: number; family: Family; className?: string; style?: React.CSSProperties }) {
  const f = isoBoxFaces(p.x, p.y, p.z, p.w, p.d, p.h), c = FAMILY[p.family];
  return <g className={p.className} style={p.style}><polygon points={f.left} fill={c.left} /><polygon points={f.right} fill={c.right} /><polygon points={f.top} fill={c.top} /></g>;
}
const LANES: [number, [Family, number][]][] = [[0, [["sky", 1], ["sky", 1]]], [5, [["lilac", 1], ["coral", 1.4]]], [10, [["mint", 1], ["mint", 1], ["mint", 1]]]];
export function LaneScene({ settle = false }: { settle?: boolean }) {
  let i = 0;
  return (
    <svg viewBox="-140 -22 415 262" className="iso-scene" role="img" aria-label="Lanes drawn as platforms with tickets as blocks">
      {LANES.map(([x, blocks]) => (
        <g key={x}>
          <IsoBox x={x} y={0} z={0} w={4} d={7} h={0.4} family="stone" />
          {blocks.map(([family, h], j) => <IsoBox key={j} x={x + 0.7} y={0.8 + j * 2} z={0.4} w={2.6} d={1.6} h={h} family={family} className={settle ? "iso-settle" : undefined} style={settle ? { animationDelay: `${i++ * 40}ms` } : undefined} />)}
        </g>
      ))}
    </svg>
  );
}
