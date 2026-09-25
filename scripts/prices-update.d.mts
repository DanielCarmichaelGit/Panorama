// Types for the hand-run price updater, so its pure normaliser can be tested from packages/core.
import type { PriceTable } from "../packages/core/src/cost";

export declare const SOURCE: "https://models.dev/api.json";
export declare const DEFAULT_PROVIDERS: string[];

/** models.dev `api.json` to the bundled `PriceTable`: listed providers only, unpriced models
 *  dropped, `cache_read`/`cache_write` renamed, keys sorted. */
export declare function normalise(api: unknown, options: { providers?: readonly string[]; date: string }): PriceTable;
