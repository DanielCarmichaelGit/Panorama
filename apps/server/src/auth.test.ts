import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, signRequest } from "@panorama/core";
import { buildApp } from "./app";
import { multipart, setupApp } from "./test/helpers";

const URL = "/api/v1/me";

describe("request freshness", () => {
  it("refuses a captured request replayed after a restart", async () => {
    const s = await setupApp(false);
    const capturedAt = Date.now();
    const headers = await signRequest(s.keys.seed, "human", "GET", URL, "", capturedAt);
    expect((await s.app.inject({ method: "GET", url: URL, headers })).statusCode).toBe(200);
    await s.app.close();

    // The nonce cache lives in memory, so only the start time can refuse this one.
    const restarted = await buildApp({ dataDir: s.dir, now: () => new Date(capturedAt + 10_000) });
    const res = await restarted.inject({ method: "GET", url: URL, headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("stale");
  });

  it("refuses a request dated before this server started", async () => {
    const s = await setupApp(false);
    const headers = await signRequest(s.keys.seed, "human", "GET", URL, "", Date.now() - 30_000);
    const res = await s.app.inject({ method: "GET", url: URL, headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("stale");
  });

  it("refuses a request dated in the future", async () => {
    const s = await setupApp(false);
    const headers = await signRequest(s.keys.seed, "human", "GET", URL, "", Date.now() + 30_000);
    const res = await s.app.inject({ method: "GET", url: URL, headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("bad_signature");
  });

  it("does not spend a nonce on an agent that is not approved", async () => {
    const s = await setupApp(false);
    const ak = await deriveKeys("agent-secret-xyz", "11".repeat(16), ARGON_FAST);
    const id = (await s.app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker", publicKey: ak.publicKeyHex } })).json().id;
    const before = s.app.ctx.nonces.size;
    const headers = await signRequest(ak.seed, id, "GET", URL, "");
    expect((await s.app.inject({ method: "GET", url: URL, headers })).json().error.code).toBe("pending");
    expect(s.app.ctx.nonces.size).toBe(before);
  });

  it("verifies a multipart upload against the empty string body, not its bytes", async () => {
    const s = await setupApp(false);
    const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
    const t = (await s.human("POST", "/api/v1/tickets", { projectId: project.id, title: "x" })).json;
    const body = multipart({ ticketId: t.id }, { name: "a.txt", mime: "text/plain", bytes: Buffer.from("hi") });

    const okHeaders = { ...(await signRequest(s.keys.seed, "human", "POST", "/api/v1/attachments", "")), "content-type": body.contentType };
    const ok = await s.app.inject({ method: "POST", url: "/api/v1/attachments", payload: body.body, headers: okHeaders });
    expect(ok.statusCode).toBe(200);

    const badHeaders = { ...(await signRequest(s.keys.seed, "human", "POST", "/api/v1/attachments", body.body.toString("utf8"))), "content-type": body.contentType };
    const bad = await s.app.inject({ method: "POST", url: "/api/v1/attachments", payload: body.body, headers: badHeaders });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe("bad_signature");
  });
});
