import { describe, expect, it } from "vitest";
import { costText, estimateTitle, formatDuration, formatTokens, hasFigures, periodFrom, PERIODS } from "./metrics";

describe("formatDuration", () => {
  it("renders whole hours and minutes, and says under a minute for a few seconds", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(42)).toBe("<1m");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(7500)).toBe("2h 5m");
    expect(formatDuration(3600)).toBe("1h 0m");
  });
});

describe("formatTokens", () => {
  it("keeps small counts whole and rounds thousands and millions to one decimal", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(1_000_015)).toBe("1.0M");
    expect(formatTokens(3_450_000)).toBe("3.5M");
  });
});

describe("costText", () => {
  it("shows the estimate with a tilde when every entry is priced", () => {
    expect(costText({ usd: 9.4, known: 9.4, unpriced: 0 })).toBe("~$9.40");
    expect(costText({ usd: 0, known: 0, unpriced: 0 })).toBe("~$0");
  });

  it("says at least when an unpriced model sits beside priced ones, and no price when nothing was priced", () => {
    expect(costText({ usd: null, known: 1.5, unpriced: 1 })).toBe("at least ~$1.50");
    expect(costText({ usd: null, known: 0, unpriced: 2 })).toBe("no price");
  });
});

describe("estimateTitle", () => {
  it("names the price source, its date, and that the figure could be lower", () => {
    expect(estimateTitle("2026-09-24")).toBe("Estimate from models.dev prices dated 2026-09-24; this could be lower");
  });
});

describe("periodFrom", () => {
  it("reads a known period from the URL and falls back to the week", () => {
    expect(periodFrom("month")).toBe("month");
    expect(periodFrom("all")).toBe("all");
    expect(periodFrom(null)).toBe("week");
    expect(periodFrom("yesterday")).toBe("week");
    expect(PERIODS.map((p) => p.label)).toEqual(["This week", "This month", "All time"]);
  });
});

describe("hasFigures", () => {
  it("is false only when nothing was recorded and no timer runs", () => {
    expect(hasFigures({ seconds: 0, openTimers: 0, entries: 0 })).toBe(false);
    expect(hasFigures({ seconds: 5, openTimers: 0, entries: 0 })).toBe(true);
    expect(hasFigures({ seconds: 0, openTimers: 1, entries: 0 })).toBe(true);
    expect(hasFigures({ seconds: 0, openTimers: 0, entries: 1 })).toBe(true);
  });
});
