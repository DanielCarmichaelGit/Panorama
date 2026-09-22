import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { randomHex, sha256Hex } from "./hash";

export type SignedHeaders = { "x-pan-actor": string; "x-pan-ts": string; "x-pan-nonce": string; "x-pan-sig": string };

export const requestMessage = (method: string, path: string, body: string, ts: string, nonce: string): string =>
  [method.toUpperCase(), path, sha256Hex(body), ts, nonce].join("\n");

export const signText = async (seed: Uint8Array, text: string): Promise<string> =>
  bytesToHex(await ed.signAsync(utf8ToBytes(text), seed));

export async function verifyText(publicKeyHex: string, text: string, sigHex: string): Promise<boolean> {
  try { return await ed.verifyAsync(hexToBytes(sigHex), utf8ToBytes(text), hexToBytes(publicKeyHex)); } catch { return false; }
}

export async function signRequest(seed: Uint8Array, actorId: string, method: string, path: string, body: string, nowMs: number = Date.now()): Promise<SignedHeaders> {
  const ts = String(nowMs), nonce = randomHex(16);
  return { "x-pan-actor": actorId, "x-pan-ts": ts, "x-pan-nonce": nonce, "x-pan-sig": await signText(seed, requestMessage(method, path, body, ts, nonce)) };
}

export async function verifyRequest(publicKeyHex: string, h: Partial<SignedHeaders>, method: string, path: string, body: string, nowMs: number, skewMs = 60_000): Promise<boolean> {
  const ts = h["x-pan-ts"], nonce = h["x-pan-nonce"], sig = h["x-pan-sig"];
  if (!ts || !nonce || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(nowMs - Number(ts)) > skewMs) return false;
  return verifyText(publicKeyHex, requestMessage(method, path, body, ts, nonce), sig);
}
