import { ARGON, ARGON_FAST, deriveKeys, randomHex, signText } from "@boomerang/core";
import { api } from "../lib/api";
import { ANCHOR_KEY } from "../lib/storage";
import type { Status } from "../App";

type Call = (method: string, path: string, body: unknown, seed: Uint8Array) => Promise<any>;
const defaultCall: Call = (m, p, b, seed) => api(m, p, b, seed);

export type ChainReason = "hash" | "truncated" | "checkpoint_mismatch" | "checkpoint_signature" | "anchor_mismatch" | "empty";
export type ChainState = { ok: true } | { ok: false; brokenAt: number; reason: ChainReason };

/** The chain head this browser last signed. Not secret: it is a sequence number and a hash. */
export interface Anchor { seq: number; headHash: string }
export interface AnchorStore { read(): Anchor | null; write(a: Anchor): void }

export { ANCHOR_KEY } from "../lib/storage";

const browserAnchors: AnchorStore = {
  read() {
    try {
      const raw = localStorage.getItem(ANCHOR_KEY);
      const v = raw ? (JSON.parse(raw) as Partial<Anchor>) : null;
      return typeof v?.seq === "number" && typeof v?.headHash === "string" ? { seq: v.seq, headHash: v.headHash } : null;
    } catch {
      return null;
    }
  },
  write(a) {
    try {
      localStorage.setItem(ANCHOR_KEY, JSON.stringify(a));
    } catch {
      // storage unavailable; the anchor just won't survive this reload
    }
  },
};

export async function unlockFlow(password: string, status: Status, deps: { call?: Call; anchors?: AnchorStore } = {}) {
  const call = deps.call ?? defaultCall;
  const anchors = deps.anchors ?? browserAnchors;
  const k = await deriveKeys(password, status.kdfSalt!, status.argon!);
  if (k.publicKeyHex !== status.humanPublicKey) throw new Error("wrong_password");
  if (status.state === "locked") await call("POST", "/api/v1/unlock", { dbKey: k.dbKeyHex }, k.seed);

  const anchor = anchors.read();
  const v = await call("GET", anchor ? `/api/v1/chain/verify?anchorSeq=${anchor.seq}` : "/api/v1/chain/verify", undefined, k.seed);
  if (!v.ok) return { seed: k.seed, chain: { ok: false as const, brokenAt: v.brokenAt as number, reason: v.reason as ChainReason } };
  // The server verified itself. Cross-check its answer against what this browser last saw,
  // which is the part an attacker who owns the whole data directory cannot rewrite.
  if (anchor && v.anchorHash !== anchor.headHash) return { seed: k.seed, chain: { ok: false as const, brokenAt: anchor.seq, reason: "anchor_mismatch" as const } };

  if (v.seq > 0) {
    await call("POST", "/api/v1/checkpoints", { seq: v.seq, headHash: v.head, signature: await signText(k.seed, `${v.seq}:${v.head}`) }, k.seed);
    anchors.write({ seq: v.seq, headHash: v.head });
  }
  return { seed: k.seed, chain: { ok: true as const } };
}

export async function setupFlow(password: string, encryption: boolean): Promise<Uint8Array> {
  const kdfSalt = randomHex(16), argon = import.meta.env.VITE_FAST_KDF ? ARGON_FAST : ARGON;
  const k = await deriveKeys(password, kdfSalt, argon);
  await api("POST", "/api/v1/setup", { publicKey: k.publicKeyHex, kdfSalt, argon, encryption, dbKey: encryption ? k.dbKeyHex : null }, k.seed);
  return k.seed;
}
