import { describe, expect, it } from "vitest";
import { verifyChain } from "@boomerang/core";
import { listEvents } from "@boomerang/db";
import { agentIn, setupApp } from "./test/helpers";

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
    expect((await w.human("GET", `/api/v1/rules?projectId=${w.project.id}`)).json.map((x: any) => x.id)).toEqual([r.id]);

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

    // First fail: rule 3's event matches but its condition does not hold yet.
    expect((await w.agent("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_eval_score", payload: { score: 0.2 } })).json.result).toBe("fail");
    expect((await w.ticket(t.id))).toMatchObject({ laneId: evalLane.id, flags: [] });
    expect((await w.runs(r3.id)).map((x: any) => x.outcome)).toEqual(["skipped"]);
    // Second fail: back to In Progress and flagged for the human.
    await w.agent("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_eval_score", payload: { score: 0.3 } });
    expect((await w.ticket(t.id))).toMatchObject({ laneId: inProgress.id, flags: ["needs_human"] });
    expect((await w.runs(r3.id)).map((x: any) => x.outcome)).toEqual(["applied", "skipped"]);

    // The human clears the flag and sends it round again; this time the eval passes.
    await w.human("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "needs_human", on: false });
    await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: evalLane.id });
    await w.agent("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_eval_score", payload: { score: 0.97 } });
    expect((await w.ticket(t.id))).toMatchObject({ laneId: rfp.id, flags: ["needs_human"] });
    expect((await w.runs(r2.id)).map((x: any) => x.outcome)).toEqual(["applied"]);

    const fired = w.events().filter((e) => e.type === "rule.fired");
    expect(fired.map((e) => [e.payload as any].map((p) => [p.ruleId, p.outcome])[0])).toEqual([[r1.id, "applied"], [r3.id, "skipped"], [r3.id, "applied"], [r2.id, "applied"]]);
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
    expect((await w.runs(a.id)).map((x: any) => [x.outcome, x.detail.reason])).toEqual([["skipped", "chain"], ["applied", undefined]]);
    expect((await w.runs(b.id)).map((x: any) => x.outcome)).toEqual(["applied"]);
    const moves = w.events().filter((e) => e.type === "ticket.moved");
    expect(moves.map((e) => e.actorId)).toEqual(["human", "engine", "engine"]);
    const flagged = w.events().find((e) => e.type === "ticket.flag_set")!;
    expect(flagged.payload).toMatchObject({ id: t.id, flag: "needs_human", cause: "rule", causedBy: { ruleId: a.id } });
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
    // from dressing the follow-up too, and that shows as a skipped run in the same chain.
    expect((await w.runs(r.id)).map((x: any) => [x.outcome, x.ticketId])).toEqual([["skipped", follow.id], ["applied", t.id]]);
    const followCreated = w.events().find((e) => e.type === "ticket.created" && (e.payload as any).id === follow.id)!;
    expect(followCreated.actorId).toBe("engine");
    expect((followCreated.payload as any).causedBy.ruleId).toBe(r.id);
    expect(verifyChain(w.events()).ok).toBe(true);
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
