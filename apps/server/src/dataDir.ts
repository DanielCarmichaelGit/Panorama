import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

export type Env = Record<string, string | undefined>;
export type Log = (line: string) => void;

// The PANORAMA_* names are read for one release after the rename and logged as deprecated once.
function envWithFallback(env: Env, name: string, log: Log): string | undefined {
  const fresh = env[`BOOMERANG_${name}`];
  if (fresh !== undefined) return fresh;
  const old = env[`PANORAMA_${name}`];
  if (old !== undefined) log(`PANORAMA_${name} is deprecated; use BOOMERANG_${name}`);
  return old;
}

/** The data directory: the env override, else ~/.boomerang, moving a pre-rename ~/.panorama there on first start. */
export function resolveDataDir({ env, home, log }: { env: Env; home: string; log: Log }): string {
  const fromEnv = envWithFallback(env, "DATA_DIR", log);
  if (fromEnv) return fromEnv;
  const next = join(home, ".boomerang"), old = join(home, ".panorama");
  if (!existsSync(next) && existsSync(old)) {
    renameSync(old, next);
    log(`Moved ${old} to ${next}`);
  }
  return next;
}

export const allowFastKdf = (env: Env, log: Log): boolean => envWithFallback(env, "ALLOW_FAST_KDF", log) === "1";
