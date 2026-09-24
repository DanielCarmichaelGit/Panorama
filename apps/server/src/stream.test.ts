import { describe, expect, it } from "vitest";
import { signRequest } from "@panorama/core";
import { agentIn, setupApp } from "./test/helpers";

async function open(app: any, seed: Uint8Array, actor: string) {
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const res = await fetch(base + "/api/v1/stream", { headers: await signRequest(seed, actor, "GET", "/api/v1/stream", "") });
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  const next = async (): Promise<{ type: string; data: any }> => {
    for (;;) { const i = buf.indexOf("\n\n"); if (i >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); if (chunk.startsWith(":")) continue;
      const type = /event: (.*)/.exec(chunk)![1]; const data = JSON.parse(/data: (.*)/.exec(chunk)![1]); return { type, data }; }
      const { value, done } = await reader.read(); if (done) throw new Error("closed"); buf += dec.decode(value); }
  };
  return { res, next, base, close: () => reader.cancel() };
}

describe("stream", () => {
  it("delivers committed events to the human and only in-scope events to an agent, and ends on lock", async () => {
    const s = await setupApp();
    const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
    const other = (await s.human("POST", "/api/v1/projects", { name: "O", key: "OO" })).json;
    const { agent } = await agentIn(s, project.id);
    const h = await open(s.app, s.keys.seed, "human");
    const t = (await agent("POST", "/api/v1/tickets", { projectId: project.id, title: "x" })).json;
    expect(await h.next()).toMatchObject({ type: "ticket.created", data: { id: t.id, projectId: project.id } });
    await s.human("POST", "/api/v1/tickets", { projectId: other.project.id, title: "y" });
    expect((await h.next()).type).toBe("ticket.created");
    expect((await s.human("POST", "/api/v1/comments", { ticketId: t.id, body: "hi" })).status).toBe(200);
    expect((await h.next()).type).toBe("comment.added");
    await s.human("POST", "/api/v1/lock");
    await expect(h.next()).rejects.toThrow("closed");
    await s.app.close();
  });
  it("does not publish events from a request that failed", async () => {
    const s = await setupApp();
    const { project, lanes } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
    const h = await open(s.app, s.keys.seed, "human");
    const t = (await s.human("POST", "/api/v1/tickets", { projectId: project.id, title: "x" })).json; await h.next();
    expect((await s.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lanes[4].id })).status).toBe(422);
    await s.human("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "blocked", on: true });
    expect((await h.next()).type).toBe("ticket.flag_set");
    h.close(); await s.app.close();
  });
  it("answers 423 while locked, like every other route", async () => {
    const s = await setupApp();
    expect((await s.human("POST", "/api/v1/lock")).status).toBe(200);
    expect((await s.human("GET", "/api/v1/stream")).status).toBe(423);
  });
});
