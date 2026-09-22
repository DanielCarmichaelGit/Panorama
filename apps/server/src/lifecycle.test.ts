import { chmodSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARGON, ARGON_FAST, signRequest } from "@panorama/core";
import { buildApp } from "./app";
import { humanKeys, tempDir } from "./test/helpers";

const SALT = "00".repeat(16);
const app = (dataDir: string, extra: Record<string, unknown> = {}) => buildApp({ dataDir, allowFastKdf: true, ...extra });

async function doSetup(app: any, keys: any, encryption: boolean, argon = ARGON_FAST) {
  const body = JSON.stringify({ publicKey: keys.publicKeyHex, kdfSalt: SALT, argon, encryption, dbKey: encryption ? keys.dbKeyHex : null });
  const headers = { ...(await signRequest(keys.seed, "human", "POST", "/api/v1/setup", body)), "content-type": "application/json" };
  return app.inject({ method: "POST", url: "/api/v1/setup", payload: body, headers });
}

describe("lifecycle", () => {
  it("starts uninitialized, sets up once, and reports unlocked", async () => {
    const a = await app(tempDir()); const keys = await humanKeys();
    expect((await a.inject("/api/v1/status")).json()).toEqual({ state: "uninitialized" });
    expect((await doSetup(a, keys, true)).statusCode).toBe(200);
    expect((await a.inject("/api/v1/status")).json()).toMatchObject({ state: "unlocked", humanPublicKey: keys.publicKeyHex, encryption: true, kdfSalt: SALT });
    expect((await doSetup(a, keys, true)).statusCode).toBe(409);
  });
  it("rejects a setup request not signed by the key it registers", async () => {
    const a = await app(tempDir()); const keys = await humanKeys();
    const body = JSON.stringify({ publicKey: "11".repeat(32), kdfSalt: SALT, argon: ARGON_FAST, encryption: false, dbKey: null });
    const headers = { ...(await signRequest(keys.seed, "human", "POST", "/api/v1/setup", body)), "content-type": "application/json" };
    expect((await a.inject({ method: "POST", url: "/api/v1/setup", payload: body, headers })).statusCode).toBe(401);
  });
  it("comes back locked after restart when encrypted, and unlocks only with the right key", async () => {
    const dir = tempDir(); const keys = await humanKeys();
    const first = await app(dir); await doSetup(first, keys, true); await first.close();
    const a = await app(dir);
    expect((await a.inject("/api/v1/status")).json().state).toBe("locked");
    const locked = await a.inject("/api/v1/projects");
    expect(locked.statusCode).toBe(423);
    expect(locked.headers["retry-after"]).toBe("30");
    expect((await a.inject({ method: "POST", url: "/api/v1/unlock", payload: { dbKey: "cd".repeat(32) } })).statusCode).toBe(401);
    expect((await a.inject({ method: "POST", url: "/api/v1/unlock", payload: { dbKey: keys.dbKeyHex } })).statusCode).toBe(200);
    expect((await a.inject("/api/v1/status")).json().state).toBe("unlocked");
  });
  it("opens without a key after restart when encryption is off", async () => {
    const dir = tempDir(); const keys = await humanKeys();
    const first = await app(dir); await doSetup(first, keys, false); await first.close();
    expect((await (await app(dir)).inject("/api/v1/status")).json().state).toBe("unlocked");
  });
});

describe("setup guards", () => {
  it("refuses setup when a database is already there but config.json is not", async () => {
    const dir = tempDir(); const keys = await humanKeys();
    writeFileSync(join(dir, "panorama.db"), "");
    const res = await doSetup(await app(dir), keys, true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("already_setup");
  });

  it("sets up into a data directory that does not exist yet", async () => {
    const dir = join(tempDir(), "panorama");
    const keys = await humanKeys();
    expect((await doSetup(await app(dir), keys, true)).statusCode).toBe(200);
    expect(existsSync(join(dir, "config.json"))).toBe(true);
  });

  it("creates the database readable by its owner only", async () => {
    const dir = tempDir(); const keys = await humanKeys();
    expect((await doSetup(await app(dir), keys, true)).statusCode).toBe(200);
    expect(statSync(join(dir, "panorama.db")).mode & 0o777).toBe(0o600);
  });

  it("leaves nothing behind when setup fails after opening the database", async () => {
    // An invalid clock stands in for any failure between opening the file and writing
    // config.json: what matters is that the half-built database does not survive it.
    const dir = tempDir(); const keys = await humanKeys();
    const broken = await app(dir, { now: () => new Date(NaN) });
    expect((await doSetup(broken, keys, true)).statusCode).toBe(500);
    expect(broken.ctx.db).toBeNull();
    expect(existsSync(join(dir, "panorama.db"))).toBe(false);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
    expect((await doSetup(await app(dir), keys, true)).statusCode).toBe(200);
  });

  it("refuses Argon parameters weaker than the default unless the app allows them", async () => {
    const keys = await humanKeys();
    const strict = await buildApp({ dataDir: tempDir() });
    const weak = await doSetup(strict, keys, false);
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe("weak_kdf");
    expect((await doSetup(strict, keys, false, ARGON)).statusCode).toBe(200);
  });
});

describe("unlock failures", () => {
  it("separates a bad key from a database that cannot be opened at all", async () => {
    const dir = tempDir(); const keys = await humanKeys();
    const first = await app(dir); await doSetup(first, keys, true); await first.close();
    const file = join(dir, "panorama.db");
    chmodSync(file, 0o444);
    chmodSync(dir, 0o555);
    try {
      const a = await app(dir);
      const res = await a.inject({ method: "POST", url: "/api/v1/unlock", payload: { dbKey: keys.dbKeyHex } });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toMatchObject({ code: "open_failed" });
    } finally {
      chmodSync(dir, 0o755);
      chmodSync(file, 0o644);
    }
  });
});
