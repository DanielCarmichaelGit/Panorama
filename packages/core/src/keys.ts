import { argon2id } from "hash-wasm";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export interface ArgonParams { iterations: number; memorySize: number; parallelism: number }
export const ARGON: ArgonParams = { iterations: 3, memorySize: 65536, parallelism: 1 };
export const ARGON_FAST: ArgonParams = { iterations: 1, memorySize: 1024, parallelism: 1 };

export const publicKeyFromSeed = async (seed: Uint8Array): Promise<string> => bytesToHex(await ed.getPublicKeyAsync(seed));

// One Argon2id run, 64 bytes out: first half is the Ed25519 seed (never leaves the browser),
// second half is the database key (sent to the local server at unlock).
export async function deriveKeys(password: string, saltHex: string, params: ArgonParams = ARGON) {
  const out = await argon2id({ password, salt: hexToBytes(saltHex), ...params, hashLength: 64, outputType: "binary" });
  const seed = out.slice(0, 32);
  return { seed, dbKeyHex: bytesToHex(out.slice(32)), publicKeyHex: await publicKeyFromSeed(seed) };
}
