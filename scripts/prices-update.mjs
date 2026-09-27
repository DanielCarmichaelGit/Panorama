#!/usr/bin/env node
// Rewrites packages/core/src/prices.json from models.dev. Run by hand (`pnpm prices:update`),
// never at runtime and never from a test: Boomerang makes no network calls, so the bundled
// snapshot is the only price source and its `date` is what every estimate reports.
//
// Usage: node scripts/prices-update.mjs [--from <path to a saved api.json>]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE = "https://models.dev/api.json";

/** models.dev lists 200+ providers, most of them gateways reselling the same models. The bundle
 *  keeps the first-party vendors, the big clouds, and the gateways agents commonly report; the
 *  full list is six times the size for no extra models. Add a provider here when an agent reports
 *  a model the table does not know.
 *
 *  Several of these list the same bare model id. When an agent reports an id with no provider,
 *  `findPrice` in packages/core/src/cost.ts prefers, in order: anthropic, openai, google, xai,
 *  mistral, deepseek, meta; any other provider comes after those, alphabetically. Keep the two
 *  lists in step. */
export const DEFAULT_PROVIDERS = [
  "alibaba",
  "amazon-bedrock",
  "anthropic",
  "azure",
  "cerebras",
  "cohere",
  "deepseek",
  "fireworks-ai",
  "github-copilot",
  "google",
  "google-vertex",
  "groq",
  "meta",
  "minimax",
  "mistral",
  "moonshotai",
  "openai",
  "openrouter",
  "perplexity",
  "togetherai",
  "vercel",
  "xai",
  "zai",
];

const isPrice = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Pure: models.dev `api.json` (providers keyed by id, each with `models` keyed by id and a
 *  `cost` in USD per million tokens) to the bundled shape, keys sorted, unpriced models dropped. */
export function normalise(api, { providers = DEFAULT_PROVIDERS, date } = {}) {
  if (typeof date !== "string") throw new Error("normalise: a date is required");
  const entries = [];
  for (const provider of providers) {
    const models = api[provider]?.models ?? {};
    for (const [id, model] of Object.entries(models)) {
      const cost = model?.cost;
      if (!cost || !isPrice(cost.input) || !isPrice(cost.output)) continue;
      const price = { input: cost.input, output: cost.output };
      if (isPrice(cost.cache_read)) price.cacheRead = cost.cache_read;
      if (isPrice(cost.cache_write)) price.cacheWrite = cost.cache_write;
      entries.push([`${provider}/${id}`, price]);
    }
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { source: SOURCE, date, models: Object.fromEntries(entries) };
}

async function main(argv) {
  const fromIndex = argv.indexOf("--from");
  let api;
  if (fromIndex !== -1) {
    api = JSON.parse(readFileSync(argv[fromIndex + 1], "utf8"));
  } else {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
    api = await res.json();
  }
  const date = new Date().toISOString().slice(0, 10);
  const table = normalise(api, { date });
  const target = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "core", "src", "prices.json");
  writeFileSync(target, JSON.stringify(table, null, 2) + "\n");
  console.log(`prices: ${Object.keys(table.models).length} models dated ${table.date} written to ${target}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
