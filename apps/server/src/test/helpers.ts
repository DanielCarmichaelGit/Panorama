import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARGON_FAST, deriveKeys, signRequest } from "@panorama/core";
import { buildApp } from "../app";

export const tempDir = () => mkdtempSync(join(tmpdir(), "pan-srv-"));
export const humanKeys = () => deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST);

export function client(app: any, seed: Uint8Array, actorId: string) {
  return async (method: string, url: string, body?: unknown) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = { ...(await signRequest(seed, actorId, method, url, payload)) };
    if (payload) headers["content-type"] = "application/json";
    const res = await app.inject({ method, url, payload: payload || undefined, headers });
    return { status: res.statusCode, json: res.body ? res.json() : null };
  };
}

export async function setupApp(encryption = true) {
  const dir = tempDir();
  const app = await buildApp({ dataDir: dir });
  const keys = await humanKeys();
  const human = client(app, keys.seed, "human");
  const res = await human("POST", "/api/v1/setup", { publicKey: keys.publicKeyHex, kdfSalt: "00".repeat(16), argon: ARGON_FAST, encryption, dbKey: encryption ? keys.dbKeyHex : null });
  if (res.status !== 200) throw new Error(`setup failed: ${JSON.stringify(res.json)}`);
  return { app, human, keys, dir };
}
