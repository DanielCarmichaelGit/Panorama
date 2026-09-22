import { afterEach, describe, expect, it, vi } from "vitest";
import { ARGON_FAST, deriveKeys, verifyRequest } from "@panorama/core";
import { api, ApiError } from "./api";
import { session } from "./session";

afterEach(() => { session.clear(); vi.unstubAllGlobals(); });

describe("api", () => {
  it("signs requests as the human when a seed is in memory", async () => {
    const k = await deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST); session.setSeed(k.seed);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api("POST", "/api/v1/tickets", { a: 1 })).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe("/api/v1/tickets");
    expect(await verifyRequest(k.publicKeyHex, init.headers, "POST", "/api/v1/tickets", init.body, Date.now())).toBe(true);
  });
  it("throws ApiError with the server code and drops the session when locked", async () => {
    const k = await deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST); session.setSeed(k.seed);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "locked", message: "Panorama is locked" } }), { status: 423 })));
    await expect(api("GET", "/api/v1/projects")).rejects.toMatchObject({ status: 423, code: "locked" });
    expect(session.getSeed()).toBeNull();
    expect(new ApiError(400, "x", "y")).toBeInstanceOf(Error);
  });
});
