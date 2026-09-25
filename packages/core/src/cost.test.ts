import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CostInput, estimateCost, findPrice, MAX_TOKENS_PER_FIELD, type PriceTable } from "./index";
import bundled from "./prices.json";
import { normalise } from "../../../scripts/prices-update.mjs";

const table: PriceTable = {
  source: "https://models.dev/api.json",
  date: "2026-09-25",
  models: {
    "anthropic/claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
    "anthropic/claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    "openai/gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
  },
};

describe("estimateCost", () => {
  it("prices input and output tokens per million and reports the price date", () => {
    const r = estimateCost({ model: "anthropic/claude-fable-5-1", inputTokens: 1_000_000, outputTokens: 100_000 }, table);
    expect(r).toEqual({ usd: 15, priceDate: "2026-09-25", matched: "anthropic/claude-fable-5-1" });
  });
  it("prices cache reads and writes at their own rates", () => {
    const r = estimateCost({ model: "anthropic/claude-fable-5-1", inputTokens: 0, outputTokens: 0, cacheReadTokens: 4_000_000, cacheWriteTokens: 2_000_000 }, table);
    expect(r.usd).toBeCloseTo(1 + 25, 9);
  });
  it("charges cache tokens at the input rate when the table has no cache price", () => {
    const r = estimateCost({ model: "openai/gpt-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }, table);
    expect(r.usd).toBeCloseTo(0.125 + 1.25, 9);
  });
  it("matches exactly first", () => {
    expect(estimateCost({ model: "anthropic/claude-fable-5-1", inputTokens: 1, outputTokens: 1 }, table).matched).toBe("anthropic/claude-fable-5-1");
  });
  it("falls back to a case-insensitive match", () => {
    expect(estimateCost({ model: "Anthropic/Claude-Fable-5-1", inputTokens: 1, outputTokens: 1 }, table).matched).toBe("anthropic/claude-fable-5-1");
  });
  it("falls back to the model id without its provider prefix", () => {
    expect(estimateCost({ model: "claude-fable-5-1", inputTokens: 1, outputTokens: 1 }, table).matched).toBe("anthropic/claude-fable-5-1");
    expect(estimateCost({ model: "GPT-5", inputTokens: 1, outputTokens: 1 }, table).matched).toBe("openai/gpt-5");
  });
  it("ignores surrounding whitespace in the reported model name", () => {
    expect(estimateCost({ model: "  claude-fable-5-1\n", inputTokens: 1, outputTokens: 1 }, table).matched).toBe("anthropic/claude-fable-5-1");
  });
  it("returns null usd and null matched for an unknown model, still with the price date", () => {
    expect(estimateCost({ model: "acme/unknown-9", inputTokens: 1000, outputTokens: 1000 }, table)).toEqual({ usd: null, priceDate: "2026-09-25", matched: null });
  });
  it("uses the bundled table by default", () => {
    const r = estimateCost({ model: "anthropic/claude-fable-5-1", inputTokens: 1000, outputTokens: 1000 });
    expect(r.priceDate).toBe(bundled.date);
    expect(r.matched).toBe("anthropic/claude-fable-5-1");
    expect(r.usd).not.toBeNull();
  });
});

describe("CostInput", () => {
  const ok = { model: "claude-fable-5-1", inputTokens: 1, outputTokens: 1 };
  it("caps every token field at MAX_TOKENS_PER_FIELD and refuses one token more", () => {
    expect(MAX_TOKENS_PER_FIELD).toBe(50_000_000);
    for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) {
      expect(CostInput.safeParse({ ...ok, [field]: MAX_TOKENS_PER_FIELD }).success).toBe(true);
      const over = CostInput.safeParse({ ...ok, [field]: MAX_TOKENS_PER_FIELD + 1 });
      expect(over.success).toBe(false);
      expect(over.success ? [] : over.error.issues.map((i) => i.path.join("."))).toEqual([field]);
    }
  });
  it("wants whole, non-negative tokens and no other fields", () => {
    expect(CostInput.safeParse({ ...ok, inputTokens: 1.5 }).success).toBe(false);
    expect(CostInput.safeParse({ ...ok, outputTokens: -1 }).success).toBe(false);
    expect(CostInput.safeParse({ ...ok, note: "x" }).success).toBe(false);
  });
});

describe("findPrice tie-break on a bare id", () => {
  const shared: PriceTable = {
    source: "https://models.dev/api.json",
    date: "2026-09-25",
    models: {
      "aaa-gateway/shared-x": { input: 1, output: 1 },
      "google/shared-x": { input: 2, output: 2 },
      "anthropic/shared-x": { input: 3, output: 3 },
      "zeta/other-y": { input: 4, output: 4 },
      "beta/other-y": { input: 5, output: 5 },
    },
  };
  it("prefers the documented provider priority over alphabetical order", () => {
    expect(findPrice("shared-x", shared)).toBe("anthropic/shared-x");
    expect(estimateCost({ model: "shared-x", inputTokens: 1_000_000, outputTokens: 0 }, shared).usd).toBe(3);
  });
  it("falls back to alphabetical order among providers outside the priority list", () => {
    expect(findPrice("other-y", shared)).toBe("beta/other-y");
    expect(estimateCost({ model: "other-y", inputTokens: 1_000_000, outputTokens: 0 }, shared).usd).toBe(5);
  });
});

describe("prices.json", () => {
  const Price = z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheRead: z.number().nonnegative().optional(),
      cacheWrite: z.number().nonnegative().optional(),
    })
    .strict();
  const Table = z
    .object({
      source: z.literal("https://models.dev/api.json"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      models: z.record(z.string().regex(/^[a-z0-9.-]+\/.+$/), Price),
    })
    .strict();
  it("matches the bundled table schema", () => {
    expect(Table.safeParse(bundled).success).toBe(true);
  });
  it("carries the Claude 5 family and keeps its keys sorted", () => {
    const keys = Object.keys(bundled.models);
    for (const id of ["anthropic/claude-fable-5-1", "anthropic/claude-opus-5", "anthropic/claude-sonnet-5", "anthropic/claude-haiku-4-5-20251001"]) expect(keys).toContain(id);
    expect(keys.some((k) => k.startsWith("meta/"))).toBe(true);
    expect(keys).toEqual([...keys].sort());
    expect(keys.length).toBeGreaterThan(100);
  });
});

describe("prices-update normalise", () => {
  const api = {
    zeta: { id: "zeta", models: { "z-1": { cost: { input: 1, output: 2 } } } },
    anthropic: {
      id: "anthropic",
      models: {
        "claude-x": { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75, tiers: [] } },
        "claude-free": {},
        "claude-broken": { cost: { input: "3", output: 15 } },
      },
    },
    openai: { id: "openai", models: { "gpt-x": { cost: { input: 1.25, output: 10, cache_read: 0.125 } } } },
  };
  it("keeps only listed providers, drops unpriced models, renames cache keys and sorts", () => {
    const t = normalise(api, { providers: ["openai", "anthropic"], date: "2026-09-25" });
    expect(t).toEqual({
      source: "https://models.dev/api.json",
      date: "2026-09-25",
      models: {
        "anthropic/claude-x": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        "openai/gpt-x": { input: 1.25, output: 10, cacheRead: 0.125 },
      },
    });
    expect(Object.keys(t.models)).toEqual(["anthropic/claude-x", "openai/gpt-x"]);
  });
  it("defaults to the bundled provider list", () => {
    const t = normalise(api, { date: "2026-09-25" });
    expect(Object.keys(t.models)).toEqual(["anthropic/claude-x", "openai/gpt-x"]);
  });
});
