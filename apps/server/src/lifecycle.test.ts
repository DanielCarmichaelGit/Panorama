import { describe, expect, it } from "vitest";
import { ARGON_FAST, signRequest } from "@panorama/core";
import { buildApp } from "./app";
import { humanKeys, tempDir } from "./test/helpers";

const SALT = "00".repeat(16);
async function doSetup(app: any, keys: any, encryption: boolean) {
  const body = JSON.stringify({ publicKey: keys.publicKeyHex, kdfSalt: SALT, argon: ARGON_FAST, encryption, dbKey: encryption ? keys.dbKeyHex : null });
  const headers = { ...(await signRequest(keys.seed, "human", "POST", "/api/v1/setup", body)), "content-type": "application/json" };
  return app.inject({ method: "POST", url: "/api/v1/setup", payload: body, headers });
}

describe("lifecycle", () => {
  it("starts uninitialized, sets up once, and reports unlocked", async () => {
    const app = await buildApp({ dataDir: tempDir() }); const keys = await humanKeys();
    expect((await app.inject("/api/v1/status")).json()).toEqual({ state: "uninitialized" });
    expect((await doSetup(app, keys, true)).statusCode).toBe(200);
    expect((await app.inject("/api/v1/status")).json()).toMatchObject({ state: "unlocked", humanPublicKey: keys.publicKeyHex, encryption: true, kdfSalt: SALT });
    expect((await doSetup(app, keys, true)).statusCode).toBe(409);
  });
  it("rejects a setup request not signed by the key it registers", async () => {
    const app = await buildApp({ dataDir: tempDir() }); const keys = await humanKeys();
    const body = JSON.stringify({ publicKey: "11".repeat(32), kdfSalt: SALT, argon: ARGON_FAST, encryption: false, dbKey: null });
    const headers = { ...(await signRequest(keys.seed, "human", "POST", "/api/v1/setup", body)), "content-type": "application/json" };
    expect((await app.inject({ method: "POST", url: "/api/v1/setup", payload: body, headers })).statusCode).toBe(401);
  });
  it("comes back locked after restart when encrypted, and unlocks only with the right key", async () => {
    const dir = tempDir(); const keys = await humanKeys();
    const first = await buildApp({ dataDir: dir }); await doSetup(first, keys, true); await first.close();
    const app = await buildApp({ dataDir: dir });
    expect((await app.inject("/api/v1/status")).json().state).toBe("locked");
    const locked = await app.inject("/api/v1/projects");
    expect(locked.statusCode).toBe(423);
    expect(locked.headers["retry-after"]).toBe("30");
    expect((await app.inject({ method: "POST", url: "/api/v1/unlock", payload: { dbKey: "cd".repeat(32) } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/unlock", payload: { dbKey: keys.dbKeyHex } })).statusCode).toBe(200);
    expect((await app.inject("/api/v1/status")).json().state).toBe("unlocked");
  });
  it("opens without a key after restart when encryption is off", async () => {
    const dir = tempDir(); const keys = await humanKeys();
    const first = await buildApp({ dataDir: dir }); await doSetup(first, keys, false); await first.close();
    expect((await (await buildApp({ dataDir: dir })).inject("/api/v1/status")).json().state).toBe("unlocked");
  });
});
