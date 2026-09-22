import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, GENESIS, hashEvent, signText } from "@panorama/core";
import { latestCheckpoint } from "@panorama/db";
import { client, setupApp } from "./test/helpers";

type Setup = Awaited<ReturnType<typeof setupApp>>;

async function approvedAgent(s: Setup) {
  const ak = await deriveKeys("agent-secret-xyz", "11".repeat(16), ARGON_FAST);
  const id = (await s.app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker", publicKey: ak.publicKeyHex } })).json().id;
  await s.human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: "*", actions: ["read"] } });
  return client(s.app, ak.seed, id);
}

const signedCheckpoint = async (seed: Uint8Array, seq: number, headHash: string) => ({ seq, headHash, signature: await signText(seed, `${seq}:${headHash}`) });

const verify = async (s: Setup, query = "") => (await s.human("GET", `/api/v1/chain/verify${query}`)).json;

/** Signs the chain at its current head, the way the browser does at unlock. */
async function checkpointNow(s: Setup) {
  const v = await verify(s);
  const res = await s.human("POST", "/api/v1/checkpoints", await signedCheckpoint(s.keys.seed, v.seq, v.head));
  if (res.status !== 200) throw new Error(`checkpoint failed: ${JSON.stringify(res.json)}`);
  return v;
}

/** Stands in for an agent that has the database file and edits it directly. */
function unlockTriggers(s: Setup) {
  const db = s.app.ctx.db!;
  for (const t of ["events_no_update", "events_no_delete", "checkpoints_no_update", "checkpoints_no_delete"]) db.exec(`drop trigger if exists ${t}`);
  return db;
}

describe("chain", () => {
  it("verifies, accepts a seq bound signed checkpoint, rejects a forged one", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const v = await verify(s);
    expect(v).toMatchObject({ ok: true, seq: 2, checkpointSeq: null });
    expect((await s.human("POST", "/api/v1/checkpoints", { seq: v.seq, headHash: v.head, signature: "00".repeat(64) })).status).toBe(400);
    expect((await s.human("POST", "/api/v1/checkpoints", await signedCheckpoint(s.keys.seed, v.seq, v.head))).status).toBe(200);
    expect(latestCheckpoint(s.app.ctx.db!)).toMatchObject({ seq: 2, headHash: v.head });
    expect(await verify(s)).toMatchObject({ ok: true, checkpointSeq: 2 });
  });

  it("rejects a checkpoint whose signature covers another seq, and one whose seq is not the head", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const v = await verify(s);
    const wrongSeq = await s.human("POST", "/api/v1/checkpoints", { seq: v.seq, headHash: v.head, signature: await signText(s.keys.seed, `1:${v.head}`) });
    expect(wrongSeq.status).toBe(400);
    expect(wrongSeq.json.error.code).toBe("bad_checkpoint");
    expect((await s.human("POST", "/api/v1/checkpoints", await signedCheckpoint(s.keys.seed, 1, v.head))).status).toBe(400);
  });

  it("reports direct database tampering", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const db = unlockTriggers(s);
    db.prepare("update events set payload = '{\"id\":\"x\"}' where seq = 2").run();
    expect(await verify(s)).toEqual({ ok: false, brokenAt: 2, reason: "hash" });
  });

  it("reports a gap left by deleting an event", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const agent = await approvedAgent(s);
    await agent("GET", "/api/v1/projects");
    const db = unlockTriggers(s);
    db.prepare("delete from events where seq = 3").run();
    expect(await verify(s)).toEqual({ ok: false, brokenAt: 4, reason: "hash" });
  });

  it("detects entries removed from the end after a checkpoint", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const p = (await s.human("GET", "/api/v1/projects")).json[0];
    await s.human("POST", "/api/v1/tickets", { projectId: p.id, title: "One" });
    await s.human("POST", "/api/v1/tickets", { projectId: p.id, title: "Two" });
    const v = await checkpointNow(s);
    expect(v.seq).toBe(4);
    unlockTriggers(s).prepare("delete from events where seq > 3").run();
    expect(await verify(s)).toEqual({ ok: false, brokenAt: 4, reason: "truncated" });
  });

  it("detects a chain rewritten from GENESIS after a checkpoint", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    await checkpointNow(s);
    const db = unlockTriggers(s);
    db.prepare("delete from events").run();
    let prev = GENESIS;
    for (const seq of [1, 2]) {
      const base = { seq, prevHash: prev, actorId: "human", type: "system.setup", payload: { forged: seq }, createdAt: "2026-09-21T00:00:00.000Z" };
      const hash = hashEvent(base);
      db.prepare("insert into events(seq, prev_hash, hash, actor_id, type, payload, signature, created_at) values(?,?,?,?,?,?,?,?)")
        .run(seq, prev, hash, "human", base.type, JSON.stringify(base.payload), "forged", base.createdAt);
      prev = hash;
    }
    expect(await verify(s)).toEqual({ ok: false, brokenAt: 2, reason: "checkpoint_mismatch" });
  });

  it("detects a checkpoint row whose signature is not the owner's", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    await checkpointNow(s);
    unlockTriggers(s).prepare("update checkpoints set signature = ? where seq = 2").run("11".repeat(64));
    expect(await verify(s)).toEqual({ ok: false, brokenAt: 2, reason: "checkpoint_signature" });
  });

  it("does not detect a deleted checkpoint row on its own", async () => {
    // Honest gap: with both the tail and the checkpoint gone the server has nothing left
    // to compare against. The browser anchor in pan.anchor is what catches this rollback.
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const p = (await s.human("GET", "/api/v1/projects")).json[0];
    await s.human("POST", "/api/v1/tickets", { projectId: p.id, title: "One" });
    await checkpointNow(s);
    const db = unlockTriggers(s);
    db.prepare("delete from checkpoints").run();
    db.prepare("delete from events where seq > 2").run();
    expect(await verify(s)).toMatchObject({ ok: true, seq: 2, checkpointSeq: null });
  });

  it("answers ok false rather than failing when the events table is empty", async () => {
    const s = await setupApp();
    unlockTriggers(s).prepare("delete from events").run();
    const res = await s.human("GET", "/api/v1/chain/verify");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: false, brokenAt: 1, reason: "empty" });
    const cp = await s.human("POST", "/api/v1/checkpoints", await signedCheckpoint(s.keys.seed, 1, "ab".repeat(32)));
    expect(cp.status).toBe(400);
    expect(cp.json.error.code).toBe("bad_checkpoint");
  });

  it("returns the hash at anchorSeq, or null when there is no such entry", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const head = (s.app.ctx.db!.prepare("select hash from events where seq = 1").get() as { hash: string }).hash;
    expect(await verify(s, "?anchorSeq=1")).toMatchObject({ ok: true, anchorHash: head });
    expect(await verify(s, "?anchorSeq=9")).toMatchObject({ ok: true, anchorHash: null });
    expect(await verify(s)).not.toHaveProperty("anchorHash");
  });

  it("forbids an approved agent from verifying the chain or creating checkpoints", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const agent = await approvedAgent(s);
    expect((await agent("GET", "/api/v1/chain/verify")).status).toBe(403);
    expect((await agent("POST", "/api/v1/checkpoints", { seq: 1, headHash: "00".repeat(32), signature: "00".repeat(64) })).status).toBe(403);
  });

  it("rejects a checkpoint whose headHash is well-formed but does not match the current head", async () => {
    const s = await setupApp();
    await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const wrongHash = "ab".repeat(32);
    const res = await s.human("POST", "/api/v1/checkpoints", await signedCheckpoint(s.keys.seed, 2, wrongHash));
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("bad_checkpoint");
  });
});
