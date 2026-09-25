import { describe, expect, it, vi } from "vitest";
import { ARGON_FAST, deriveKeys, signText } from "@boomerang/core";
import { unlockFlow, type Anchor, type AnchorStore } from "./unlock";

const SALT = "00".repeat(16);
const HEAD = "ab".repeat(32);

const memoryAnchors = (initial: Anchor | null = null): AnchorStore & { value: () => Anchor | null } => {
  let held = initial;
  return { read: () => held, write: (a) => { held = a; }, value: () => held };
};

const status = (state: "locked" | "unlocked", publicKey: string) => ({ state, kdfSalt: SALT, argon: ARGON_FAST, humanPublicKey: publicKey, encryption: state === "locked" });

describe("unlockFlow", () => {
  it("rejects a password whose public key does not match, before touching the server", async () => {
    const call = vi.fn();
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    await expect(unlockFlow("wrong-password-1", status("locked", k.publicKeyHex), { call })).rejects.toThrow("wrong_password");
    expect(call).not.toHaveBeenCalled();
  });

  it("unlocks, verifies, signs the seq bound checkpoint, and stores the anchor", async () => {
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    const call = vi.fn(async (_m: string, path: string, ..._rest: unknown[]) => (path.includes("/chain/verify") ? { ok: true, head: HEAD, seq: 3 } : { ok: true }));
    const anchors = memoryAnchors();
    const out = await unlockFlow("right-password-1", status("locked", k.publicKeyHex), { call, anchors });
    expect(out.chain).toEqual({ ok: true });
    expect(call.mock.calls.map((c) => c[1])).toEqual(["/api/v1/unlock", "/api/v1/chain/verify", "/api/v1/checkpoints"]);
    expect(call.mock.calls[0][2]).toEqual({ dbKey: k.dbKeyHex });
    expect(call.mock.calls[2][2]).toEqual({ seq: 3, headHash: HEAD, signature: await signText(k.seed, `3:${HEAD}`) });
    expect(anchors.value()).toEqual({ seq: 3, headHash: HEAD });
  });

  it("asks the server for the hash at the stored anchor", async () => {
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    const call = vi.fn(async (_m: string, path: string, ..._rest: unknown[]) =>
      path.includes("/chain/verify") ? { ok: true, head: HEAD, seq: 5, anchorHash: "cd".repeat(32) } : { ok: true });
    const anchors = memoryAnchors({ seq: 2, headHash: "cd".repeat(32) });
    const out = await unlockFlow("right-password-1", status("unlocked", k.publicKeyHex), { call, anchors });
    expect(out.chain).toEqual({ ok: true });
    expect(call.mock.calls.map((c) => c[1])).toEqual(["/api/v1/chain/verify?anchorSeq=2", "/api/v1/checkpoints"]);
    expect(anchors.value()).toEqual({ seq: 5, headHash: HEAD });
  });

  it("treats a rolled back log as broken at the anchor, and does not checkpoint it", async () => {
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    for (const anchorHash of ["ef".repeat(32), null]) {
      const call = vi.fn(async (_m: string, path: string, ..._rest: unknown[]) =>
        path.includes("/chain/verify") ? { ok: true, head: HEAD, seq: 5, anchorHash } : { ok: true });
      const anchors = memoryAnchors({ seq: 2, headHash: "cd".repeat(32) });
      const out = await unlockFlow("right-password-1", status("unlocked", k.publicKeyHex), { call, anchors });
      expect(out.chain).toEqual({ ok: false, brokenAt: 2, reason: "anchor_mismatch" });
      expect(call.mock.calls.map((c) => c[1])).toEqual(["/api/v1/chain/verify?anchorSeq=2"]);
      expect(anchors.value()).toEqual({ seq: 2, headHash: "cd".repeat(32) });
    }
  });

  it("skips the checkpoint and reports the reason the server gave", async () => {
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    const call = vi.fn(async (_m: string, path: string, ..._rest: unknown[]) => (path.includes("/chain/verify") ? { ok: false, brokenAt: 7, reason: "truncated" } : { ok: true }));
    const out = await unlockFlow("right-password-1", status("unlocked", k.publicKeyHex), { call, anchors: memoryAnchors() });
    expect(out.chain).toEqual({ ok: false, brokenAt: 7, reason: "truncated" });
    expect(call.mock.calls.map((c) => c[1])).toEqual(["/api/v1/chain/verify"]);
  });
});
