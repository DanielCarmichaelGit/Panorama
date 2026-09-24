import { publicKeyFromSeed, signRequest } from "@panorama/core";

const BASE = process.env.PANORAMA_URL ?? "http://127.0.0.1:4400";
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

const refused = await call("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lane("Ready for Production") });
if (refused.status !== 422) throw new Error(`expected a gate refusal, got ${refused.status}: ${JSON.stringify(refused.json)}`);
for (const m of refused.json.error.details.missing) {
  console.log(`Gate refused: ${m.name}, ${m.have} of ${m.need}`);
}

await call("POST", "/api/v1/comments", { ticketId: t.id, body: "## Test run\n\nAll 212 tests pass." });
await call("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_test_run", payload: { passed: 212, failed: 0 } });
await call("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_eval_score", payload: { score: 0.94 } });

const done = (await call("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lane("Ready for Production") })).json;
console.log(`Moved ${t.key} to Ready for Production. Flags: ${done.flags.join(", ")}`);
