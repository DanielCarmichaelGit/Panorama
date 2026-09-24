import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, signRequest } from "@panorama/core";
import { client, setupApp } from "./test/helpers";

const agentKeys = () => deriveKeys("agent-secret-xyz", "11".repeat(16), ARGON_FAST);

describe("auth", () => {
  it("rejects unsigned, unknown, and replayed requests", async () => {
    const { app, keys } = await setupApp();
    expect((await app.inject("/api/v1/me")).statusCode).toBe(401);
    const stranger = client(app, keys.seed, "nobody");
    expect((await stranger("GET", "/api/v1/me")).json.error.code).toBe("unknown_actor");
    const headers = await signRequest(keys.seed, "human", "GET", "/api/v1/me", "");
    expect((await app.inject({ method: "GET", url: "/api/v1/me", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/me", headers })).json().error.code).toBe("replay");
  });
});

describe("agents", () => {
  it("registers pending, cannot act until approved, acts after, stops after revoke", async () => {
    const { app, human } = await setupApp(); const ak = await agentKeys();
    const reg = await app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "claude-worker-1", publicKey: ak.publicKeyHex } });
    expect(reg.statusCode).toBe(200);
    const id = reg.json().id; const agent = client(app, ak.seed, id);
    expect((await agent("GET", "/api/v1/me")).json.error.code).toBe("pending");
    expect((await agent("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: "*", actions: ["read"] } })).status).toBe(403);
    expect((await human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: "*", actions: ["read"] } })).status).toBe(200);
    expect((await agent("GET", "/api/v1/me")).json).toMatchObject({ id, status: "active" });
    // Any active actor with read may list agents, but an agent only ever sees the public shape.
    const seenByAgent = await agent("GET", "/api/v1/agents");
    expect(seenByAgent.status).toBe(200);
    expect(seenByAgent.json).toEqual([{ id, name: "claude-worker-1", kind: "agent", status: "active", lastSeen: expect.any(String), currentTicketId: null }]);
    expect((await human("GET", "/api/v1/agents")).json).toHaveLength(1);
    expect((await human("POST", `/api/v1/agents/${id}/revoke`)).status).toBe(200);
    expect((await agent("GET", "/api/v1/me")).json.error.code).toBe("revoked");
  });
  it("refuses a duplicate public key", async () => {
    const { app } = await setupApp(); const ak = await agentKeys();
    const payload = { name: "a", publicKey: ak.publicKeyHex };
    await app.inject({ method: "POST", url: "/api/v1/agents/register", payload });
    expect((await app.inject({ method: "POST", url: "/api/v1/agents/register", payload })).statusCode).toBe(409);
  });
  it("locks on request from the human only", async () => {
    const { app, human } = await setupApp(true);
    expect((await human("POST", "/api/v1/lock")).status).toBe(200);
    expect((await app.inject("/api/v1/status")).json().state).toBe("locked");
  });
  it("still answers 423 for register while locked", async () => {
    const { app, human } = await setupApp(true);
    expect((await human("POST", "/api/v1/lock")).status).toBe(200);
    const ak = await agentKeys();
    const res = await app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "a", publicKey: ak.publicKeyHex } });
    expect(res.statusCode).toBe(423);
  });
});
