import { describe, expect, it, vi } from "vitest";
import { ARGON_FAST, deriveKeys } from "@panorama/core";
import { unlockFlow } from "./unlock";

const SALT = "00".repeat(16);
describe("unlockFlow", () => {
  it("rejects a password whose public key does not match, before touching the server", async () => {
    const call = vi.fn();
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    await expect(unlockFlow("wrong-password-1", { state: "locked", kdfSalt: SALT, argon: ARGON_FAST, humanPublicKey: k.publicKeyHex, encryption: true }, { call })).rejects.toThrow("wrong_password");
    expect(call).not.toHaveBeenCalled();
  });
  it("unlocks, verifies, and checkpoints", async () => {
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    const call = vi.fn(async (_m: string, path: string, ..._rest: unknown[]) => path.endsWith("/chain/verify") ? { ok: true, head: "ab".repeat(32), seq: 3 } : { ok: true });
    const out = await unlockFlow("right-password-1", { state: "locked", kdfSalt: SALT, argon: ARGON_FAST, humanPublicKey: k.publicKeyHex, encryption: true }, { call });
    expect(out.chain).toEqual({ ok: true });
    expect(call.mock.calls.map((c) => c[1])).toEqual(["/api/v1/unlock", "/api/v1/chain/verify", "/api/v1/checkpoints"]);
    expect(call.mock.calls[0][2]).toEqual({ dbKey: k.dbKeyHex });
  });
  it("skips the checkpoint and reports a broken chain", async () => {
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    const call = vi.fn(async (_m: string, path: string, ..._rest: unknown[]) => path.endsWith("/chain/verify") ? { ok: false, brokenAt: 7 } : { ok: true });
    const out = await unlockFlow("right-password-1", { state: "unlocked", kdfSalt: SALT, argon: ARGON_FAST, humanPublicKey: k.publicKeyHex, encryption: false }, { call });
    expect(out.chain).toEqual({ ok: false, brokenAt: 7 });
    expect(call.mock.calls.map((c) => c[1])).toEqual(["/api/v1/chain/verify"]);
  });
});
