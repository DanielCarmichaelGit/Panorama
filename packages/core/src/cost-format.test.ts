import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatEstimate, roundEstimate, sumEstimates } from "./index";

describe("cost-format.ts stays free of the price table", () => {
  it("imports neither prices.json nor cost.ts, so the browser bundle never carries the table", () => {
    const source = readFileSync(new URL("./cost-format.ts", import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(specifiers).not.toContainEqual(expect.stringMatching(/prices\.json/));
    expect(specifiers).not.toContainEqual(expect.stringMatching(/^\.\/cost$/));
    expect(specifiers.length).toBe(0);
  });
});

describe("roundEstimate", () => {
  it("keeps two significant figures and never goes below a cent of precision", () => {
    expect(roundEstimate(9.4321)).toBe(9.4);
    expect(roundEstimate(0.094)).toBe(0.09);
    expect(roundEstimate(12345)).toBe(12000);
    expect(roundEstimate(0)).toBe(0);
  });
});

describe("formatEstimate", () => {
  it("rounds to two significant figures across magnitudes, never finer than a cent", () => {
    expect(formatEstimate(0.004)).toBe("<~$0.01");
    expect(formatEstimate(0.094)).toBe("~$0.09");
    expect(formatEstimate(9.4)).toBe("~$9.40");
    expect(formatEstimate(9.4321)).toBe("~$9.40");
    expect(formatEstimate(940)).toBe("~$940");
    expect(formatEstimate(943.21)).toBe("~$940");
    expect(formatEstimate(12000)).toBe("~$12,000");
    expect(formatEstimate(12345)).toBe("~$12,000");
  });
  it("shows a bare zero for nothing spent", () => {
    expect(formatEstimate(0)).toBe("~$0");
  });
  it("says no price when the estimate is null", () => {
    expect(formatEstimate(null)).toBe("no price");
  });
});

describe("sumEstimates", () => {
  it("adds known estimates and carries the price date", () => {
    const r = sumEstimates([
      { usd: 1.5, priceDate: "2026-09-25" },
      { usd: 2, priceDate: "2026-09-25" },
    ]);
    expect(r).toEqual({ usd: 3.5, known: 3.5, priceDate: "2026-09-25" });
  });
  it("returns null when any input is null but keeps the known subtotal", () => {
    const r = sumEstimates([
      { usd: 1.5, priceDate: "2026-09-25" },
      { usd: null, priceDate: "2026-09-25" },
    ]);
    expect(r).toEqual({ usd: null, known: 1.5, priceDate: "2026-09-25" });
  });
  it("reports the oldest price date among mixed inputs", () => {
    const r = sumEstimates([
      { usd: 1, priceDate: "2026-09-25" },
      { usd: 1, priceDate: "2026-08-01" },
    ]);
    expect(r.priceDate).toBe("2026-08-01");
  });
  it("sums an empty list to zero with no price date, since nothing was priced", () => {
    expect(sumEstimates([])).toEqual({ usd: 0, known: 0, priceDate: null });
  });
});
