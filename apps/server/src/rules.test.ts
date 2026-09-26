import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyChain } from "@boomerang/core";
import { dueOutbox, getActor, listEvents, listTriggers } from "@boomerang/db";
import { MAX_CREATED, runRules } from "./engine/runRules";
import { agentIn, client, setupApp } from "./test/helpers";
import { MAX_ATTEMPTS, OutboxWorker } from "./workers/outbox";
import { Scheduler } from "./workers/scheduler";

/** A destination on a port of its own that always answers `status`, counting the hits. */
function fakeDestination(status: number): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
  let hits = 0;
  const server = createServer((req, res) => { hits += 1; req.resume(); req.on("end", () => { res.statusCode = status; res.end(); }); });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${port}/hook`, hits: () => hits, close: () => new Promise((r) => server.close(() => r())) });
  }));
}
const servers: { close: () => Promise<void> }[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

// The rule engine and the rules routes (milestone 3, task 4). Rules are created through the
// canvas so the tests exercise the same serialiser the Automations view will: one event node,
// a chain of condition nodes, then the action nodes in a chain after them.

const at = { x: 0, y: 0 };
function canvas(event: Record<string, unknown>, conditions: Record<string, unknown>[], actions: Record<string, unknown>[]) {
  const nodes: any[] = [{ id: "e", kind: "event", position: at, data: event }];
  const edges: any[] = [];
  let last = "e";
  conditions.forEach((c, i) => {
    nodes.push({ id: `c${i}`, kind: "condition", position: at, data: c });
    edges.push({ id: `${last}-c${i}`, source: last, target: `c${i}` });
    last = `c${i}`;
  });
  actions.forEach((a, i) => {
    nodes.push({ id: `a${i}`, kind: "action", position: at, data: a });
    edges.push({ id: `${last}-a${i}`, source: last, target: `a${i}` });
    last = `a${i}`;
  });
  return { nodes, edges };
}
const scheduled = (cron: string, action: Record<string, unknown>) => ({
  nodes: [
    { id: "s", kind: "schedule", position: at, data: { cron, timezone: "UTC" } },
    { id: "a0", kind: "action", position: at, data: action },
  ],
  edges: [{ id: "s-a0", source: "s", target: "a0" }],
});

async function world() {
  const s = await setupApp();
  const { project, lanes } = (await s.human("POST", "/api/v1/projects", { name: "Boomerang", key: "PAN" })).json;
  const { agent, agentId } = await agentIn(s, project.id);
  const lane = (name: string) => lanes.find((l: any) => l.name === name);
  const rule = async (name: string, event: Record<string, unknown>, conditions: Record<string, unknown>[], actions: Record<string, unknown>[], enabled = true) => {
    const r = await s.human("POST", "/api/v1/rules", { projectId: project.id, name, enabled, canvas: canvas(event, conditions, actions) });
    if (r.status !== 200) throw new Error(`rule ${name}: ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const ticket = async (id: string) => (await s.human("GET", `/api/v1/tickets/${id}`)).json;
  const runs = async (ruleId: string) => (await s.human("GET", `/api/v1/rules/${ruleId}/runs`)).json;
  const events = () => listEvents(s.app.ctx.db!);
  return { ...s, project, lanes, lane, agent, agentId, rule, ticket, runs, events };
}

describe("rules routes", () => {
  it("creates a rule from a canvas, lists it, patches it with changed[], and deletes it", async () => {
    const w = await world();
    const r = await w.rule("Done goes to eval", { type: "ticket.moved", toLaneId: w.lane("Done").id }, [], [{ type: "move_to_lane", laneId: w.lane("Eval").id }]);
    expect(r).toMatchObject({ projectId: w.project.id, name: "Done goes to eval", enabled: true, event: { type: "ticket.moved", toLaneId: w.lane("Done").id }, conditions: [], actions: [{ type: "move_to_lane", laneId: w.lane("Eval").id }] });
    expect(r.canvas.nodes.map((n: any) => n.id)).toEqual(["e", "a0"]);
    const listed = (await w.human("GET", `/api/v1/rules?projectId=${w.project.id}`)).json;
    expect(listed.map((x: any) => x.id)).toEqual([r.id]);
    expect(listed[0]).toMatchObject({ runCount: 0, lastFiredAt: null });

    const patched = await w.human("PATCH", `/api/v1/rules/${r.id}`, { name: "Build done goes to eval", enabled: false });
    expect(patched.json).toMatchObject({ name: "Build done goes to eval", enabled: false });
    const updated = w.events().find((e) => e.type === "rule.updated")!;
    expect(updated.payload).toMatchObject({ id: r.id, projectId: w.project.id, changed: ["name", "enabled"] });

    expect((await w.human("DELETE", `/api/v1/rules/${r.id}`)).json).toEqual({ ok: true });
    expect((await w.human("GET", `/api/v1/rules/${r.id}/runs`)).status).toBe(404);
    expect(w.events().map((e) => e.type).slice(-3)).toEqual(["rule.created", "rule.updated", "rule.deleted"]);
  });

  it("keeps rule writes human only: an agent gets 403 on create, patch and delete but may read", async () => {
    const w = await world();
    const doc = canvas({ type: "ticket.created" }, [], [{ type: "set_flag", flag: "blocked" }]);
    expect((await w.agent("POST", "/api/v1/rules", { projectId: w.project.id, name: "nope", enabled: true, canvas: doc })).status).toBe(403);
    const r = await w.rule("Flag new tickets", { type: "ticket.created" }, [], [{ type: "set_flag", flag: "blocked" }]);
    expect((await w.agent("PATCH", `/api/v1/rules/${r.id}`, { name: "still nope" })).status).toBe(403);
    expect((await w.agent("DELETE", `/api/v1/rules/${r.id}`)).status).toBe(403);
    expect((await w.agent("GET", `/api/v1/rules?projectId=${w.project.id}`)).json.map((x: any) => x.id)).toEqual([r.id]);
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    expect((await w.agent("GET", `/api/v1/rules?projectId=${other.project.id}`)).status).toBe(403);
  });

  it("refuses a canvas the engine cannot run with canvas_invalid and the named errors", async () => {
    const w = await world();
    const missing = canvas({ type: "ticket.created" }, [], [{ type: "move_to_lane", laneId: "" }]);
    const r = await w.human("POST", "/api/v1/rules", { projectId: w.project.id, name: "Broken", enabled: true, canvas: missing });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("canvas_invalid");
    expect(r.json.error.details.errors).toEqual([{ name: "missing_target:a0", code: "missing_target", nodeId: "a0" }]);

    const ok = await w.rule("Fine", { type: "ticket.created" }, [], [{ type: "set_flag", flag: "blocked" }]);
    const twoEvents = canvas({ type: "ticket.created" }, [], []);
    twoEvents.nodes.push({ id: "e2", kind: "event", position: at, data: { type: "comment.added" } });
    twoEvents.edges.push({ id: "e-e2", source: "e", target: "e2" });
    const p = await w.human("PATCH", `/api/v1/rules/${ok.id}`, { canvas: twoEvents });
    expect(p.status).toBe(400);
    expect(p.json.error.details.errors.map((e: any) => e.code)).toEqual(["two_events"]);
    expect(w.events().filter((e) => e.type === "rule.updated")).toHaveLength(0);
  });

  it("dry runs a rule against a ticket without writing anything", async () => {
    const w = await world();
    const rfp = w.lane("Ready for Production");
    const r = await w.rule("Straight to production", { type: "ticket.created" }, [{ kind: "lane", op: "is", value: w.lane("Backlog").id }], [{ type: "move_to_lane", laneId: rfp.id }, { type: "add_comment", body: "{{ticket.key}} arrived" }], false);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Try me" })).json;
    const before = w.events().length;
    const res = await w.human("POST", `/api/v1/rules/${r.id}/test`, { ticketId: t.id });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      matched: true,
      nodeIds: ["e", "c0", "a0", "a1"],
      actions: [{ type: "move_to_lane", laneId: rfp.id }, { type: "add_comment", body: "PAN-1 arrived" }],
      refusals: [{ action: 0, laneId: rfp.id, missing: [{ typeId: "et_eval_score", name: "Eval score", need: 1, have: 0 }] }],
    });
    expect(w.events().length).toBe(before);
    expect(await w.runs(r.id)).toEqual([]);
    expect((await w.ticket(t.id)).laneId).toBe(w.lane("Backlog").id);

    const elsewhere = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Elsewhere", laneId: w.lane("In Progress").id })).json;
    const miss = (await w.human("POST", `/api/v1/rules/${r.id}/test`, { ticketId: elsewhere.id })).json;
    expect(miss).toEqual({ matched: false, nodeIds: ["e"], actions: [], refusals: [] });
  });
});

describe("rule engine", () => {
  it("runs the owner's pipeline end to end, every step in the chain with causedBy", async () => {
    const w = await world();
    const done = w.lane("Done"), evalLane = w.lane("Eval"), rfp = w.lane("Ready for Production"), inProgress = w.lane("In Progress");
    const r1 = await w.rule("Build done goes to eval", { type: "ticket.moved", toLaneId: done.id }, [], [{ type: "move_to_lane", laneId: evalLane.id }]);
    const r2 = await w.rule("Eval pass ships", { type: "evidence.added", typeId: "et_eval_score", result: "pass" }, [{ kind: "lane", op: "is", value: evalLane.id }], [{ type: "move_to_lane", laneId: rfp.id }]);
    const r3 = await w.rule("Second eval fail goes back", { type: "evidence.added", typeId: "et_eval_score", result: "fail" }, [{ kind: "evidence", typeId: "et_eval_score", result: "fail", op: "gte", count: 2 }], [{ type: "move_to_lane", laneId: inProgress.id }, { type: "set_flag", flag: "needs_human" }]);

    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Build the thing" })).json;
    expect((await w.human("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_human_signoff", payload: { note: "built" } })).status).toBe(200);
    const moved = await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: done.id });
    expect(moved.status).toBe(200);
    // Rule 1 ran after the move committed: the ticket is already in Eval by the time we look.
    expect((await w.ticket(t.id)).laneId).toBe(evalLane.id);
    const r1Runs = await w.runs(r1.id);
    expect(r1Runs).toHaveLength(1);
    expect(r1Runs[0]).toMatchObject({ ruleId: r1.id, ticketId: t.id, outcome: "applied" });
    const humanMove = w.events().find((e) => e.type === "ticket.moved" && e.actorId === "human")!;
    expect(r1Runs[0].eventSeq).toBe(humanMove.seq);
    const engineMove = w.events().find((e) => e.type === "ticket.moved" && e.actorId === "engine")!;
    expect(engineMove.payload).toMatchObject({ id: t.id, projectId: w.project.id, from: done.id, to: evalLane.id, causedBy: { ruleId: r1.id, runId: r1Runs[0].id, eventSeq: humanMove.seq } });

    // First fail: rule 3's event matches but its condition does not hold yet, which leaves no trace.
    expect((await w.agent("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_eval_score", payload: { score: 0.2 } })).json.result).toBe("fail");
    expect((await w.ticket(t.id))).toMatchObject({ laneId: evalLane.id, flags: [] });
    expect(await w.runs(r3.id)).toEqual([]);
    // Second fail: back to In Progress and flagged for the human.
    await w.agent("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_eval_score", payload: { score: 0.3 } });
    expect((await w.ticket(t.id))).toMatchObject({ laneId: inProgress.id, flags: ["needs_human"] });
    expect((await w.runs(r3.id)).map((x: any) => x.outcome)).toEqual(["applied"]);

    // The human clears the flag and sends it round again; this time the eval passes.
    await w.human("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "needs_human", on: false });
    await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: evalLane.id });
    await w.agent("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_eval_score", payload: { score: 0.97 } });
    expect((await w.ticket(t.id))).toMatchObject({ laneId: rfp.id, flags: ["needs_human"] });
    expect((await w.runs(r2.id)).map((x: any) => x.outcome)).toEqual(["applied"]);

    const listed = (await w.human("GET", `/api/v1/rules?projectId=${w.project.id}`)).json;
    expect(listed.find((x: any) => x.id === r1.id)).toMatchObject({ runCount: 1, lastFiredAt: r1Runs[0].firedAt });
    expect(listed.map((x: any) => x.runCount)).toEqual([1, 1, 1]);

    const fired = w.events().filter((e) => e.type === "rule.fired");
    expect(fired.map((e) => [(e.payload as any).ruleId, (e.payload as any).outcome])).toEqual([[r1.id, "applied"], [r3.id, "applied"], [r2.id, "applied"]]);
    for (const e of fired) expect(e.payload).toMatchObject({ projectId: w.project.id, ticketId: t.id, runId: expect.any(String), eventSeq: expect.any(Number) });
    expect(fired.every((e) => e.actorId === "engine")).toBe(true);
    expect(verifyChain(w.events()).ok).toBe(true);
  });

  it("stops a rule that chases its own tail: the loop guard records skipped and flags needs_human", async () => {
    const w = await world();
    const evalLane = w.lane("Eval"), inProgress = w.lane("In Progress");
    const a = await w.rule("Eval goes back", { type: "ticket.moved", toLaneId: evalLane.id }, [], [{ type: "move_to_lane", laneId: inProgress.id }]);
    const b = await w.rule("In progress goes to eval", { type: "ticket.moved", toLaneId: inProgress.id }, [], [{ type: "move_to_lane", laneId: evalLane.id }]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Ping pong" })).json;
    await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: evalLane.id });
    // a fired (Eval to In Progress), b fired (back to Eval), then a was refused a second fire
    // on the same ticket in the same chain, so the ticket rests in Eval flagged for a human.
    expect(await w.ticket(t.id)).toMatchObject({ laneId: evalLane.id, flags: ["needs_human"] });
    // Both of a's runs share one timestamp (one request), so their order is not defined.
    expect((await w.runs(a.id)).map((x: any) => [x.outcome, x.detail.reason]).sort()).toEqual([["applied", undefined], ["skipped", "chain"]]);
    expect((await w.runs(b.id)).map((x: any) => x.outcome)).toEqual(["applied"]);
    const moves = w.events().filter((e) => e.type === "ticket.moved");
    expect(moves.map((e) => e.actorId)).toEqual(["human", "engine", "engine"]);
    const flagged = w.events().find((e) => e.type === "ticket.flag_set")!;
    expect(flagged.payload).toMatchObject({ id: t.id, flag: "needs_human", cause: "rule", causedBy: { ruleId: a.id } });
  });

  it("refuses the ninth link of a causal chain: depth 8 is a skipped run that flags needs_human", async () => {
    const w = await world();
    // Step i sets f(i+1) when f(i) is set; the human sets f0 and the chain runs out at depth 8.
    const steps = [];
    for (let i = 0; i < 9; i++) steps.push(await w.rule(`Step ${i}`, { type: "ticket.flag_set", flag: `f${i}` }, [], [{ type: "set_flag", flag: `f${i + 1}` }]));
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Deep" })).json;
    await w.human("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "f0", on: true });
    expect((await w.ticket(t.id)).flags).toEqual(["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "needs_human"]);
    expect((await w.runs(steps[7].id)).map((x: any) => x.outcome)).toEqual(["applied"]);
    expect((await w.runs(steps[8].id)).map((x: any) => [x.outcome, x.detail.reason])).toEqual([["skipped", "depth"]]);
    expect(verifyChain(w.events()).ok).toBe(true);
  });

  it("stops a rule that fans out through create_ticket at the budget: a skipped run, needs_human on the root ticket", async () => {
    const w = await world();
    const ready = w.lane("Ready").id;
    const r = await w.rule("Breed", { type: "ticket.created" }, [], [{ type: "create_ticket", title: "Child of {{ticket.key}}", laneId: ready }, { type: "create_ticket", title: "Twin of {{ticket.key}}", laneId: ready }]);
    const root = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Root" })).json;
    const tickets = (await w.human("GET", `/api/v1/tickets?projectId=${w.project.id}`)).json;
    expect(tickets).toHaveLength(1 + MAX_CREATED);
    const runs = await w.runs(r.id);
    expect(runs.filter((x: any) => x.outcome === "applied")).toHaveLength(MAX_CREATED / 2);
    const stopped = runs.filter((x: any) => x.outcome === "skipped");
    expect(stopped).toHaveLength(1);
    expect(stopped[0].detail.reason).toBe("budget");
    expect((await w.ticket(root.id)).flags).toEqual(["needs_human"]);
    const last = w.events().filter((e) => e.type === "rule.fired").at(-1)!;
    expect(last.payload).toMatchObject({ ruleId: r.id, outcome: "skipped", reason: "budget" });
    expect(verifyChain(w.events()).ok).toBe(true);
  });

  it("gives each root event its own budget: a first event that spends its budget does not silence the second", async () => {
    const w = await world();
    const ready = w.lane("Ready").id;
    const r = await w.rule("Breed", { type: "ticket.created" }, [], [{ type: "create_ticket", title: "Child of {{ticket.key}}", laneId: ready }, { type: "create_ticket", title: "Twin of {{ticket.key}}", laneId: ready }], false);
    const a = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Root A" })).json;
    const b = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Root B" })).json;
    expect((await w.human("PATCH", `/api/v1/rules/${r.id}`, { enabled: true })).status).toBe(200);
    const roots = w.events().filter((e) => e.type === "ticket.created");
    expect(roots).toHaveLength(2);
    // One call with both root events, the way a scheduler tick hands its events over.
    runRules(w.app.ctx, roots);
    const tickets = (await w.human("GET", `/api/v1/tickets?projectId=${w.project.id}`)).json;
    expect(tickets).toHaveLength(2 + 2 * MAX_CREATED);
    const runs = await w.runs(r.id);
    expect(runs.filter((x: any) => x.outcome === "applied")).toHaveLength(MAX_CREATED);
    expect(runs.filter((x: any) => x.outcome === "skipped").map((x: any) => x.detail.reason)).toEqual(["budget", "budget"]);
    expect((await w.ticket(a.id)).flags).toEqual(["needs_human"]);
    expect((await w.ticket(b.id)).flags).toEqual(["needs_human"]);
    expect(verifyChain(w.events()).ok).toBe(true);
  });

  it("does not let one fire exceed the created-ticket budget: a fire that would pass it is skipped whole", async () => {
    const w = await world();
    const ready = w.lane("Ready").id;
    const creates = ["One", "Two", "Three"].map((n) => ({ type: "create_ticket", title: `${n} of {{ticket.key}}`, laneId: ready }));
    const r = await w.rule("Triplets", { type: "ticket.created" }, [], creates);
    await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Root" });
    // Six fires make 18; a seventh would make 21, past MAX_CREATED, so it does not start.
    const fires = Math.floor(MAX_CREATED / 3);
    const tickets = (await w.human("GET", `/api/v1/tickets?projectId=${w.project.id}`)).json;
    expect(tickets).toHaveLength(1 + fires * 3);
    const runs = await w.runs(r.id);
    expect(runs.filter((x: any) => x.outcome === "applied")).toHaveLength(fires);
    expect(runs.filter((x: any) => x.outcome === "skipped").map((x: any) => x.detail.reason)).toEqual(["budget"]);
  });

  it("does not move a ticket past a gate: the run is refused, the ticket is blocked, and a system comment says why", async () => {
    const w = await world();
    const rfp = w.lane("Ready for Production");
    const r = await w.rule("Ship on arrival", { type: "ticket.created" }, [], [{ type: "move_to_lane", laneId: rfp.id }]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Not ready" })).json;
    expect(await w.ticket(t.id)).toMatchObject({ laneId: w.lane("Backlog").id, flags: ["blocked"] });
    const runs = await w.runs(r.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ outcome: "refused", ticketId: t.id, detail: { action: { type: "move_to_lane", laneId: rfp.id }, laneId: rfp.id, missing: [{ typeId: "et_eval_score", name: "Eval score", need: 1, have: 0 }] } });
    const thread = (await w.human("GET", `/api/v1/tickets/${t.id}/thread`)).json;
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].actorId).toBe("engine");
    expect(thread.comments[0].body).toBe("Rule \"Ship on arrival\" tried to move PAN-1 to Ready for Production and was refused: it needs Eval score (1 more).");
    expect(thread.actors).toContainEqual({ id: "engine", name: "Engine", kind: "agent" });
    const fired = w.events().find((e) => e.type === "rule.fired")!;
    expect(fired.payload).toMatchObject({ ruleId: r.id, ticketId: t.id, outcome: "refused" });
    expect(w.events().map((e) => e.type).filter((x) => x === "ticket.moved")).toEqual([]);
  });

  it("rolls back a fire whose action fails and records error, leaving earlier actions of that fire undone", async () => {
    const w = await world();
    const r = await w.rule("Tag then break", { type: "ticket.created" }, [], [{ type: "set_flag", flag: "blocked" }, { type: "set_epic", epicId: "no-such-epic" }]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Half done" })).json;
    expect((await w.ticket(t.id)).flags).toEqual([]);
    expect((await w.runs(r.id)).map((x: any) => [x.outcome, x.detail.code])).toEqual([["error", "wrong_project"]]);
    expect(w.events().filter((e) => e.type === "ticket.flag_set")).toHaveLength(0);
    expect(verifyChain(w.events()).ok).toBe(true);
  });

  it("records an error run and keeps earlier fires on the stream when the engine itself fails mid-run", async () => {
    const w = await world();
    const rfp = w.lane("Ready for Production");
    const a = await w.rule("Flag first", { type: "ticket.created" }, [], [{ type: "set_flag", flag: "urgent" }]);
    const b = await w.rule("Ship on arrival", { type: "ticket.created" }, [], [{ type: "move_to_lane", laneId: rfp.id }]);
    // b is refused at the gate, and then the refusal's own comment cannot be written: that is
    // the engine failing, not an action being refused.
    w.app.ctx.db!.exec("create trigger boom before insert on comments begin select raise(abort, 'disk full'); end");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    const unsubscribe = w.app.ctx.bus.subscribe((e: any) => seen.push(e.type));
    const res = await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Trouble" });
    unsubscribe();
    const reported = errors.mock.calls.length;
    errors.mockRestore();
    w.app.ctx.db!.exec("drop trigger boom");

    expect(res.status).toBe(200);
    expect(reported).toBeGreaterThan(0);
    expect(seen).toEqual(["ticket.created", "ticket.flag_set", "rule.fired", "rule.fired"]);
    expect((await w.runs(a.id)).map((x: any) => x.outcome)).toEqual(["applied"]);
    const [run] = await w.runs(b.id);
    expect(run).toMatchObject({ outcome: "error", ticketId: res.json.id, detail: { code: "internal" } });
    expect(run.detail.message).toContain("disk full");
    expect(await w.ticket(res.json.id)).toMatchObject({ laneId: w.lane("Backlog").id, flags: ["urgent"] });
    expect(verifyChain(w.events()).ok).toBe(true);
  });

  it("applies the other actions through the routes' rules: comment, tag, epic, field, assign, and a created ticket", async () => {
    const w = await world();
    const tag = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "auto", family: "sky" })).json;
    const epic = (await w.human("POST", "/api/v1/epics", { projectId: w.project.id, name: "Autumn", family: "lilac" })).json;
    await w.human("POST", "/api/v1/fields", { projectId: w.project.id, name: "Owner", key: "owner", kind: "text" });
    const r = await w.rule("Dress a new ticket", { type: "ticket.created" }, [{ kind: "title", op: "contains", value: "dress" }], [
      { type: "add_comment", body: "Welcome, {{ticket.key}}: {{ticket.title}} in {{lane.name}} on {{event.type}}" },
      { type: "add_tag", tagId: tag.id },
      { type: "set_epic", epicId: epic.id },
      { type: "set_field", key: "owner", value: "the engine" },
      { type: "assign", actorId: w.agentId },
      { type: "create_ticket", title: "Follow up on {{ticket.key}}", laneId: w.lane("Ready").id, tagIds: [tag.id] },
    ]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Please dress me" })).json;
    expect(await w.ticket(t.id)).toMatchObject({ tagIds: [tag.id], epicId: epic.id, fields: { owner: "the engine" }, assigneeId: w.agentId });
    const thread = (await w.human("GET", `/api/v1/tickets/${t.id}/thread`)).json;
    expect(thread.comments.map((c: any) => [c.actorId, c.body])).toEqual([["engine", "Welcome, PAN-1: Please dress me in Backlog on ticket.created"]]);
    const all = (await w.human("GET", `/api/v1/tickets?projectId=${w.project.id}`)).json;
    const follow = all.find((x: any) => x.key === "PAN-2");
    expect(follow).toMatchObject({ title: "Follow up on PAN-1", laneId: w.lane("Ready").id, tagIds: [tag.id], assigneeId: null });
    // The created ticket is itself a ticket.created event; the rule's title condition kept it
    // from dressing the follow-up too, and a conditions miss leaves no run.
    expect((await w.runs(r.id)).map((x: any) => [x.outcome, x.ticketId])).toEqual([["applied", t.id]]);
    const followCreated = w.events().find((e) => e.type === "ticket.created" && (e.payload as any).id === follow.id)!;
    expect(followCreated.actorId).toBe("engine");
    expect((followCreated.payload as any).causedBy.ruleId).toBe(r.id);
    expect(verifyChain(w.events()).ok).toBe(true);
  });

  it("starts and stops the engine's own timer on a ticket through the timer service", async () => {
    const w = await world();
    const inProgress = w.lane("In Progress"), evalLane = w.lane("Eval");
    await w.rule("Clock in", { type: "ticket.moved", toLaneId: inProgress.id }, [], [{ type: "start_timer" }]);
    const stop = await w.rule("Clock out", { type: "ticket.moved", toLaneId: evalLane.id }, [], [{ type: "stop_timer" }]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Timed" })).json;
    await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: inProgress.id });
    expect((await w.human("GET", `/api/v1/tickets/${t.id}/metrics`)).json).toMatchObject({ openTimers: 1, byActor: [{ actorId: "engine", name: "Engine" }] });
    await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: evalLane.id });
    expect((await w.human("GET", `/api/v1/tickets/${t.id}/metrics`)).json.openTimers).toBe(0);
    const timerEvents = w.events().filter((e) => e.type.startsWith("timer."));
    expect(timerEvents.map((e) => [e.type, e.actorId, (e.payload as any).actorId])).toEqual([["timer.started", "engine", "engine"], ["timer.stopped", "engine", "engine"]]);
    expect((timerEvents[1].payload as any).seconds).toEqual(expect.any(Number));
    // A second stop has nothing to stop: an error run, the routes' own 404 code.
    await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: inProgress.id });
    await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: evalLane.id });
    await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: w.lane("Backlog").id });
    await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: evalLane.id });
    expect((await w.runs(stop.id)).map((x: any) => [x.outcome, x.detail.code])).toEqual([["error", "timer_not_open"], ["applied", undefined], ["applied", undefined]]);
  });

  it("moves a ticket between boards through the update path, refusing another project's board", async () => {
    const w = await world();
    const growth = (await w.human("POST", "/api/v1/boards", { projectId: w.project.id, name: "Growth", family: "sky" })).json;
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    const otherBoard = (await w.human("GET", `/api/v1/projects/${other.project.id}/boards`)).json[0];
    await w.rule("To growth", { type: "ticket.created" }, [{ kind: "title", op: "contains", value: "growth" }], [{ type: "move_to_board", boardId: growth.id }]);
    const bad = await w.rule("Elsewhere", { type: "ticket.created" }, [{ kind: "title", op: "contains", value: "away" }], [{ type: "move_to_board", boardId: otherBoard.id }]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "For growth" })).json;
    expect((await w.ticket(t.id)).boardId).toBe(growth.id);
    const updated = w.events().find((e) => e.type === "ticket.updated" && e.actorId === "engine")!;
    expect(updated.payload).toMatchObject({ id: t.id, changed: ["boardId"] });
    const away = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Send away" })).json;
    expect((await w.ticket(away.id)).boardId).not.toBe(otherBoard.id);
    expect((await w.runs(bad.id)).map((x: any) => [x.outcome, x.detail.code])).toEqual([["error", "wrong_project"]]);
    // The same path a request takes.
    expect((await w.human("PATCH", `/api/v1/tickets/${away.id}`, { boardId: growth.id })).json.boardId).toBe(growth.id);
    expect((await w.human("PATCH", `/api/v1/tickets/${away.id}`, { boardId: otherBoard.id })).json.error.code).toBe("wrong_project");
  });

  it("refuses assigning the engine or a revoked agent, for a rule and a request alike", async () => {
    const w = await world();
    expect((await w.human("POST", `/api/v1/agents/${w.agentId}/revoke`)).status).toBe(200);
    const r = await w.rule("Hand over", { type: "ticket.created" }, [], [{ type: "assign", actorId: w.agentId }]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Orphan" })).json;
    expect((await w.ticket(t.id)).assigneeId).toBe(null);
    expect((await w.runs(r.id)).map((x: any) => [x.outcome, x.detail.code, x.detail.message])).toEqual([["error", "validation", "That agent's key was revoked"]]);
    expect((await w.human("PATCH", `/api/v1/tickets/${t.id}`, { assigneeId: "engine" })).json.error).toMatchObject({ code: "validation", message: "The engine cannot be assigned a ticket" });
    expect((await w.human("PATCH", `/api/v1/tickets/${t.id}`, { assigneeId: w.agentId })).json.error.message).toBe("That agent's key was revoked");
  });

  it("treats an archived ticket as no ticket", async () => {
    const w = await world();
    const r = await w.rule("Flag on comment", { type: "comment.added" }, [], [{ type: "set_flag", flag: "blocked" }]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Gone" })).json;
    await w.human("POST", `/api/v1/tickets/${t.id}/archive`);
    // No route raises an event about an archived ticket, so hand the engine one directly.
    const archived = w.events().find((e) => e.type === "ticket.archived")!;
    runRules(w.app.ctx, [{ ...archived, type: "comment.added", payload: { id: "c", ticketId: t.id, projectId: w.project.id } }]);
    expect((await w.runs(r.id)).map((x: any) => [x.outcome, x.ticketId, x.detail.code])).toEqual([["error", t.id, "no_ticket"]]);
    expect(listEvents(w.app.ctx.db!).filter((e) => e.type === "ticket.flag_set")).toHaveLength(0);
  });

  it("keeps the engine out of the agents list, unapprovable, unrevokable, and unable to sign a request", async () => {
    const w = await world();
    await w.rule("Flag", { type: "ticket.created" }, [], [{ type: "set_flag", flag: "blocked" }]);
    await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Wakes the engine" });
    expect(getActor(w.app.ctx.db!, "engine")).toMatchObject({ id: "engine", kind: "agent", status: "active" });
    expect((await w.human("GET", "/api/v1/agents")).json.map((a: any) => a.id)).not.toContain("engine");
    expect((await w.human("POST", "/api/v1/agents/engine/approve", { scopes: { projects: "*", actions: ["read"] } })).status).toBe(404);
    expect((await w.human("POST", "/api/v1/agents/engine/revoke")).status).toBe(404);
    const asEngine = client(w.app, w.keys.seed, "engine");
    expect((await asEngine("GET", "/api/v1/projects")).status).toBe(401);
  });

  it("publishes what a rule did to the stream after the event that caused it, project scoped", async () => {
    const w = await world();
    const r = await w.rule("Flag on arrival", { type: "ticket.created" }, [], [{ type: "set_flag", flag: "blocked" }]);
    const seen: { seq: number; type: string; payload: any }[] = [];
    const unsubscribe = w.app.ctx.bus.subscribe((e: any) => seen.push({ seq: e.seq, type: e.type, payload: e.payload }));
    await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Streamed" });
    unsubscribe();
    expect(seen.map((e) => e.type)).toEqual(["ticket.created", "ticket.flag_set", "rule.fired"]);
    expect(seen.every((e) => e.payload.projectId === w.project.id)).toBe(true);
    expect(seen[2].payload).toMatchObject({ ruleId: r.id, outcome: "applied", actions: [{ type: "set_flag", flag: "blocked" }] });
    expect(seen[1].payload.causedBy).toEqual({ ruleId: r.id, runId: seen[2].payload.runId, eventSeq: seen[0].seq });
  });

  it("leaves a disabled rule alone and never lets a rule clear needs_human", async () => {
    const w = await world();
    await w.rule("Off", { type: "ticket.created" }, [], [{ type: "set_flag", flag: "blocked" }], false);
    const bad = canvas({ type: "ticket.created" }, [], [{ type: "clear_flag", flag: "needs_human" }]);
    const res = await w.human("POST", "/api/v1/rules", { projectId: w.project.id, name: "Sneaky", enabled: true, canvas: bad });
    expect(res.status).toBe(400);
    expect(res.json.error.details.errors.map((e: any) => e.name)).toEqual(["invalid:a0"]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Quiet" })).json;
    expect((await w.ticket(t.id)).flags).toEqual([]);
    expect(w.events().filter((e) => e.type === "rule.fired")).toHaveLength(0);
  });
});

describe("rule engine with the workers", () => {
  const FAR = "9999-01-01T00:00:00.000Z";
  const tickAfter = (w: Awaited<ReturnType<typeof world>>, nextRunAt: string) => {
    const clock = { now: new Date(Date.parse(nextRunAt) + 1000) };
    new Scheduler(w.app.ctx, { now: () => clock.now, log: () => {}, onEvents: (_db, evs) => void runRules(w.app.ctx, evs) }).tick();
  };

  it("picks a schedule rule up at save, runs it when the scheduler fires its trigger, and drops the trigger with the rule", async () => {
    const w = await world();
    const res = await w.human("POST", "/api/v1/rules", { projectId: w.project.id, name: "Nightly", enabled: true, canvas: scheduled("* * * * *", { type: "create_ticket", title: "Nightly check", laneId: w.lane("Ready").id }) });
    expect(res.status).toBe(200);
    const r = res.json;
    expect(r.event).toMatchObject({ type: "schedule", cron: "* * * * *", timezone: "UTC" });
    const triggers = listTriggers(w.app.ctx.db!, { ruleId: r.id });
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ cron: "* * * * *", timezone: "UTC", nextRunAt: expect.any(String) });

    tickAfter(w, triggers[0].nextRunAt!);
    const fired = w.events().find((e) => e.type === "trigger.fired")!;
    expect(fired.payload).toMatchObject({ ruleId: r.id, projectId: w.project.id });
    const runs = await w.runs(r.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ outcome: "applied", ticketId: null, eventSeq: fired.seq });
    const tickets = (await w.human("GET", `/api/v1/tickets?projectId=${w.project.id}`)).json;
    expect(tickets.map((t: any) => t.title)).toEqual(["Nightly check"]);
    const created = w.events().find((e) => e.type === "ticket.created")!;
    expect(created.actorId).toBe("engine");
    expect((created.payload as any).causedBy).toEqual({ ruleId: r.id, runId: runs[0].id, eventSeq: fired.seq });
    expect(verifyChain(w.events()).ok).toBe(true);

    // A changed schedule follows at once; a deleted rule takes its trigger with it.
    const hourly = scheduled("0 * * * *", { type: "create_ticket", title: "Hourly check", laneId: w.lane("Ready").id });
    expect((await w.human("PATCH", `/api/v1/rules/${r.id}`, { canvas: hourly })).status).toBe(200);
    expect(listTriggers(w.app.ctx.db!, { ruleId: r.id }).map((t) => t.cron)).toEqual(["0 * * * *"]);
    await w.human("DELETE", `/api/v1/rules/${r.id}`);
    expect(listTriggers(w.app.ctx.db!, { ruleId: r.id })).toEqual([]);
  });

  it("gives a schedule rule with a ticket action an error run, since a trigger names no ticket", async () => {
    const w = await world();
    const r = (await w.human("POST", "/api/v1/rules", { projectId: w.project.id, name: "Nowhere", enabled: true, canvas: scheduled("* * * * *", { type: "move_to_lane", laneId: w.lane("Eval").id }) })).json;
    tickAfter(w, listTriggers(w.app.ctx.db!, { ruleId: r.id })[0].nextRunAt!);
    expect((await w.runs(r.id)).map((x: any) => [x.outcome, x.ticketId, x.detail.code])).toEqual([["error", null, "no_ticket"]]);
  });

  it("refuses a schedule croner rejects, naming the schedule node", async () => {
    const w = await world();
    const res = await w.human("POST", "/api/v1/rules", { projectId: w.project.id, name: "Never", enabled: true, canvas: scheduled("99 * * * *", { type: "set_flag", flag: "blocked" }) });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("canvas_invalid");
    expect(res.json.error.details.errors).toEqual([{ name: "invalid:s", code: "invalid", nodeId: "s" }]);
    expect((await w.human("GET", `/api/v1/rules?projectId=${w.project.id}`)).json).toEqual([]);
  });

  it("enqueues a notification for the outbox when a rule emits a webhook, and refuses an archived destination", async () => {
    const w = await world();
    const dest = (await w.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "Ops", url: "https://example.test/hook" })).json;
    const r = await w.rule("Tell ops", { type: "ticket.created" }, [], [{ type: "emit_webhook", destinationId: dest.id }]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Notify me" })).json;
    const created = w.events().find((e) => e.type === "ticket.created")!;
    const rows = dueOutbox(w.app.ctx.db!, FAR);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ destinationId: dest.id, eventSeq: created.seq, deliveredAt: null, attempts: 0 });
    expect(rows[0].payload).toMatchObject({ ruleId: r.id, event: { seq: created.seq, type: "ticket.created" }, ticket: { id: t.id } });
    expect((await w.runs(r.id)).map((x: any) => x.outcome)).toEqual(["applied"]);

    // The outbox's own refusals (a destination archived or gone) are refused runs, not errors.
    expect((await w.human("PATCH", `/api/v1/destinations/${dest.id}`, { archived: true })).status).toBe(200);
    await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Again" });
    expect(dueOutbox(w.app.ctx.db!, FAR)).toHaveLength(1);
    expect((await w.runs(r.id)).map((x: any) => [x.outcome, x.detail.code])).toEqual([["refused", "destination_archived"], ["applied", undefined]]);
    const refused = w.events().filter((e) => e.type === "rule.fired").at(-1)!;
    expect(refused.payload).toMatchObject({ ruleId: r.id, outcome: "refused", code: "destination_archived" });
  });

  it("names the ticket on an engine-enqueued delivery, so one that gives up flags it needs_human", async () => {
    const w = await world();
    const dead = await fakeDestination(500); servers.push(dead);
    const dest = (await w.human("POST", "/api/v1/destinations", { projectId: w.project.id, name: "Dead", url: dead.url })).json;
    await w.rule("Tell ops", { type: "ticket.created" }, [], [{ type: "emit_webhook", destinationId: dest.id }]);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Notify me" })).json;
    const [row] = dueOutbox(w.app.ctx.db!, FAR);
    expect(row.payload).toMatchObject({ ticketId: t.id, projectId: w.project.id, ticket: { id: t.id } });

    const clock = { now: new Date() };
    const worker = new OutboxWorker(w.app.ctx, { now: () => clock.now, allowPrivate: true, log: () => {} });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await worker.tick();
      clock.now = new Date(clock.now.getTime() + 24 * 3_600_000);
    }
    expect(dead.hits()).toBe(MAX_ATTEMPTS);
    const failed = w.events().find((e) => e.type === "webhook.failed")!;
    expect(failed.payload).toMatchObject({ outboxId: row.id, destinationId: dest.id, projectId: w.project.id, ticketId: t.id, attempts: MAX_ATTEMPTS });
    expect((await w.ticket(t.id)).flags).toEqual(["needs_human"]);
    expect(w.events().filter((e) => e.type === "ticket.flag_set").map((e) => e.payload)).toEqual([{ id: t.id, projectId: w.project.id, flag: "needs_human", cause: "webhook" }]);
  });
});
