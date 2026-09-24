import { describe, expect, it } from "vitest";
import { ARGON_FAST, signRequest } from "@panorama/core";
import { buildApp } from "./app";
import { agentIn, client, humanKeys, tempDir } from "./test/helpers";

/** Same shape as setupApp in test/helpers.ts, but takes its own `now` so tests can move the
 *  clock to exercise the 30s presence throttle. Not imported from helpers.ts because setupApp
 *  does not take a `now`, and adding one there would ripple into every other test file. */
async function setup(now: () => Date) {
  const dir = tempDir();
  const app = await buildApp({ dataDir: dir, allowFastKdf: true, now });
  const keys = await humanKeys();
  const human = client(app, keys.seed, "human");
  const res = await human("POST", "/api/v1/setup", {
    publicKey: keys.publicKeyHex, kdfSalt: "00".repeat(16), argon: ARGON_FAST, encryption: true, dbKey: keys.dbKeyHex,
  });
  if (res.status !== 200) throw new Error(`setup failed: ${JSON.stringify(res.json)}`);
  return { app, human, keys, dir };
}

// Copied from stream.test.ts's open() helper rather than imported, per the sibling test file's
// own convention: each stream test owns its reader loop.
async function open(app: any, seed: Uint8Array, actor: string, base?: string) {
  base ??= await app.listen({ host: "127.0.0.1", port: 0 });
  const res = await fetch(base + "/api/v1/stream", { headers: await signRequest(seed, actor, "GET", "/api/v1/stream", "") });
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  const next = async (): Promise<{ type: string; data: any }> => {
    for (;;) { const i = buf.indexOf("\n\n"); if (i >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); if (chunk.startsWith(":")) continue;
      const type = /event: (.*)/.exec(chunk)![1]; const data = JSON.parse(/data: (.*)/.exec(chunk)![1]); return { type, data }; }
      const { value, done } = await reader.read(); if (done) throw new Error("closed"); buf += dec.decode(value); }
  };
  return { res, next, base, close: () => reader.cancel() };
}

describe("presence", () => {
  it("sets currentTicketId when an agent creates a ticket, and clears it once the ticket reaches a done lane", async () => {
    const s = await setup(() => new Date());
    const { project, lanes } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
    const { agent, agentId } = await agentIn(s, project.id);

    const t = (await agent("POST", "/api/v1/tickets", { projectId: project.id, title: "x" })).json;
    let mine = (await s.human("GET", "/api/v1/agents")).json.find((a: any) => a.id === agentId);
    expect(mine.currentTicketId).toBe(t.id);

    // Satisfy the Done lane's gate (human sign-off) so the agent's move actually goes through.
    await s.human("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_human_signoff", payload: { note: "" } });
    const doneLane = lanes.find((l: any) => l.isDone);
    const moved = await agent("POST", `/api/v1/tickets/${t.id}/move`, { laneId: doneLane.id });
    expect(moved.status).toBe(200);

    mine = (await s.human("GET", "/api/v1/agents")).json.find((a: any) => a.id === agentId);
    expect(mine.currentTicketId).toBeNull();
  });

  it("answers GET /api/v1/agents for any active actor with read, but only the public shape for an agent", async () => {
    const s = await setup(() => new Date());
    const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
    const { agent, agentId } = await agentIn(s, project.id);

    const res = await agent("GET", "/api/v1/agents");
    expect(res.status).toBe(200);
    const mine = res.json.find((a: any) => a.id === agentId);
    expect(Object.keys(mine).sort()).toEqual(["currentTicketId", "id", "kind", "lastSeen", "name", "status"].sort());

    const humanRes = await s.human("GET", "/api/v1/agents");
    expect(humanRes.status).toBe(200);
    expect(humanRes.json.find((a: any) => a.id === agentId)).toHaveProperty("publicKey");

    // An agent without read may not call it at all.
    const { agent: blind } = await agentIn(s, project.id, ["ticket.create"]);
    expect((await blind("GET", "/api/v1/agents")).status).toBe(403);
  });

  it("publishes agent.seen to the human's stream once per agent per 30s, not on every request", async () => {
    // Every request is signed with the real wall clock (see client() in test/helpers.ts), and
    // verifyRequest only tolerates a 60s skew against ctx.now(), so the fake clock has to start
    // at the real time and only move by small amounts from there, not at an arbitrary date.
    let now = new Date();
    const s = await setup(() => now);
    const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
    const { agent, agentId } = await agentIn(s, project.id);

    const h = await open(s.app, s.keys.seed, "human");

    const t1 = (await agent("POST", "/api/v1/tickets", { projectId: project.id, title: "one" })).json;
    expect(await h.next()).toMatchObject({ type: "agent.seen", data: { id: agentId, currentTicketId: null } });
    expect(await h.next()).toMatchObject({ type: "ticket.created", data: { id: t1.id } });

    // 5s later, still inside the 30s window: no second agent.seen, straight to ticket.created.
    now = new Date(now.getTime() + 5_000);
    const t2 = (await agent("POST", "/api/v1/tickets", { projectId: project.id, title: "two" })).json;
    expect(await h.next()).toMatchObject({ type: "ticket.created", data: { id: t2.id } });

    // 35s after the first publish: the throttle has expired, agent.seen fires again.
    now = new Date(now.getTime() + 30_000);
    const t3 = (await agent("POST", "/api/v1/tickets", { projectId: project.id, title: "three" })).json;
    expect(await h.next()).toMatchObject({ type: "agent.seen", data: { id: agentId } });
    expect(await h.next()).toMatchObject({ type: "ticket.created", data: { id: t3.id } });

    h.close(); await s.app.close();
  });
});
