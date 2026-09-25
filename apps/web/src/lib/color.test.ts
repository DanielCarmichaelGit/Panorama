import { FAMILIES } from "@boomerang/core";
import { describe, expect, it } from "vitest";
import { PRESET_COLORS, chipTokens, contrastRatio, derivePair, mix, parseHex, relativeLuminance, toHex } from "./color";

const SAMPLES = [...PRESET_COLORS, "#000000", "#ffffff", "#808080", "#12706a", "#ff0000"];

describe("parseHex and toHex", () => {
  it("parses a six digit hex in either case and round-trips it lower-case", () => {
    expect(parseHex("#F6C1B4")).toEqual({ r: 246, g: 193, b: 180 });
    expect(parseHex("#f6c1b4")).toEqual({ r: 246, g: 193, b: 180 });
    expect(toHex({ r: 246, g: 193, b: 180 })).toBe("#f6c1b4");
    expect(toHex(parseHex("#12706A")!)).toBe("#12706a");
  });

  it("refuses anything that is not #rrggbb", () => {
    expect(parseHex("#12")).toBeNull();
    expect(parseHex("#fff")).toBeNull();
    expect(parseHex("f6c1b4")).toBeNull();
    expect(parseHex("#f6c1b4ff")).toBeNull();
    expect(parseHex("#gggggg")).toBeNull();
    expect(parseHex("")).toBeNull();
  });

  it("rounds and clamps channels when writing", () => {
    expect(toHex({ r: 255.4, g: -3, b: 300 })).toBe("#ff00ff");
  });
});

describe("WCAG maths", () => {
  it("gives white a luminance of 1 and black 0, and 21:1 between them", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 5);
  });

  it("matches the contrast figures BRAND.md records for the accent on the ground", () => {
    // BRAND.md: accent on bg 5.7 (rounded to one decimal there).
    expect(contrastRatio(parseHex("#12706a")!, parseHex("#fafbfc")!)).toBeCloseTo(5.7, 1);
  });

  it("mixes in sRGB: halfway between black and white is mid grey", () => {
    expect(mix({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(mix({ r: 10, g: 20, b: 30 }, { r: 200, g: 100, b: 0 }, 0)).toEqual({ r: 10, g: 20, b: 30 });
    expect(mix({ r: 10, g: 20, b: 30 }, { r: 200, g: 100, b: 0 }, 1)).toEqual({ r: 200, g: 100, b: 0 });
  });
});

describe("derivePair", () => {
  it.each(SAMPLES)("%s yields a top of luminance at least 0.78 and an ink of contrast at least 4.5", (hex) => {
    const { top, ink } = derivePair(hex);
    const topRgb = parseHex(top);
    const inkRgb = parseHex(ink);
    expect(topRgb).not.toBeNull();
    expect(inkRgb).not.toBeNull();
    expect(relativeLuminance(topRgb!)).toBeGreaterThanOrEqual(0.78);
    expect(contrastRatio(inkRgb!, topRgb!)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves white as its own top and black as its own ink", () => {
    expect(derivePair("#ffffff").top).toBe("#ffffff");
    expect(derivePair("#000000").ink).toBe("#000000");
  });

  it("keeps a colour that is already dark enough as its own ink", () => {
    // The accent teal already clears 4.5:1 against its pale top, so it is not darkened.
    expect(derivePair("#12706a").ink).toBe("#12706a");
  });

  it("is deterministic and case-insensitive", () => {
    expect(derivePair("#F6C1B4")).toEqual(derivePair("#f6c1b4"));
    expect(derivePair("#f6c1b4")).toEqual(derivePair("#f6c1b4"));
  });

  it("throws on a colour it cannot parse", () => {
    expect(() => derivePair("#12")).toThrow();
  });
});

describe("chipTokens", () => {
  it("returns the family variables when colour is null or undefined", () => {
    expect(chipTokens({ family: "coral", color: null })).toEqual({ top: "var(--coral-top)", ink: "var(--coral-ink)" });
    expect(chipTokens({ family: "mint" })).toEqual({ top: "var(--mint-top)", ink: "var(--mint-ink)" });
    for (const family of FAMILIES) {
      expect(chipTokens({ family, color: null })).toEqual({ top: `var(--${family}-top)`, ink: `var(--${family}-ink)` });
    }
  });

  it("falls back to the family variables for an invalid colour string", () => {
    expect(chipTokens({ family: "sky", color: "#12" })).toEqual({ top: "var(--sky-top)", ink: "var(--sky-ink)" });
    expect(chipTokens({ family: "sky", color: "blue" })).toEqual({ top: "var(--sky-top)", ink: "var(--sky-ink)" });
  });

  it("derives hexes for a valid colour, whatever the family", () => {
    const tokens = chipTokens({ family: "stone", color: "#F6C1B4" });
    expect(tokens).toEqual(derivePair("#f6c1b4"));
    expect(tokens.top).toMatch(/^#[0-9a-f]{6}$/);
    expect(tokens.ink).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("PRESET_COLORS", () => {
  it("lists the seven BRAND.md presets in order, lower-case", () => {
    expect(PRESET_COLORS).toEqual(["#f6c1b4", "#f7d9a8", "#f2e8a6", "#bfe8cf", "#b9ddf5", "#d3c8f4", "#f2c4e0"]);
  });
});
