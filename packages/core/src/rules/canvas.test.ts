import { describe, expect, it } from "vitest";
import { CanvasDocSchema, canvasToRule, conditionDepth, ruleToCanvas, type CanvasDoc, type CanvasNode } from "../index";

const node = (id: string, kind: CanvasNode["kind"], data: unknown, x = 0, y = 0): CanvasNode => ({ id, kind, position: { x, y }, data: data as Record<string, unknown> });
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

const ev = node("ev", "event", { type: "evidence.added", typeId: "et_eval_score" });
const inEval = node("c1", "condition", { kind: "lane", op: "is", value: "l_eval" });
const passed = node("c2", "condition", { kind: "evidence", typeId: "et_eval_score", result: "pass", op: "exists" });
const failedTwice = node("c3", "condition", { kind: "evidence", typeId: "et_eval_score", result: "fail", op: "gte", count: 2 });
const toRfp = node("a1", "action", { type: "move_to_lane", laneId: "l_rfp" });
const flag = node("a2", "action", { type: "set_flag", flag: "needs_human" });
const comment = node("a3", "action", { type: "add_comment", body: "Back to work: {{ticket.key}}" });

const errorsOf = (doc: CanvasDoc) => {
  const out = canvasToRule(doc);
  return "errors" in out ? out.errors.map((e) => e.name) : [];
};
const ruleOf = (doc: CanvasDoc) => {
  const out = canvasToRule(doc);
  if ("errors" in out) throw new Error(out.errors.map((e) => e.name).join(", "));
  return out.rule;
};

describe("canvasToRule", () => {
  it("a straight chain: event, conditions chained as all, then the actions", () => {
    const rule = ruleOf({ nodes: [ev, inEval, passed, toRfp], edges: [edge("ev", "c1"), edge("c1", "c2"), edge("c2", "a1")] });
    expect(rule.event).toEqual({ type: "evidence.added", typeId: "et_eval_score" });
    expect(rule.conditions).toEqual([inEval.data, passed.data]);
    expect(rule.actions).toEqual([{ type: "move_to_lane", laneId: "l_rfp" }]);
  });
  it("actions on different branches keep their own when list after the shared prefix", () => {
    const rule = ruleOf({
      nodes: [ev, inEval, passed, failedTwice, toRfp, flag, comment],
      edges: [edge("ev", "c1"), edge("c1", "c2"), edge("c2", "a1"), edge("c1", "c3"), edge("c3", "a2"), edge("a2", "a3")],
    });
    expect(rule.conditions).toEqual([inEval.data]);
    expect(rule.actions).toEqual([
      { ...toRfp.data, when: [passed.data] },
      { ...flag.data, when: [failedTwice.data] },
      { ...comment.data, when: [failedTwice.data] },
    ]);
  });
  it("two paths into one action branch as any", () => {
    const rule = ruleOf({ nodes: [ev, passed, failedTwice, flag], edges: [edge("ev", "c2"), edge("ev", "c3"), edge("c2", "a2"), edge("c3", "a2")] });
    expect(rule.conditions).toEqual([{ kind: "any", conditions: [passed.data, failedTwice.data] }]);
    expect(rule.actions).toEqual([flag.data]);
  });
  it("an action straight off the event has no conditions", () => {
    const rule = ruleOf({ nodes: [ev, flag], edges: [edge("ev", "a2")] });
    expect(rule.conditions).toEqual([]);
    expect(rule.actions).toEqual([flag.data]);
  });
  it("a schedule node stands in for the event node", () => {
    const sched = node("s", "schedule", { cron: "0 9 * * 1-5", timezone: "Europe/London" });
    const rule = ruleOf({ nodes: [sched, flag], edges: [edge("s", "a2")] });
    expect(rule.event).toEqual({ type: "schedule", cron: "0 9 * * 1-5", timezone: "Europe/London" });
  });

  it("no_event", () => {
    expect(errorsOf({ nodes: [inEval, flag], edges: [edge("c1", "a2")] })).toEqual(["no_event"]);
  });
  it("two_events, for two event nodes or an event plus a schedule", () => {
    const ev2 = node("ev2", "event", { type: "ticket.created" });
    const sched = node("s", "schedule", { cron: "* * * * *", timezone: "UTC" });
    expect(errorsOf({ nodes: [ev, ev2, flag], edges: [edge("ev", "a2"), edge("ev2", "a2")] })).toEqual(["two_events"]);
    expect(errorsOf({ nodes: [ev, sched, flag], edges: [edge("ev", "a2"), edge("s", "a2")] })).toEqual(["two_events"]);
  });
  it("unknown_kind:<nodeId>", () => {
    const note = { ...node("x", "condition", {}), kind: "note" } as unknown as CanvasNode;
    expect(errorsOf({ nodes: [ev, note, flag], edges: [edge("ev", "a2")] })).toEqual(["unknown_kind:x"]);
  });
  it("disconnected:<nodeId> for every node with no path from the event", () => {
    expect(errorsOf({ nodes: [ev, inEval, passed, flag], edges: [edge("ev", "a2"), edge("c1", "c2")] })).toEqual(["disconnected:c1", "disconnected:c2"]);
  });
  it("cycle", () => {
    expect(errorsOf({ nodes: [ev, inEval, passed, flag], edges: [edge("ev", "c1"), edge("c1", "c2"), edge("c2", "c1"), edge("c2", "a2")] })).toEqual(["cycle"]);
    expect(errorsOf({ nodes: [ev, flag], edges: [edge("ev", "a2"), edge("a2", "ev")] })).toEqual(["cycle"]);
  });
  it("missing_target:<nodeId> when an action's picker value is empty or absent", () => {
    const noLane = node("a", "action", { type: "move_to_lane", laneId: "" });
    const noTag = node("b", "action", { type: "add_tag" });
    const noDest = node("c", "action", { type: "emit_webhook", destinationId: "" });
    const noKey = node("d", "action", { type: "set_field", key: "", value: 1 });
    const noFlag = node("e", "action", { type: "set_flag", flag: "" });
    expect(errorsOf({ nodes: [ev, noLane, noTag, noDest, noKey, noFlag], edges: [edge("ev", "a"), edge("ev", "b"), edge("ev", "c"), edge("ev", "d"), edge("ev", "e")] })).toEqual([
      "missing_target:a",
      "missing_target:b",
      "missing_target:c",
      "missing_target:d",
      "missing_target:e",
    ]);
  });
  it("invalid:<nodeId> when a node's data does not parse for another reason", () => {
    const badCond = node("c", "condition", { kind: "lane", op: "gte", value: "l1" });
    const badAction = node("a", "action", { type: "clear_flag", flag: "needs_human" });
    const badEvent = node("e", "event", { type: "ticket.exploded" });
    expect(errorsOf({ nodes: [ev, badCond, badAction], edges: [edge("ev", "c"), edge("c", "a")] })).toEqual(["invalid:c", "invalid:a"]);
    expect(errorsOf({ nodes: [badEvent, flag], edges: [edge("e", "a2")] })).toEqual(["invalid:e"]);
  });
  it("bad_edge:<edgeId> when an edge names a node that is not on the canvas", () => {
    expect(errorsOf({ nodes: [ev, flag], edges: [edge("ev", "a2"), edge("ev", "ghost")] })).toEqual(["bad_edge:ev-ghost"]);
  });
  it("errors carry the code and the node id separately", () => {
    const out = canvasToRule({ nodes: [ev, inEval, flag], edges: [edge("ev", "a2")] });
    expect(out).toEqual({ errors: [{ name: "disconnected:c1", code: "disconnected", nodeId: "c1" }] });
  });
  it("create_ticket and move_to_board need a target; the timer actions need none", () => {
    const noLane = node("a", "action", { type: "create_ticket", title: "Retest", laneId: "" });
    const noBoard = node("b", "action", { type: "move_to_board" });
    const start = node("c", "action", { type: "start_timer" });
    const stop = node("d", "action", { type: "stop_timer" });
    expect(errorsOf({ nodes: [ev, noLane, noBoard, start, stop], edges: [edge("ev", "a"), edge("ev", "b"), edge("ev", "c"), edge("ev", "d")] })).toEqual(["missing_target:a", "missing_target:b"]);
    const rule = ruleOf({ nodes: [ev, start, stop], edges: [edge("ev", "c"), edge("ev", "d")] });
    expect(rule.actions).toEqual([{ type: "start_timer" }, { type: "stop_timer" }]);
  });

  // A diamond is a fan-out into two conditions that meet again at the next condition. Forty of
  // them in a row have 2^40 paths; the reduction must work per node, not per path.
  const diamonds = (n: number): CanvasDoc => {
    const nodes: CanvasNode[] = [ev];
    const edges: CanvasDoc["edges"][number][] = [];
    let prev = "ev";
    for (let i = 1; i <= n; i++) {
      const left = node(`l${i}`, "condition", { kind: "tag", op: "is", value: `left${i}` });
      const right = node(`r${i}`, "condition", { kind: "tag", op: "is", value: `right${i}` });
      const meet = node(`m${i}`, "condition", { kind: "flag", op: "is_not", value: `stop${i}` });
      nodes.push(left, right, meet);
      edges.push(edge(prev, left.id), edge(prev, right.id), edge(left.id, meet.id), edge(right.id, meet.id));
      prev = meet.id;
    }
    nodes.push(flag);
    edges.push(edge(prev, "a2"));
    return { nodes, edges };
  };
  it("reduces forty chained diamonds in linear time", () => {
    const started = performance.now();
    const rule = ruleOf(diamonds(40));
    expect(performance.now() - started).toBeLessThan(100);
    expect(rule.conditions).toHaveLength(80);
    expect(rule.conditions[0]).toEqual({ kind: "any", conditions: [{ kind: "tag", op: "is", value: "left1" }, { kind: "tag", op: "is", value: "right1" }] });
    expect(rule.conditions[1]).toEqual({ kind: "flag", op: "is_not", value: "stop1" });
    expect(rule.actions).toEqual([flag.data]);
  });
  // Each layer merges the chain so far with a fresh branch straight off the event, so the
  // reduced condition wraps the previous one in an all inside an any: two levels per layer.
  const layers = (k: number): CanvasDoc => {
    const nodes: CanvasNode[] = [ev];
    const edges: CanvasDoc["edges"][number][] = [];
    let tip = "ev";
    for (let i = 1; i <= k; i++) {
      const x = node(`x${i}`, "condition", { kind: "tag", op: "is", value: `x${i}` });
      const y = node(`y${i}`, "condition", { kind: "tag", op: "is", value: `y${i}` });
      const m = node(`m${i}`, "condition", { kind: "flag", op: "is_not", value: `m${i}` });
      nodes.push(x, y, m);
      edges.push(edge(tip, x.id), edge("ev", y.id), edge(x.id, m.id), edge(y.id, m.id));
      tip = m.id;
    }
    nodes.push(flag);
    edges.push(edge(tip, "a2"));
    return { nodes, edges };
  };
  it("accepts a reduction that nests exactly to the cap and refuses one deeper, naming the action", () => {
    const rule = ruleOf(layers(4));
    expect(conditionDepth(rule.conditions[0])).toBe(8);
    expect(errorsOf(layers(5))).toEqual(["invalid:a2"]);
  });
});

describe("ruleToCanvas output", () => {
  it("re-parses under CanvasDocSchema", () => {
    const doc = ruleToCanvas({
      event: { type: "schedule", cron: "0 9 * * *", timezone: "UTC" },
      conditions: [inEval.data as any],
      actions: [{ type: "create_ticket", title: "Daily {{ticket.key}}", laneId: "l1", when: [passed.data as any] }, { type: "start_timer" }],
    });
    const parsed = CanvasDocSchema.safeParse(doc);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });
});

describe("ruleToCanvas", () => {
  const rule = {
    event: { type: "evidence.added" as const, typeId: "et_eval_score" },
    conditions: [inEval.data as any],
    actions: [
      { type: "move_to_lane" as const, laneId: "l_rfp", when: [passed.data as any] },
      { type: "set_flag" as const, flag: "needs_human", when: [failedTwice.data as any] },
      { type: "add_comment" as const, body: "Back: {{ticket.key}}" },
    ],
  };
  it("lays out left to right on a 240 by 120 grid, deterministically", () => {
    const doc = ruleToCanvas(rule);
    expect(doc).toEqual(ruleToCanvas(rule));
    for (const n of doc.nodes) {
      expect(n.position.x % 240).toBe(0);
      expect(n.position.y % 120).toBe(0);
    }
    const byId = Object.fromEntries(doc.nodes.map((n) => [n.id, n]));
    expect(byId.event.position).toEqual({ x: 0, y: 0 });
    expect(byId.event.kind).toBe("event");
    expect(byId.c1.position).toEqual({ x: 240, y: 0 });
    expect(byId.a1w1.position).toEqual({ x: 480, y: 0 });
    expect(byId.a1.position).toEqual({ x: 720, y: 0 });
    expect(byId.a2w1.position).toEqual({ x: 480, y: 120 });
    expect(byId.a2.position).toEqual({ x: 720, y: 120 });
    expect(byId.a3.position).toEqual({ x: 480, y: 240 });
    expect(doc.edges.map((e) => [e.source, e.target])).toEqual([
      ["event", "c1"],
      ["c1", "a1w1"],
      ["a1w1", "a1"],
      ["c1", "a2w1"],
      ["a2w1", "a2"],
      ["c1", "a3"],
    ]);
    expect(byId.a1.data).toEqual({ type: "move_to_lane", laneId: "l_rfp" });
  });
  it("draws a schedule event as a schedule node", () => {
    const doc = ruleToCanvas({ event: { type: "schedule", cron: "0 9 * * *", timezone: "UTC" }, conditions: [], actions: [{ type: "set_flag", flag: "needs_human" }] });
    expect(doc.nodes[0]).toEqual({ id: "schedule", kind: "schedule", position: { x: 0, y: 0 }, data: { type: "schedule", cron: "0 9 * * *", timezone: "UTC" } });
  });
});

describe("round trip", () => {
  const docs: Record<string, CanvasDoc> = {
    chain: { nodes: [ev, inEval, passed, toRfp], edges: [edge("ev", "c1"), edge("c1", "c2"), edge("c2", "a1")] },
    branches: {
      nodes: [ev, inEval, passed, failedTwice, toRfp, flag, comment],
      edges: [edge("ev", "c1"), edge("c1", "c2"), edge("c2", "a1"), edge("c1", "c3"), edge("c3", "a2"), edge("a2", "a3")],
    },
    fanIn: { nodes: [ev, passed, failedTwice, flag], edges: [edge("ev", "c2"), edge("ev", "c3"), edge("c2", "a2"), edge("c3", "a2")] },
    bare: { nodes: [ev, flag], edges: [edge("ev", "a2")] },
    schedule: { nodes: [node("s", "schedule", { cron: "0 9 * * 1-5", timezone: "Europe/London" }), inEval, flag], edges: [edge("s", "c1"), edge("c1", "a2")] },
  };
  it.each(Object.keys(docs))("canvas to rule to canvas to rule is stable: %s", (name) => {
    const first = ruleOf(docs[name]);
    const second = ruleOf(ruleToCanvas(first));
    expect(second.event).toEqual(first.event);
    expect(second.conditions).toEqual(first.conditions);
    expect(second.actions).toEqual(first.actions);
    expect(ruleToCanvas(second)).toEqual(ruleToCanvas(first));
  });
});
