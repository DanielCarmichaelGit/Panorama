import { mkdtempSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BoomerangClient } from "../apps/mcp/src/client";
import { loadConfig, loadOrCreateKey } from "../apps/mcp/src/config";
import { buildServer } from "../apps/mcp/src/tools";

// A worked example of an agent talking to Boomerang over MCP. It runs the MCP server from
// apps/mcp in this process (the same code `boomerang-mcp` runs over stdio for Claude Code) and
// drives it through an MCP client, so every step below is a tool call an agent would make. It
// generates a key, registers, waits for a human to approve it, then walks one ticket through the
// model: a tag, a blocking dependency and the gate refusal it causes, a gated move refused for
// missing evidence, a timer and a cost report for the turn, the evidence itself, and finally the
// move succeeding, by its own hand or by a rule the owner drew.
//
// BOOMERANG_URL points it at a server (default 127.0.0.1:4400), AGENT_NAME names the key it
// registers (default demo-agent), and BOOMERANG_MCP_KEY_FILE says where that key is kept. With
// no key file named, a fresh key goes to a temporary directory, so every run registers anew, as
// a first connection does.

const NAME = process.env.AGENT_NAME ?? process.env.BOOMERANG_AGENT_NAME ?? "demo-agent";
const keyFile = process.env.BOOMERANG_MCP_KEY_FILE || join(mkdtempSync(join(tmpdir(), "bm-demo-agent-")), "key.json");
const config = loadConfig({ BOOMERANG_URL: process.env.BOOMERANG_URL, BOOMERANG_AGENT_NAME: NAME, BOOMERANG_MCP_KEY_FILE: keyFile }, homedir(), hostname());
const client = new BoomerangClient(config, loadOrCreateKey(config.keyFile).key);

// The MCP server and client, joined in memory: no second process, no stdio.
const server = buildServer(client);
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const mcp = new Client({ name: "demo-agent", version: "0" });
await mcp.connect(clientSide);

/** One tool call. A tool error comes back as its text, not as a throw, since a refusal is part of the demo. */
async function tool(name: string, args: Record<string, unknown> = {}): Promise<{ error: string | null; json: any }> {
  const res = await mcp.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
  return res.isError ? { error: text, json: null } : { error: null, json: JSON.parse(text) };
}

/** A tool call that must succeed. */
async function must(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await tool(name, args);
  if (r.error !== null) throw new Error(`${name} failed: ${r.error}`);
  return r.json;
}

const actorId = await client.ensureRegistered();
console.log(`Registered as ${actorId}. Approve "${NAME}" in the Agents view.`);
console.log(`The key is in ${config.keyFile}`);

for (let i = 0; ; i++) {
  const status = await must("boomerang_status");
  if (status.agent.approval === "active") break;
  if (i >= 120) throw new Error("not approved in time");
  await new Promise((r) => setTimeout(r, 1000));
}

const project = (await must("boomerang_projects"))[0];

// What a real agent does first: ask for the next ticket waiting in Ready. Nothing waits on a
// fresh install, so the demo makes a ticket of its own to walk through the model.
const next = await must("boomerang_next_ticket", { projectId: project.id });
console.log(next.ticket ? `${next.ticket.key} is waiting in Ready; the demo walks a ticket of its own instead` : next.message);

const t = await must("boomerang_create_ticket", { projectId: project.id, title: "Demo: wire outbox retries" });
console.log(`Created ${t.key}`);
// The Queue row shows a token count kept in the ticket's metadata, which the tools leave to the
// owner, so this one write goes through the signed REST client the tools are built on.
await client.call("PATCH", `/api/v1/tickets/${t.id}`, { metadata: { tokens: 18422 } });
await must("boomerang_move", { ticketId: t.id, lane: "In Progress" });

// Tags are defined by a human in Settings (agents cannot create one), so the agent applies the
// project's "demo" tag when one exists and says so when not.
const tags = await client.call<{ id: string; name: string; archived: boolean }[]>("GET", `/api/v1/tags?projectId=${project.id}`);
const demoTag = tags.find((tag) => !tag.archived && tag.name.toLowerCase() === "demo");
if (demoTag) {
  await must("boomerang_update_ticket", { ticketId: t.id, tags: [demoTag.name] });
  console.log(`Tagged ${t.key} with "${demoTag.name}"`);
} else {
  console.log(`No "demo" tag in ${project.name} yet: tags are created by a human in Settings, so ${t.key} stays untagged`);
}

// A second ticket that blocks the first. While the link stands, the first ticket cannot enter
// Done from any surface, and the gate names the blocker alongside whatever evidence is missing.
const blocker = await must("boomerang_create_ticket", { projectId: project.id, title: "Demo: land the retry schema" });
const link = await must("boomerang_link", { ticketId: blocker.id, toId: t.id, kind: "blocks" });
console.log(`Created ${blocker.key}, which blocks ${t.key}`);

const blocked = await tool("boomerang_move", { ticketId: t.id, lane: "Done" });
if (blocked.error === null) throw new Error(`expected the dependency gate to refuse Done, got ${JSON.stringify(blocked.json)}`);
if (!blocked.error.includes(`Blocked by ${blocker.key}`)) throw new Error(`the refusal did not name ${blocker.key}: ${blocked.error}`);
// The ticket's gate summary carries the same list, structured: one entry per unmet requirement.
const gates = (await must("boomerang_ticket", { ticketId: t.id })).gates as { lane: string; missing: { typeId: string; name: string; need: number; have: number; description: string | null }[] }[];
for (const m of gates.find((g) => g.lane === "Done")!.missing) console.log(`Gate refused Done: ${m.name}`);

// Only the owner can remove a blocks link: an agent may add one but never lift the block that
// gates its own ticket. No tool offers it, and the REST route says no to an agent's key too.
try {
  await client.call("DELETE", `/api/v1/tickets/${t.id}/links/${link.id}`);
  throw new Error("expected the unlink to be refused for an agent");
} catch (e) {
  const err = e as { status?: number; message: string };
  if (err.status !== 403) throw e;
  console.log(`Could not remove the link myself (${err.message}); ${t.key} stays blocked by ${blocker.key} until the owner removes it`);
}

// A gated move is refused with every unmet requirement, and a requirement carries a description
// when the lane's owner wrote one ("A run of the eval suite at or above the threshold"): that is
// what tells an agent what to provide next, so it is printed alongside the count.
const refused = await tool("boomerang_move", { ticketId: t.id, lane: "Ready for Production" });
if (refused.error === null) throw new Error(`expected a gate refusal, got ${JSON.stringify(refused.json)}`);
for (const m of gates.find((g) => g.lane === "Ready for Production")!.missing) {
  console.log(`Gate refused: ${m.name}, ${m.have} of ${m.need}${m.description ? `. It should show: ${m.description}` : ""}`);
}

// The turn that does the work: the timer runs while it lasts, and the cost of the turn is
// reported as the harness counts it. Boomerang prices the tokens from its bundled table and
// answers with an estimate and the date of the prices behind it; nothing here is a bill.
const timer = await must("boomerang_timer_start", { ticketId: t.id });
console.log(timer.message);

await must("boomerang_comment", { ticketId: t.id, body: "## Test run\n\nAll 212 tests pass." });
await must("boomerang_add_evidence", { ticketId: t.id, type: "et_test_run", payload: { passed: 212, failed: 0 } });
await must("boomerang_add_evidence", { ticketId: t.id, type: "et_eval_score", payload: { score: 0.94 } });

const cost = await must("boomerang_report_cost", {
  ticketId: t.id,
  model: "claude-sonnet-5",
  inputTokens: 2417,
  outputTokens: 638,
  cacheReadTokens: 1920,
  cacheWriteTokens: 0,
  note: "posted the test run and the eval score",
});
console.log(`Reported ${cost.tokens} tokens on ${cost.model}: ${cost.estimate} (estimate at ${cost.priceDate} prices; actual can be lower)`);

const stopped = await must("boomerang_timer_stop", { ticketId: t.id });
console.log(stopped.message);

// Into Eval with the evidence on the ticket. An owner's rule may take it from here (a ticket
// moving into Eval with a passing eval score goes on to Ready for Production); when none does,
// the agent makes the move itself, and this time the gate lets it through.
await must("boomerang_move", { ticketId: t.id, lane: "Eval" });
console.log(`Moved ${t.key} to Eval`);
const after = await must("boomerang_ticket", { ticketId: t.id });
if (after.lane === "Ready for Production") {
  console.log(`A rule moved ${t.key} to Ready for Production. Flags: ${after.flags.join(", ")}`);
} else {
  const done = await must("boomerang_move", { ticketId: t.id, lane: "Ready for Production" });
  console.log(`Moved ${t.key} to Ready for Production. Flags: ${done.flags.join(", ")}`);
}

await mcp.close();
