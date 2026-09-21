import { ARGON, ARGON_FAST, deriveKeys, randomHex, signText } from "@panorama/core";
import { api } from "../lib/api";
import type { Status } from "../App";
type Call = (method: string, path: string, body: unknown, seed: Uint8Array) => Promise<any>;
const defaultCall: Call = (m, p, b, seed) => api(m, p, b, seed);

export async function unlockFlow(password: string, status: Status, deps: { call?: Call } = {}) {
  const call = deps.call ?? defaultCall;
  const k = await deriveKeys(password, status.kdfSalt!, status.argon!);
  if (k.publicKeyHex !== status.humanPublicKey) throw new Error("wrong_password");
  if (status.state === "locked") await call("POST", "/api/v1/unlock", { dbKey: k.dbKeyHex }, k.seed);
  const v = await call("GET", "/api/v1/chain/verify", undefined, k.seed);
  if (!v.ok) return { seed: k.seed, chain: { ok: false as const, brokenAt: v.brokenAt as number } };
  if (v.seq > 0) await call("POST", "/api/v1/checkpoints", { headHash: v.head, signature: await signText(k.seed, v.head) }, k.seed);
  return { seed: k.seed, chain: { ok: true as const } };
}

export async function setupFlow(password: string, encryption: boolean): Promise<Uint8Array> {
  const kdfSalt = randomHex(16), argon = import.meta.env.VITE_FAST_KDF ? ARGON_FAST : ARGON;
  const k = await deriveKeys(password, kdfSalt, argon);
  await api("POST", "/api/v1/setup", { publicKey: k.publicKeyHex, kdfSalt, argon, encryption, dbKey: encryption ? k.dbKeyHex : null }, k.seed);
  return k.seed;
}
