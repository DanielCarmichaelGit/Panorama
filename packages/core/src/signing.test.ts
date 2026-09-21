import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, signRequest, signText, verifyRequest, verifyText } from "./index";

const salt = "00112233445566778899aabbccddeeff";

describe("deriveKeys", () => {
  it("is deterministic and separates the db key from the seed", async () => {
    const a = await deriveKeys("correct horse battery", salt, ARGON_FAST);
    const b = await deriveKeys("correct horse battery", salt, ARGON_FAST);
    expect(a.publicKeyHex).toBe(b.publicKeyHex);
    expect(a.dbKeyHex).toHaveLength(64);
    expect(a.publicKeyHex).toHaveLength(64);
    expect(Buffer.from(a.seed).toString("hex")).not.toBe(a.dbKeyHex);
    const c = await deriveKeys("another password", salt, ARGON_FAST);
    expect(c.publicKeyHex).not.toBe(a.publicKeyHex);
  });
});

describe("request signing", () => {
  it("round trips and rejects tampering, staleness, and the wrong key", async () => {
    const k = await deriveKeys("pw-one-two-three", salt, ARGON_FAST);
    const other = await deriveKeys("pw-four-five-six", salt, ARGON_FAST);
    const now = 1_800_000_000_000;
    const h = await signRequest(k.seed, "human", "post", "/api/v1/tickets?x=1", '{"a":1}', now);
    expect(h["x-pan-actor"]).toBe("human");
    expect(await verifyRequest(k.publicKeyHex, h, "POST", "/api/v1/tickets?x=1", '{"a":1}', now + 5_000)).toBe(true);
    expect(await verifyRequest(k.publicKeyHex, h, "POST", "/api/v1/tickets?x=1", '{"a":2}', now)).toBe(false);
    expect(await verifyRequest(k.publicKeyHex, h, "POST", "/api/v1/other", '{"a":1}', now)).toBe(false);
    expect(await verifyRequest(k.publicKeyHex, h, "POST", "/api/v1/tickets?x=1", '{"a":1}', now + 61_000)).toBe(false);
    expect(await verifyRequest(other.publicKeyHex, h, "POST", "/api/v1/tickets?x=1", '{"a":1}', now)).toBe(false);
    expect(await verifyRequest(k.publicKeyHex, { ...h, "x-pan-sig": "zz" }, "POST", "/api/v1/tickets?x=1", '{"a":1}', now)).toBe(false);
    expect(await verifyRequest(k.publicKeyHex, {}, "POST", "/api/v1/tickets?x=1", '{"a":1}', now)).toBe(false);
  });
  it("signs and verifies plain text", async () => {
    const k = await deriveKeys("pw-one-two-three", salt, ARGON_FAST);
    const sig = await signText(k.seed, "abc");
    expect(await verifyText(k.publicKeyHex, "abc", sig)).toBe(true);
    expect(await verifyText(k.publicKeyHex, "abd", sig)).toBe(false);
  });
});
