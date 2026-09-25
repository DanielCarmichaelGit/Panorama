import type { Family } from "@boomerang/core";

/** One sRGB colour, channels 0 to 255. Fractional channels are allowed mid-calculation. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * The seven preset hexes from BRAND.md ("Colour presets"): pastel hues at family-top lightness,
 * chosen so they read as siblings of the five families. Order is the order the ColorField shows.
 */
export const PRESET_COLORS = ["#f6c1b4", "#f7d9a8", "#f2e8a6", "#bfe8cf", "#b9ddf5", "#d3c8f4", "#f2c4e0"] as const;

const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };

/** The chip background stops lightening once it is at least this luminous (about a family top). */
const TOP_LUMINANCE = 0.78;
/** The WCAG AA floor for normal text. */
const INK_CONTRAST = 4.5;
/** Each step mixes a tenth of the way toward white or black. */
const STEP = 0.1;
/** Enough steps to reach either target from any colour (about 22 from black to a 0.78 top). */
const MAX_STEPS = 64;

/** Reads `#rrggbb` (either case). Anything else, including 3 and 8 digit forms, is null. */
export function parseHex(hex: string): RGB | null {
  const m = HEX6.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function clampChannel(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** Writes lower-case `#rrggbb`, rounding and clamping each channel. */
export function toHex(rgb: RGB): string {
  const part = (v: number) => clampChannel(v).toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2 relative luminance, 0 for black to 1 for white. */
export function relativeLuminance(rgb: RGB): number {
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

/** WCAG 2 contrast ratio, 1 to 21, in either order. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/** Linear interpolation in sRGB: `t` 0 gives `a`, 1 gives `b`. Not rounded. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function rounded(rgb: RGB): RGB {
  return { r: clampChannel(rgb.r), g: clampChannel(rgb.g), b: clampChannel(rgb.b) };
}

/**
 * The two chip tokens for a custom colour, derived the way the family pairs were tuned: `top`
 * is the colour mixed toward white until its relative luminance is at least 0.78, `ink` is the
 * colour mixed toward black until it clears 4.5:1 against that top (a colour already dark
 * enough is its own ink). The state advances in floats so a step is never lost to rounding, but
 * each check runs on the rounded value so the hex returned is what was measured. Deterministic,
 * no DOM. Throws on a hex it cannot parse; `chipTokens` guards for callers holding user input.
 */
export function derivePair(hex: string): { top: string; ink: string } {
  const base = parseHex(hex);
  if (!base) throw new RangeError(`Not a #rrggbb colour: ${hex}`);

  let top: RGB = base;
  for (let i = 0; i < MAX_STEPS && relativeLuminance(rounded(top)) < TOP_LUMINANCE; i++) {
    top = mix(top, WHITE, STEP);
  }
  const topOut = rounded(top);

  let ink: RGB = base;
  for (let i = 0; i < MAX_STEPS && contrastRatio(rounded(ink), topOut) < INK_CONTRAST; i++) {
    ink = mix(ink, BLACK, STEP);
  }

  return { top: toHex(topOut), ink: toHex(ink) };
}

/**
 * The chip background and text for anything coloured (arc, tag, lane, board): the family's CSS
 * variables when there is no usable custom colour, derived hexes when there is. The family is
 * the fallback for a null, missing, or malformed colour, so a chip never renders unstyled.
 */
export function chipTokens(item: { family: Family; color?: string | null }): { top: string; ink: string } {
  if (item.color && parseHex(item.color)) return derivePair(item.color);
  return { top: `var(--${item.family}-top)`, ink: `var(--${item.family}-ink)` };
}
