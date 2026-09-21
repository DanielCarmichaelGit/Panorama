import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, signText } from "@panorama/core";
import { latestCheckpoint } from "@panorama/db";
import { client, setupApp } from "./test/helpers";

async function approvedAgent(s: Awaited<ReturnType<typeof setupApp>>) {
  const ak = await deriveKeys("agent-secret-xyz", "11".repeat(16), ARGON_FAST);
  const id = (await s.app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker", publicKey: ak.publicKeyHex } })).json().id;
  await s.human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: "*", actions: ["read"] } });
  return client(s.app, ak.seed, id);
}

describe("chain", () => {
  it("verifies, accepts a signed checkpoint, rejects a forged one", async () => {
    const { app, human, keys } = await setupApp();
    await human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const v = (await human("GET", "/api/v1/chain/verify")).json;
    expect(v).toMatchObject({ ok: true, seq: 2 });
    expect((await human("POST", "/api/v1/checkpoints", { headHash: v.head, signature: "00".repeat(64) })).status).toBe(400);
    expect((await human("POST", "/api/v1/checkpoints", { headHash: v.head, signature: await signText(keys.seed, v.head) })).status).toBe(200);
    expect(latestCheckpoint(app.ctx.db!)).toEqual({ seq: 2, headHash: v.head });
  });

  it("reports direct database tampering", async () => {
    const { app, human } = await setupApp();
    await human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const db = app.ctx.db!;
    db.exec("drop trigger events_no_update");
    db.prepare("update events set payload = '{\"id\":\"x\"}' where seq = 2").run();
    expect((await human("GET", "/api/v1/chain/verify")).json).toEqual({ ok: false, brokenAt: 2 });
  });

  it("forbids an approved agent from verifying the chain or creating checkpoints", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const agent = await approvedAgent(s);
    expect((await agent("GET", "/api/v1/chain/verify")).status).toBe(403);
    expect((await agent("POST", "/api/v1/checkpoints", { headHash: "00".repeat(32), signature: "00".repeat(64) })).status).toBe(403);
  });

  it("rejects a checkpoint whose headHash is well-formed but does not match the current head", async () => {
    const { human, keys } = await setupApp();
    await human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const wrongHash = "ab".repeat(32);
    const res = await human("POST", "/api/v1/checkpoints", { headHash: wrongHash, signature: await signText(keys.seed, wrongHash) });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("bad_checkpoint");
  });

  it("reports a gap left by deleting an event", async () => {
    const { app, human } = await setupApp();
    await human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const ak = await deriveKeys("agent-secret-xyz", "11".repeat(16), ARGON_FAST);
    const id = (await app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker", publicKey: ak.publicKeyHex } })).json().id;
    await human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: "*", actions: ["read"] } });
    const db = app.ctx.db!;
    db.exec("drop trigger events_no_delete");
    db.prepare("delete from events where seq = 3").run();
    expect((await human("GET", "/api/v1/chain/verify")).json).toEqual({ ok: false, brokenAt: 4 });
  });
});
