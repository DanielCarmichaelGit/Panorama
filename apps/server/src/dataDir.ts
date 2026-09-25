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

/**
 * The data directory: the env override, else ~/.boomerang, moving a pre-rename ~/.panorama
 * there on first start. The move is skipped once ~/.boomerang holds a config.json (it is in
 * use). A ~/.boomerang without one beside a ~/.panorama is ambiguous, and a move across
 * filesystems (EXDEV) cannot be done with a rename: both refuse to start with a message that
 * says what to move by hand, rather than guess which directory is the real one.
 */
export function resolveDataDir({ env, home, log, rename = renameSync }: { env: Env; home: string; log: Log; rename?: (from: string, to: string) => void }): string {
  const fromEnv = envWithFallback(env, "DATA_DIR", log);
  if (fromEnv) return fromEnv;
  const next = join(home, ".boomerang"), old = join(home, ".panorama");
  if (existsSync(join(next, "config.json")) || !existsSync(old)) return next;
  const byHand = `Move ${old} to ${next} by hand (or remove the one you no longer use) and start again.`;
  if (existsSync(next)) throw new Error(`Both ${old} and ${next} exist and ${next} has no config.json. ${byHand}`);
  try {
    rename(old, next);
  } catch (e) {
    if ((e as { code?: string }).code === "EXDEV") throw new Error(`Could not move ${old} to ${next}: they are on different filesystems. ${byHand}`);
    throw e;
  }
  log(`Moved ${old} to ${next}`);
  return next;
}

export const allowFastKdf = (env: Env, log: Log): boolean => envWithFallback(env, "ALLOW_FAST_KDF", log) === "1";
