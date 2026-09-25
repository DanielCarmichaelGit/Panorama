/// <reference path="../../server/src/types/fastify.d.ts" />
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AGENT_ACTIONS, ARGON_FAST, deriveKeys, signRequest } from "@boomerang/core";
import { buildApp } from "../../server/src/app";
import { BoomerangClient } from "./client";
import { loadConfig, loadOrCreateKey, readKey } from "./config";
import { HOWTO_URI } from "./howto";
import { buildServer, MAX_PAYLOAD_CHARS } from "./tools";

// The real server on a port of its own with a temporary data directory and the fast KDF,
// the way the e2e harness starts one; the MCP server talks to it over HTTP through the same
// client code the boomerang-mcp bin uses, and this test drives that through an MCP client.

const tempDirs: string[] = [];
const tmp = (p: string) => {
  const dir = mkdtempSync(join(tmpdir(), p));
  tempDirs.push(dir);
  return dir;
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let app: Awaited<ReturnType<typeof buildApp>>;
let url: string;
let human: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>;
let mcp: Client;
let keyFile: string;
let agentName: string;
let project: { id: string; key: string; name: string };
let lanes: { id: string; name: string }[];

const laneId = (name: string) => lanes.find((l) => l.name === name)!.id;

async function tool(name: string, args: Record<string, unknown> = {}) {
  const res = await mcp.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
  return { isError: res.isError === true, text, json: res.isError ? null : JSON.parse(text) };
}

beforeAll(async () => {
  app = await buildApp({ dataDir: tmp("bm-mcp-data-"), allowFastKdf: true });
  await app.listen({ host: "127.0.0.1", port: 0 });
  url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

  const keys = await deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST);
  human = async (method, path, body) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = { ...(await signRequest(keys.seed, "human", method, path, payload)) };
    if (payload) headers["content-type"] = "application/json";
    const res = await fetch(url + path, { method, headers, body: payload || undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const setup = await human("POST", "/api/v1/setup", { publicKey: keys.publicKeyHex, kdfSalt: "00".repeat(16), argon: ARGON_FAST, encryption: true, dbKey: keys.dbKeyHex });
  if (setup.status !== 200) throw new Error(`setup failed: ${JSON.stringify(setup.json)}`);

  const created = await human("POST", "/api/v1/projects", { name: "Demo", key: "DEMO" });
  project = created.json.project;
  lanes = (await human("GET", `/api/v1/projects/${project.id}/lanes`)).json;
  const described = await human("PUT", `/api/v1/lanes/${laneId("Ready for Production")}/requirements`, {
    requirements: [{ typeId: "et_eval_score", count: 1, description: "A run of the eval suite at or above the threshold" }],
  });
  if (described.status !== 200) throw new Error(`requirements failed: ${JSON.stringify(described.json)}`);

  const home = tmp("bm-mcp-home-");
  const config = loadConfig({ BOOMERANG_URL: url, BOOMERANG_AGENT_NAME: "contract-agent" }, home, "host");
  keyFile = config.keyFile;
  agentName = config.name;
  const { key } = loadOrCreateKey(config.keyFile);
  const server = buildServer(new BoomerangClient(config, key));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  mcp = new Client({ name: "contract-test", version: "0" });
  await mcp.connect(clientSide);
}, 30_000);

afterAll(async () => {
  await mcp?.close();
  await app?.close();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("MCP contract", () => {
  it("registers on the first call, reports pending, and refuses every other tool until approved", async () => {
    const status = await tool("boomerang_status");
    expect(status.isError).toBe(false);
    expect(status.json.server.state).toBe("unlocked");
    expect(status.json.agent.approval).toBe("pending");
    expect(status.json.agent.requestedScopes).toEqual({ projects: "*", actions: [...AGENT_ACTIONS] });
    expect(status.json.message).toBe(`Waiting for the owner to approve agent ${agentName} on the Agents page`);
    // The id the server gave the key is remembered beside the seed, and nothing else is.
    const stored = JSON.parse(readFileSync(keyFile, "utf8"));
    expect(stored.id).toBe(status.json.agent.id);
    expect(Object.keys(stored).sort()).toEqual(["id", "seed", "version"]);

    const refused = await tool("boomerang_projects");
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(`Waiting for the owner to approve agent ${agentName} on the Agents page`);
  });

  it("works once the owner approves it with a signed call", async () => {
    const agentId = (await tool("boomerang_status")).json.agent.id;
    const approved = await human("POST", `/api/v1/agents/${agentId}/approve`, { scopes: { projects: "*", actions: [...AGENT_ACTIONS] } });
    expect(approved.status).toBe(200);
    expect((await tool("boomerang_status")).json.agent.approval).toBe("active");
    expect((await tool("boomerang_projects")).json.map((p: any) => p.key)).toEqual(["DEMO"]);
    const lanesOut = await tool("boomerang_lanes", { projectId: "DEMO" });
    expect(lanesOut.json.find((l: any) => l.name === "Ready for Production").requires).toEqual([
      { typeId: "et_eval_score", type: "Eval score", count: 1, description: "A run of the eval suite at or above the threshold" },
    ]);
    expect((await tool("boomerang_evidence_types")).json.find((t: any) => t.id === "et_screenshot").needsAttachment).toBe(true);
  });

  it("takes the oldest ticket waiting in Ready and claims it, with the gate summary describing what is missing", async () => {
    expect((await tool("boomerang_next_ticket", { projectId: project.id })).json).toMatchObject({ ticket: null, message: "Nothing is waiting in Ready for Demo" });
    const first = (await human("POST", "/api/v1/tickets", { projectId: project.id, title: "Wire outbox retries", laneId: laneId("Ready") })).json;
    await human("POST", "/api/v1/tickets", { projectId: project.id, title: "Second in line", laneId: laneId("Ready") });

    const next = await tool("boomerang_next_ticket", { projectId: project.id, claim: true });
    expect(next.isError).toBe(false);
    expect(next.json.claimed).toBe(true);
    expect(next.json.waiting).toBe(2);
    expect(next.json.ticket.key).toBe(first.key);
    expect(next.json.ticket.lane).toBe("Ready");
    expect(next.json.ticket.assigneeId).toBe((await tool("boomerang_status")).json.agent.id);
    const gate = next.json.ticket.gates.find((g: any) => g.lane === "Ready for Production");
    expect(gate.canEnter).toBe(false);
    expect(gate.missing).toEqual([{ typeId: "et_eval_score", name: "Eval score", need: 1, have: 0, description: "A run of the eval suite at or above the threshold" }]);
    expect(next.json.ticket.gates.find((g: any) => g.lane === "In Progress").canEnter).toBe(true);

    // Claimed means assigned, so the next call skips it.
    expect((await tool("boomerang_next_ticket", { projectId: project.id })).json.ticket.title).toBe("Second in line");
  });

  it("moves by lane name, comments in markdown, and records evidence with an uploaded attachment", async () => {
    const moved = await tool("boomerang_move", { ticketId: "DEMO-1", lane: "in progress" });
    expect(moved.isError).toBe(false);
    expect(moved.json.lane).toBe("In Progress");
    expect(moved.json.message).toBe("DEMO-1 is now in In Progress");

    const comment = await tool("boomerang_comment", { ticketId: "DEMO-1", body: "## Test run\n\nAll 212 tests pass." });
    expect(comment.isError).toBe(false);
    expect(comment.json.body).toContain("212 tests");

    const tests = await tool("boomerang_add_evidence", { ticketId: "DEMO-1", type: "Test run", payload: { passed: 212, failed: 0 }, commentId: comment.json.id });
    expect(tests.isError).toBe(false);
    expect(tests.json).toMatchObject({ type: "Test run", typeId: "et_test_run", result: "pass", commentId: comment.json.id });

    const shot = await tool("boomerang_add_evidence", { ticketId: "DEMO-1", type: "Screenshot", payload: { note: "The board after the move" }, attachment: { filename: "board.png", mime: "image/png", base64: PNG.toString("base64") } });
    expect(shot.isError).toBe(false);
    expect(shot.json.attachmentId).toEqual(expect.any(String));
    const meta = await human("GET", `/api/v1/attachments/${shot.json.attachmentId}/meta`);
    expect(meta.json).toMatchObject({ filename: "board.png", mime: "image/png", size: PNG.length, isImage: true });

    const view = await tool("boomerang_ticket", { ticketId: "DEMO-1" });
    expect(view.json.evidence.map((e: any) => e.type)).toEqual(["Test run", "Screenshot"]);
    expect(view.json.comments).toHaveLength(1);
  });

  it("turns a gate refusal into an error naming each missing requirement, its description, and the blocker", async () => {
    const refused = await tool("boomerang_move", { ticketId: "DEMO-1", lane: "Ready for Production" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(
      ["Ready for Production needs evidence first", "- Eval score (0 of 1). It should show: A run of the eval suite at or above the threshold"].join("\n")
    );

    const blocker = await tool("boomerang_create_ticket", { projectId: "DEMO", title: "Land the retry schema", description: "The schema the retries need" });
    expect(blocker.isError).toBe(false);
    expect(blocker.json.description).toBe("The schema the retries need");
    const link = await tool("boomerang_link", { ticketId: blocker.json.key, toId: "DEMO-1", kind: "blocks" });
    expect(link.isError).toBe(false);
    expect(link.json.reads).toBe(`${blocker.json.key} blocks DEMO-1`);

    const done = await tool("boomerang_move", { ticketId: "DEMO-1", lane: "Done" });
    expect(done.isError).toBe(true);
    expect(done.text).toContain("Done needs evidence first");
    expect(done.text).toContain("- Human sign-off (0 of 1)");
    expect(done.text).toContain(`- Blocked by ${blocker.json.key}: that ticket must reach a done lane first`);

    const signoff = await tool("boomerang_add_evidence", { ticketId: "DEMO-1", type: "Human sign-off", payload: {} });
    expect(signoff.isError).toBe(true);
    expect(signoff.text).toBe("Human sign-off is human only: leave a comment asking the owner for it");
  });

  it("lets the move through once the evidence is there, and says when the lane flags a human", async () => {
    const score = await tool("boomerang_add_evidence", { ticketId: "DEMO-1", type: "et_eval_score", payload: { score: 0.94 } });
    expect(score.json.result).toBe("pass");
    const moved = await tool("boomerang_move", { ticketId: "DEMO-1", lane: "Ready for Production" });
    expect(moved.isError).toBe(false);
    expect(moved.json.lane).toBe("Ready for Production");
    expect(moved.json.flags).toContain("needs_human");
    expect(moved.json.message).toContain("flagged needs_human");
  });

  it("updates, searches, names what it cannot find, and answers a heartbeat", async () => {
    const updated = await tool("boomerang_update_ticket", { ticketId: "DEMO-1", title: "Wire outbox retries with backoff", description: "Retries back off exponentially" });
    expect(updated.isError).toBe(false);
    expect(updated.json).toMatchObject({ title: "Wire outbox retries with backoff", description: "Retries back off exponentially" });

    const noTag = await tool("boomerang_update_ticket", { ticketId: "DEMO-1", tags: ["demo"] });
    expect(noTag.isError).toBe(true);
    expect(noTag.text).toBe("No tag named demo in this project (tags are created by the owner in Settings). Available: none");

    const noLane = await tool("boomerang_move", { ticketId: "DEMO-1", lane: "Shipping" });
    expect(noLane.isError).toBe(true);
    expect(noLane.text).toMatch(/^No lane named Shipping in this project\. Available: Backlog, Ready, In Progress, Eval, Ready for Production, Done$/);

    const byText = await tool("boomerang_search_tickets", { projectId: "DEMO", text: "backoff" });
    expect(byText.json.map((t: any) => t.key)).toEqual(["DEMO-1"]);
    const byLane = await tool("boomerang_search_tickets", { projectId: "DEMO", lane: "Ready" });
    expect(byLane.json.map((t: any) => t.title)).toEqual(["Second in line"]);
    const flagged = await tool("boomerang_search_tickets", { projectId: "DEMO", flag: "needs_human" });
    expect(flagged.json.map((t: any) => t.key)).toEqual(["DEMO-1"]);

    const beat = await tool("boomerang_heartbeat");
    expect(beat.json).toMatchObject({ ok: true, lastSeen: expect.any(String) });

    const howto = await mcp.readResource({ uri: HOWTO_URI });
    expect((howto.contents[0] as { text: string }).text).toContain("boomerang_next_ticket");
  });

  it("raises a flag, and only the owner may clear needs_human", async () => {
    const raised = await tool("boomerang_set_flag", { ticketId: "DEMO-2", flag: "needs_human", on: true });
    expect(raised.isError).toBe(false);
    expect(raised.json.flags).toContain("needs_human");
    expect(raised.json.message).toBe("DEMO-2 is now flagged needs_human");
    const cleared = await tool("boomerang_set_flag", { ticketId: "DEMO-2", flag: "needs_human", on: false });
    expect(cleared.isError).toBe(true);
    expect(cleared.text).toBe("This key may not perform flag.clear_needs_human (forbidden)");
    // Any other flag an agent raises it may also lower.
    expect((await tool("boomerang_set_flag", { ticketId: "DEMO-2", flag: "waiting_on_ci", on: true })).json.flags).toContain("waiting_on_ci");
    const lowered = await tool("boomerang_set_flag", { ticketId: "DEMO-2", flag: "waiting_on_ci", on: false });
    expect(lowered.json.flags).not.toContain("waiting_on_ci");
    expect(lowered.json.message).toBe("DEMO-2 is no longer flagged waiting_on_ci");
  });

  it("uploads an attachment on its own so a comment can carry it", async () => {
    const up = await tool("boomerang_upload_attachment", { ticketId: "DEMO-2", filename: "notes.md", mime: "text/markdown", base64: Buffer.from("# Notes\n").toString("base64") });
    expect(up.isError).toBe(false);
    expect(up.json).toMatchObject({ filename: "notes.md", mime: "text/markdown", size: 8, id: expect.any(String) });
    const comment = await tool("boomerang_comment", { ticketId: "DEMO-2", body: "Notes attached.", attachmentIds: [up.json.id] });
    expect(comment.isError).toBe(false);
    expect(comment.json.attachmentIds).toEqual([up.json.id]);
    const view = await tool("boomerang_ticket", { ticketId: "DEMO-2" });
    expect(view.json.attachments).toEqual([expect.objectContaining({ id: up.json.id, filename: "notes.md", commentId: comment.json.id })]);
  });

  it("refuses unknown arguments, an unwanted media type and an oversized payload before any request", async () => {
    const unknown = await tool("boomerang_ticket", { ticketId: "DEMO-1", bogus: 1 });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/bogus/);
    const mime = await tool("boomerang_upload_attachment", { ticketId: "DEMO-2", filename: "run.sh", mime: "application/x-sh", base64: "IyEvYmluL3NoCg==" });
    expect(mime.isError).toBe(true);
    expect(mime.text).toMatch(/mime/);
    const big = await tool("boomerang_add_evidence", { ticketId: "DEMO-2", type: "Test run", payload: { passed: 1, failed: 0, output: "x".repeat(MAX_PAYLOAD_CHARS) } });
    expect(big.isError).toBe(true);
    expect(big.text).toContain(`larger than ${MAX_PAYLOAD_CHARS} characters`);
  });

  it("registers once for a burst of concurrent calls, and picks up an id another process stored", async () => {
    const config = loadConfig({ BOOMERANG_URL: url, BOOMERANG_AGENT_NAME: "burst-agent" }, tmp("bm-mcp-home-"), "host");
    const { key } = loadOrCreateKey(config.keyFile);
    let registrations = 0;
    const counting: typeof fetch = (input, init) => {
      if (init?.method === "POST" && String(input).endsWith("/api/v1/agents/register")) registrations += 1;
      return fetch(input, init);
    };
    const burst = new BoomerangClient(config, key, counting);
    const results = await Promise.allSettled([burst.call("GET", "/api/v1/me"), burst.call("GET", "/api/v1/me"), burst.call("GET", "/api/v1/me")]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(results.map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(["pending", "pending", "pending"]);
    expect(registrations).toBe(1);
    expect(readKey(config.keyFile)!.id).toBe(key.id);

    // A second process that read the file before the first registered gets duplicate_key
    // from the server and continues with the id the first one stored.
    const stale = new BoomerangClient(config, { seed: key.seed, id: null }, counting);
    expect(await stale.ensureRegistered()).toBe(key.id);
    expect(registrations).toBe(2);
  });

  it("owns a timer: start, refuse a second start, stop with the duration, refuse a stop with none open", async () => {
    const started = await tool("boomerang_timer_start", { ticketId: "DEMO-2" });
    expect(started.isError).toBe(false);
    expect(started.json).toMatchObject({ key: "DEMO-2", startedAt: expect.any(String), stoppedAt: null, message: expect.stringContaining("Timer running on DEMO-2") });
    const again = await tool("boomerang_timer_start", { ticketId: "DEMO-2" });
    expect(again.isError).toBe(true);
    expect(again.text).toBe("You already have a timer running on this ticket (timer_open)");

    const stopped = await tool("boomerang_timer_stop", { ticketId: "DEMO-2" });
    expect(stopped.isError).toBe(false);
    expect(stopped.json.seconds).toEqual(expect.any(Number));
    expect(stopped.json.message).toBe(`Timer on DEMO-2 stopped after ${stopped.json.duration}`);
    const none = await tool("boomerang_timer_stop", { ticketId: "DEMO-2" });
    expect(none.isError).toBe(true);
    expect(none.text).toBe("You have no timer running on this ticket (timer_not_open)");
  });

  it("reports cost and answers with the ~$ estimate and its price date, keeping an unknown model as tokens only", async () => {
    const priced = await tool("boomerang_report_cost", { ticketId: "DEMO-2", model: "claude-fable-5-1", inputTokens: 200_000, outputTokens: 30_000, cacheReadTokens: 800_000, note: "first turn" });
    expect(priced.isError).toBe(false);
    expect(priced.json).toMatchObject({ key: "DEMO-2", model: "claude-fable-5-1", tokens: 1_030_000, usd: expect.any(Number), priceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), note: "first turn" });
    expect(priced.json.estimate).toMatch(/^~\$\d/);
    expect(priced.json.message).toBe(`DEMO-2: ${priced.json.estimate} for this turn (estimate at ${priced.json.priceDate} prices; actual can be lower)`);

    const unknown = await tool("boomerang_report_cost", { ticketId: "DEMO-2", model: "acme/mystery-9", inputTokens: 10, outputTokens: 5 });
    expect(unknown.isError).toBe(false);
    expect(unknown.json).toMatchObject({ usd: null, estimate: "no price", tokens: 15 });
    expect(unknown.json.message).toBe(`No price for acme/mystery-9 in the table dated ${unknown.json.priceDate}: 15 tokens recorded on DEMO-2 without a figure`);

    const bad = await tool("boomerang_report_cost", { ticketId: "DEMO-2", model: "claude-fable-5-1", inputTokens: -1, outputTokens: 0 });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/inputTokens/);
    // The same cap as the server's CostInput, refused here before any request: the metrics
    // below still count two entries.
    const capped = await tool("boomerang_report_cost", { ticketId: "DEMO-2", model: "claude-fable-5-1", inputTokens: 0, outputTokens: 50_000_001 });
    expect(capped.isError).toBe(true);
    expect(capped.text).toMatch(/outputTokens/);

    const metrics = await tool("boomerang_ticket_metrics", { ticketId: "DEMO-2" });
    expect(metrics.isError).toBe(false);
    expect(metrics.json).toMatchObject({ key: "DEMO-2", estimate: true, priceDate: priced.json.priceDate, openTimers: 0, entries: 2, unpriced: 1, usd: null, known: priced.json.usd, time: expect.stringMatching(/s$/) });
    expect(metrics.json.tokens).toEqual({ input: 200_010, output: 30_005, cacheRead: 800_000, cacheWrite: 0, total: 1_030_015 });
    expect(metrics.json.spend).toBe(`at least ${priced.json.estimate} from the priced entries; 1 entry is from a model the price table dated ${priced.json.priceDate} does not know, so the total is tokens only (1030015)`);
    expect(metrics.json.byModel.map((x: any) => [x.model, x.usd === null, x.spend.startsWith("~$")])).toEqual([["claude-fable-5-1", false, true], ["acme/mystery-9", true, false]]);
    expect(metrics.json.byActor).toHaveLength(1);
    expect(metrics.json.byActor[0]).toMatchObject({ actorId: (await tool("boomerang_status")).json.agent.id, name: agentName, entries: 2, seconds: expect.any(Number) });

    const howto = await mcp.readResource({ uri: HOWTO_URI });
    expect((howto.contents[0] as { text: string }).text).toContain("boomerang_report_cost after each turn");
  });

  it("reports a locked server as one sentence", async () => {
    expect((await human("POST", "/api/v1/lock")).status).toBe(200);
    const locked = await tool("boomerang_projects");
    expect(locked.isError).toBe(true);
    expect(locked.text).toBe("Boomerang is locked. Ask the owner to unlock it.");
    const status = await tool("boomerang_status");
    expect(status.json.server.state).toBe("locked");
    expect(status.json.message).toBe("Boomerang is locked. Ask the owner to unlock it.");
  });
});
