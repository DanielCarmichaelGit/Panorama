import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArgonParams } from "@panorama/core";
export interface Config { kdfSalt: string; argon: ArgonParams; humanPublicKey: string; encryption: boolean }
export function readConfig(dir: string): Config | null {
  const f = join(dir, "config.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Config) : null;
}
export function writeConfig(dir: string, c: Config): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, "config.json.tmp");
  writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  renameSync(tmp, join(dir, "config.json"));
}
