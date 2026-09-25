import { publicKeyFromSeed, signRequest } from "@boomerang/core";

// A worked example of an agent talking to Boomerang over REST. It generates a key, registers,
// waits for a human to approve it, then walks one ticket through the model: a tag, a blocking
// dependency and the gate refusal it causes, a gated move refused for missing evidence, the
// evidence itself, and finally the move succeeding. BOOMERANG_URL points it at a server (default
// 127.0.0.1:4400) and AGENT_NAME names the key it registers (default demo-agent).

const BASE = process.env.BOOMERANG_URL ?? "http://127.0.0.1:4400";
const NAME = process.env.AGENT_NAME ?? "demo-agent";
const seed = crypto.getRandomValues(new Uint8Array(32));
let actorId = "";

async function call(method: string, path: string, body?: unknown, signed = true) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = signed ? { ...(await signRequest(seed, actorId, method, path, payload)) } : {};
  if (payload) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: payload || undefined });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const reg = await call("POST", "/api/v1/agents/register", { name: NAME, publicKey: await publicKeyFromSeed(seed) }, false);
if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.json)}`);
actorId = reg.json.id;
console.log(`Registered as ${actorId}. Approve "${NAME}" in the Agents view.`);

for (let i = 0; ; i++) {
  if ((await call("GET", "/api/v1/me")).status === 200) break;
  if (i >= 120) throw new Error("not approved in time");
  await new Promise((r) => setTimeout(r, 1000));
}

const project = (await call("GET", "/api/v1/projects")).json[0];
const lanes = (await call("GET", `/api/v1/projects/${project.id}/lanes`)).json;
const lane = (name: string) => lanes.find((l: any) => l.name === name).id;

const t = (await call("POST", "/api/v1/tickets", { projectId: project.id, title: "Demo: wire outbox retries", metadata: { tokens: 18422 } })).json;
console.log(`Created ${t.key}`);
await call("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lane("In Progress") });

// Tags are defined by a human in Settings (POST /api/v1/tags needs tag.edit, which no agent key
// carries), so the agent applies the project's "demo" tag when one exists and says so when not.
// Applying a tag is a ticket update, which the agent's ticket.update scope covers.
const tags = (await call("GET", `/api/v1/tags?projectId=${project.id}`)).json as { id: string; name: string; archived: boolean }[];
const demoTag = tags.find((tag) => !tag.archived && tag.name.toLowerCase() === "demo");
if (demoTag) {
  const tagged = await call("PATCH", `/api/v1/tickets/${t.id}`, { tagIds: [demoTag.id] });
  if (tagged.status !== 200) throw new Error(`tagging failed: ${JSON.stringify(tagged.json)}`);
  console.log(`Tagged ${t.key} with "${demoTag.name}"`);
} else {
  console.log(`No "demo" tag in ${project.name} yet: tags are created by a human in Settings, so ${t.key} stays untagged`);
}

// A second ticket that blocks the first. While the link stands, the first ticket cannot enter
// Done from any surface, and the gate names the blocker alongside whatever evidence is missing.
const blocker = (await call("POST", "/api/v1/tickets", { projectId: project.id, title: "Demo: land the retry schema" })).json;
const linked = await call("POST", `/api/v1/tickets/${blocker.id}/links`, { toId: t.id, kind: "blocks" });
if (linked.status !== 200) throw new Error(`link failed: ${JSON.stringify(linked.json)}`);
console.log(`Created ${blocker.key}, which blocks ${t.key}`);

const blocked = await call("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lane("Done") });
if (blocked.status !== 422) throw new Error(`expected the dependency gate to refuse Done, got ${blocked.status}: ${JSON.stringify(blocked.json)}`);
const reasons = blocked.json.error.details.missing as { typeId: string; name: string }[];
if (!reasons.some((m) => m.typeId === "blocked_by" && m.name === `Blocked by ${blocker.key}`)) {
  throw new Error(`the refusal did not name ${blocker.key}: ${JSON.stringify(reasons)}`);
}
for (const m of reasons) console.log(`Gate refused Done: ${m.name}`);

// Removing the link goes through the ticket's own links route (ticket.update); a ticket itself
// an agent may never delete, so the blocker ticket stays behind in Backlog.
const unlinked = await call("DELETE", `/api/v1/tickets/${t.id}/links/${linked.json.id}`);
if (unlinked.status !== 200) throw new Error(`unlink failed: ${JSON.stringify(unlinked.json)}`);
console.log(`Removed the link: ${t.key} is no longer blocked by ${blocker.key}`);

// The 422 lists every unmet requirement, and a requirement carries a description when the lane's
// owner wrote one ("A run of the eval suite at or above the threshold"): that is what tells an
// agent what to provide next, so it is printed alongside the count.
const refused = await call("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lane("Ready for Production") });
if (refused.status !== 422) throw new Error(`expected a gate refusal, got ${refused.status}: ${JSON.stringify(refused.json)}`);
for (const m of refused.json.error.details.missing as { name: string; need: number; have: number; description?: string }[]) {
  console.log(`Gate refused: ${m.name}, ${m.have} of ${m.need}${m.description ? `. It should show: ${m.description}` : ""}`);
}

await call("POST", "/api/v1/comments", { ticketId: t.id, body: "## Test run\n\nAll 212 tests pass." });
await call("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_test_run", payload: { passed: 212, failed: 0 } });
await call("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_eval_score", payload: { score: 0.94 } });

const done = (await call("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lane("Ready for Production") })).json;
console.log(`Moved ${t.key} to Ready for Production. Flags: ${done.flags.join(", ")}`);
