import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import * as d from "@boomerang/db";
import { agentIn, setupApp } from "./test/helpers";
import { OutboxWorker } from "./workers/outbox";
import { openSecret } from "./workers/secrets";

const HEX64 = /^[0-9a-f]{64}$/;
const servers: { close: () => Promise<void> }[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

function fakeDestination(): Promise<{ url: string; received: { headers: IncomingMessage["headers"]; body: string }[]; close: () => Promise<void> }> {
  const received: { headers: IncomingMessage["headers"]; body: string }[] = [];
  const server = createServer((req, res) => { let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { received.push({ headers: req.headers, body }); res.end("ok"); }); });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    const out = { url: `http://127.0.0.1:${port}/hook`, received, close: () => new Promise<void>((r) => server.close(() => r())) };
    servers.push(out); resolve(out);
  }));
}
const sig = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

async function world(encryption = false) {
  const s = await setupApp(encryption);
  const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
  const { agent } = await agentIn(s, project.id);
  return { s, project, agent, db: () => s.app.ctx.db! };
}

describe("destinations", () => {
  it("creates a destination showing the secret once, lists without it, patches, and archives", async () => {
    const w = await world();
    const created = await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "Slack bridge", url: "https://example.com/hook" });
    expect(created.status).toBe(200);
    expect(created.json.secret).toMatch(HEX64);
    expect(created.json).toMatchObject({ projectId: w.project.id, name: "Slack bridge", url: "https://example.com/hook", archived: false });
    const list = await w.s.human("GET", `/api/v1/destinations?projectId=${w.project.id}`);
    expect(list.status).toBe(200);
    expect(list.json).toHaveLength(1);
    expect(list.json[0]).not.toHaveProperty("secret");
    expect(JSON.stringify(list.json)).not.toContain(created.json.secret);
    const patched = await w.s.human("PATCH", `/api/v1/destinations/${created.json.id}`, { name: "Bridge", url: "https://example.com/v2" });
    expect(patched.status).toBe(200);
    expect(patched.json).toMatchObject({ name: "Bridge", url: "https://example.com/v2" });
    expect(patched.json).not.toHaveProperty("secret");
    expect((await w.s.human("PATCH", `/api/v1/destinations/${created.json.id}`, { archived: true })).json.archived).toBe(true);
    expect((await w.s.human("GET", `/api/v1/destinations?projectId=${w.project.id}`)).json).toHaveLength(0);
    expect((await w.s.human("GET", `/api/v1/destinations?projectId=${w.project.id}&includeArchived=1`)).json).toHaveLength(1);
    const types = d.listEvents(w.db()).map((e) => e.type);
    expect(types).toContain("destination.created");
    expect(types.filter((t) => t === "destination.updated")).toHaveLength(2);
    expect(JSON.stringify(d.listEvents(w.db()))).not.toContain(created.json.secret);
  });

  it("logs the name and the url's host on create and only the changed keys on update, never the full url", async () => {
    const w = await world();
    const created = (await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "Slack", url: "https://hooks.example.com/services/T0/secretpath?token=abc" })).json;
    expect(created.status ?? 200).toBe(200);
    const events = () => d.listEvents(w.db());
    expect(events().find((e) => e.type === "destination.created")!.payload).toEqual({ id: created.id, projectId: w.project.id, name: "Slack", host: "hooks.example.com" });

    expect((await w.s.human("PATCH", `/api/v1/destinations/${created.id}`, { name: "Slack", url: "https://other.example.com:8443/v2/path?x=1" })).status).toBe(200);
    expect((await w.s.human("PATCH", `/api/v1/destinations/${created.id}`, { name: "Bridge", archived: true })).status).toBe(200);
    const updated = events().filter((e) => e.type === "destination.updated").map((e) => e.payload);
    expect(updated).toEqual([
      { id: created.id, projectId: w.project.id, changed: ["url"], host: "other.example.com:8443" },
      { id: created.id, projectId: w.project.id, changed: ["name", "archived"], name: "Bridge", archived: true },
    ]);
    const text = JSON.stringify(events());
    for (const leak of ["secretpath", "token=abc", "/services", "/v2/path", "x=1"]) expect(text).not.toContain(leak);
  });

  it("keeps names unique per project among live destinations, and refuses urls that carry credentials", async () => {
    const w = await world();
    const first = await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "Slack", url: "https://example.com/a" });
    expect(first.status).toBe(200);
    const dup = await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "Slack", url: "https://example.com/b" });
    expect(dup.status).toBe(400);
    expect(dup.json.error.code).toBe("duplicate_name");
    const second = (await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "Other", url: "https://example.com/c" })).json;
    const renamed = await w.s.human("PATCH", `/api/v1/destinations/${second.id}`, { name: "Slack" });
    expect(renamed.status).toBe(400);
    expect(renamed.json.error.code).toBe("duplicate_name");
    expect((await w.s.human("PATCH", `/api/v1/destinations/${second.id}`, { name: "Other" })).status).toBe(200);
    const other = (await w.s.human("POST", "/api/v1/projects", { name: "O", key: "OO" })).json;
    expect((await w.s.human("POST", "/api/v1/destinations", { projectId: other.project.id, name: "Slack", url: "https://example.com/d" })).status).toBe(200);
    expect((await w.s.human("PATCH", `/api/v1/destinations/${first.json.id}`, { archived: true })).status).toBe(200);
    expect((await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "Slack", url: "https://example.com/e" })).status).toBe(200);
    expect((await w.s.human("PATCH", `/api/v1/destinations/${first.json.id}`, { archived: false })).json.error.code).toBe("duplicate_name");
    const creds = await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "Creds", url: "https://user:pw@example.com/x" });
    expect(creds.status).toBe(400);
    expect((await w.s.human("PATCH", `/api/v1/destinations/${second.id}`, { url: "https://user@example.com/x" })).status).toBe(400);
  });

  it("accepts only http and https urls and requires a project that exists", async () => {
    const w = await world();
    expect((await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "x", url: "ftp://example.com/x" })).status).toBe(400);
    expect((await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "x", url: "not a url" })).status).toBe(400);
    expect((await w.s.human("POST", "/api/v1/destinations", { projectId: "nope", name: "x", url: "https://example.com/x" })).status).toBe(404);
    expect((await w.s.human("GET", "/api/v1/destinations?projectId=nope")).status).toBe(404);
    expect((await w.s.human("PATCH", "/api/v1/destinations/nope", { name: "y" })).status).toBe(404);
  });

  it("is human only: an agent gets 403 on every destination route", async () => {
    const w = await world();
    const created = (await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "x", url: "https://example.com/x" })).json;
    expect((await w.agent("GET", `/api/v1/destinations?projectId=${w.project.id}`)).status).toBe(403);
    expect((await w.agent("POST", "/api/v1/destinations", { projectId: w.project.id, name: "y", url: "https://example.com/y" })).status).toBe(403);
    expect((await w.agent("PATCH", `/api/v1/destinations/${created.id}`, { name: "z" })).status).toBe(403);
    expect((await w.agent("POST", `/api/v1/destinations/${created.id}/rotate`)).status).toBe(403);
    expect((await w.agent("POST", `/api/v1/destinations/${created.id}/test`)).status).toBe(403);
    expect((await w.agent("PATCH", "/api/v1/destinations/nope", { name: "z" })).status).toBe(403);
  });

  it("rotates the secret: the new one is shown once and signs the next delivery, the old one no longer does", async () => {
    const w = await world();
    const dest = await fakeDestination();
    const created = (await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "x", url: dest.url })).json;
    const worker = new OutboxWorker(w.s.app.ctx, { allowPrivate: true });
    const first = await w.s.human("POST", `/api/v1/destinations/${created.id}/test`);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ destinationId: created.id, attempts: 0 });
    await worker.tick();
    expect(dest.received).toHaveLength(1);
    expect(dest.received[0].headers["x-boomerang-signature"]).toBe(sig(created.secret, dest.received[0].body));
    expect(dest.received[0].headers["x-boomerang-event"]).toBe("destination.test");
    expect(JSON.parse(dest.received[0].body).payload).toMatchObject({ test: true, destinationId: created.id });
    const rotated = await w.s.human("POST", `/api/v1/destinations/${created.id}/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.json.secret).toMatch(HEX64);
    expect(rotated.json.secret).not.toBe(created.secret);
    expect(d.listEvents(w.db()).filter((e) => e.type === "destination.rotated")).toHaveLength(1);
    await w.s.human("POST", `/api/v1/destinations/${created.id}/test`);
    await worker.tick();
    expect(dest.received).toHaveLength(2);
    expect(dest.received[1].headers["x-boomerang-signature"]).toBe(sig(rotated.json.secret, dest.received[1].body));
    expect(dest.received[1].headers["x-boomerang-signature"]).not.toBe(sig(created.secret, dest.received[1].body));
    expect((await w.s.human("POST", `/api/v1/destinations/nope/rotate`)).status).toBe(404);
  });

  it("stores the secret sealed under the server's key when encryption is on", async () => {
    const w = await world(true);
    const created = (await w.s.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "x", url: "https://example.com/x" })).json;
    const stored = d.getDestinationSecret(w.db(), created.id)!;
    expect(stored).not.toBe(created.secret);
    expect(stored).not.toContain(created.secret);
    expect(openSecret(w.s.app.ctx.fileKey, stored)).toBe(created.secret);
  });
});
