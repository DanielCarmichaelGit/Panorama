import { useMemo } from "react";
import type { Family } from "@boomerang/core";
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
/** A single isometric block used as an agent's avatar, sized in pixels by `size`. */
export function AgentMark({ family, size = 32 }: { family: Family; size?: number }) {
  const f = isoBoxFaces(0, 0, 0, 2, 2, 1.6), c = FAMILY[family];
  return (
    <svg viewBox="-42 -40 84 88" width={size} height={size} className="agent-mark" aria-hidden="true">
      <polygon points={f.left} fill={c.left} />
      <polygon points={f.right} fill={c.right} />
      <polygon points={f.top} fill={c.top} />
    </svg>
  );
}

// Plan geometry: points in the isometric ground plane, projected through isoPoint so that the
// faces of any solid built here share their edges exactly with the blocks above.
type P2 = [number, number];
const add = (a: P2, b: P2, k = 1): P2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const dir = (deg: number): P2 => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const perpAway = (u: P2, from: P2): P2 => { const p: P2 = [-u[1], u[0]]; return dot(p, from) > 0 ? [-p[0], -p[1]] : p; };
/** Where the line p + t*u meets the line q + s*v. */
function meet(p: P2, u: P2, q: P2, v: P2): P2 {
  const den = u[0] * v[1] - u[1] * v[0];
  return add(p, u, ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den);
}

const HEADINGS: [number, number] = [158, 268], LENGTHS: [number, number] = [4.7, 4.3], CAP = 1.0;
/**
 * The outline of a boomerang in the ground plane: two blades leaving the elbow at the headings
 * (degrees from the x axis), `w0` wide at the elbow and tapering to `w1` at rounded tips, both
 * edges of each blade bowed outward. The second blade has a vertex where the coral band is cut, so
 * `boomerangBand` shares its edges exactly. Twenty two points, going round once.
 */
export function boomerangOutline([a1, a2] = HEADINGS, [l1, l2] = LENGTHS, w0 = 0.7, w1 = 0.46, bow = 0.2): P2[] {
  const E: P2 = [0, 0], u1 = dir(a1), u2 = dir(a2), p1 = perpAway(u1, u2), p2 = perpAway(u2, u1);
  const inner = meet(add(E, p1, -w0), u1, add(E, p2, -w0), u2);
  const bis: P2 = [-(u1[0] + u2[0]), -(u1[1] + u2[1])], bl = Math.hypot(bis[0], bis[1]);
  const outer = add(E, [bis[0] / bl, bis[1] / bl], w0 * 1.2);
  const width = (l: number, len: number) => w0 + (w1 - w0) * (l / len) + bow * Math.sin((Math.PI * l) / len);
  // One blade: up its inner edge, round the tip, down its outer edge; `cut` is where the band starts.
  const blade = (u: P2, p: P2, len: number, cut: number): P2[] => {
    const at = (l: number, side: number): P2 => add(add(E, u, l), p, side * width(l, len));
    return [at(len * 0.35, -1), at(cut, -1), at(len, -1), add(add(E, u, len + 0.24), p, -w1 * 0.55), add(E, u, len + 0.36), add(add(E, u, len + 0.24), p, w1 * 0.55), at(len, 1), at(cut, 1), at(len * 0.35, 1)];
  };
  return [inner, ...blade(u1, p1, l1, l1 * 0.7), add(add(E, p1, w0), u1, 0.45), outer, add(add(E, p2, w0), u2, 0.45), ...blade(u2, p2, l2, l2 - CAP).reverse()];
}
/** The tip of the second blade beyond the band cut: seven of the outline's own vertices. */
export const boomerangBand = (outline: P2[]): P2[] => outline.slice(14, 21);

/**
 * Extrudes a plan outline `h` up from `z`: the top face, the sides that face the viewer sorted back
 * to front, and `edges`, the silhouette below the top face (each visible bottom edge and the
 * verticals where the visible run starts and ends). `open` leaves out the closing edge, for a
 * solid cut out of another.
 */
export function extrude(outline: P2[], z: number, h: number, unit = 22, open = false) {
  let area = 0;
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const o = area < 0 ? [...outline].reverse() : outline, n = o.length;
  const P = (p: P2, zz: number) => isoPoint(p[0], p[1], zz, unit);
  const normal = (i: number): P2 => { const a = o[i], b = o[(i + 1) % n]; return [b[1] - a[1], a[0] - b[0]]; };
  const visible = (i: number) => { const v = normal((i + n) % n); return !(open && (i + n) % n === n - 1) && v[0] + v[1] > 0; };
  const sides: { tone: "left" | "right"; points: string; depth: number }[] = [];
  const edges: string[] = [];
  for (let i = 0; i < n; i++) {
    if (!visible(i)) continue;
    const a = o[i], b = o[(i + 1) % n], v = normal(i);
    sides.push({ tone: v[0] > v[1] ? "right" : "left", points: pts([P(a, z + h), P(b, z + h), P(b, z), P(a, z)]), depth: a[0] + a[1] + b[0] + b[1] });
    edges.push(`M${P(a, z)} L${P(b, z)}`);
    if (!visible(i - 1)) edges.push(`M${P(a, z + h)} L${P(a, z)}`);
    if (!visible(i + 1)) edges.push(`M${P(b, z + h)} L${P(b, z)}`);
  }
  sides.sort((x, y) => x.depth - y.depth);
  return { top: pts(o.map((p) => P(p, z + h))), sides, edges: edges.join(" "), project: P };
}

/** A tapered wind streak from `from` to `to`, bowed by `bow` (screen px), `w` wide at its head. */
function streakPath(from: P2, to: P2, bow: number, w: number): { d: string; box: P2[] } {
  const d: P2 = [to[0] - from[0], to[1] - from[1]], len = Math.hypot(d[0], d[1]), n: P2 = [-d[1] / len, d[0] / len];
  const c: P2 = [(from[0] + to[0]) / 2 + n[0] * bow, (from[1] + to[1]) / 2 + n[1] * bow];
  const a = add(from, n, w / 2), b = add(from, n, -w / 2), ca = add(c, n, w / 4), cb = add(c, n, -w / 4);
  return { d: `M${r(a[0])},${r(a[1])} Q${r(ca[0])},${r(ca[1])} ${r(to[0])},${r(to[1])} Q${r(cb[0])},${r(cb[1])} ${r(b[0])},${r(b[1])} Z`, box: [a, b, ca, cb, to] };
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const Z = 1.7, H = 0.34, SHADOW: [number, number] = [56, 32];
const INK = { stroke: "var(--sky-ink)", strokeWidth: 1, strokeLinejoin: "round" as const, strokeLinecap: "round" as const, vectorEffect: "non-scaling-stroke" as const };

/**
 * A boomerang mid-swoop: an extruded isometric V in the sky family with a coral band on its leading
 * tip, a ground shadow beneath it and a tail of wind behind it, following its arc. It flies toward
 * positive x, so the tail trails up and left. Scales to its container; `compact` (96px rows) keeps
 * two streaks and drops the shadow. Enters once along the arc; under reduced motion it is at rest.
 */
export function BoomerangScene({ compact = false }: { compact?: boolean }) {
  const still = useMemo(reducedMotion, []);
  const outline = boomerangOutline();
  const body = extrude(outline, Z, H), band = extrude(boomerangBand(outline), Z, H, 22, true), P = body.project;
  const elbow = P(outline[0], Z + H / 2), tip = P(outline[5], Z + H / 2), ground = P([0.3, 0.3], 0);
  // [head, length, bow, width, fill, opacity]: from the trailing tip and the inner elbow, longest in the middle.
  const tails: [P2, number, number, number, string, number][] = [
    [[tip[0] + 2, tip[1] - 6], 72, 10, 8, "var(--sky-top)", 0.55],
    [[tip[0] + 6, tip[1] + 6], 104, 16, 11, "var(--stone-left)", 0.5],
    [[elbow[0] - 8, elbow[1] + 2], 122, 22, 12, "var(--stone-left)", 0.45],
    [[elbow[0] + 8, elbow[1] - 6], 90, 14, 9, "var(--sky-top)", 0.6],
    [[elbow[0] + 24, elbow[1] - 14], 58, 8, 6, "var(--stone-left)", 0.35],
  ];
  const streaks = (compact ? [tails[1], tails[2]] : tails).map(([from, len, bow, w, fill, opacity]) => ({ ...streakPath(from, [from[0] - len * C, from[1] - len * S], bow, w), fill, opacity }));
  const box: P2[] = [...streaks.flatMap((s) => s.box), ...(body.top + " " + body.sides.map((s) => s.points).join(" ")).split(" ").map((q) => q.split(",").map(Number) as P2)];
  if (!compact) box.push([ground[0] - SHADOW[0], ground[1] + SHADOW[1]], [ground[0] + SHADOW[0], ground[1] + SHADOW[1]]);
  const xs = box.map((p) => p[0]), ys = box.map((p) => p[1]), pad = compact ? 4 : 10;
  const x0 = Math.floor(Math.min(...xs)) - pad, y0 = Math.floor(Math.min(...ys)) - pad;
  const viewBox = `${x0} ${y0} ${Math.ceil(Math.max(...xs)) + pad - x0} ${Math.ceil(Math.max(...ys)) + pad - y0}`;
  return (
    <svg viewBox={viewBox} className={"iso-scene bm-scene" + (compact ? " compact" : "")} role="img" aria-label="A boomerang mid-swoop with a tail of wind">
      {streaks.map((s, i) => <path key={i} className={"bm-streak" + (still ? "" : " bm-streak-in")} style={still ? undefined : { animationDelay: `${i * 40}ms` }} d={s.d} fill={s.fill} opacity={s.opacity} />)}
      {!compact && <ellipse cx={ground[0]} cy={ground[1]} rx={SHADOW[0]} ry={SHADOW[1]} fill="var(--stone-top)" opacity={0.6} />}
      <g className={"bm-body" + (still ? "" : " bm-swoop")}>
        {body.sides.map((s, i) => <polygon key={i} points={s.points} fill={`var(--sky-${s.tone})`} />)}
        {band.sides.map((s, i) => <polygon key={i} points={s.points} fill={`var(--coral-${s.tone})`} />)}
        <path d={body.edges} fill="none" {...INK} />
        <polygon points={body.top} fill="var(--sky-top)" {...INK} />
        <polygon points={band.top} fill="var(--coral-top)" {...INK} />
      </g>
    </svg>
  );
}
