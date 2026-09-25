import { describe, expect, it } from "vitest";
import type { CanvasDoc } from "@boomerang/core";
import { canonical, canvasToRule } from "@boomerang/core";
import { HISTORY_LIMIT, buildNode, fromDoc, initialDoc, initialState, ownerOf, placeNear, reducer, toDoc, type CanvasState } from "./store";

const threeNodes: CanvasDoc = {
  nodes: [
    { id: "event", kind: "event", position: { x: 0, y: 0 }, data: { type: "ticket.moved", toLaneId: "eval" } },
    { id: "c1", kind: "condition", position: { x: 240, y: 0 }, data: { kind: "evidence", typeId: "et1", result: "pass", op: "exists" } },
    { id: "a1", kind: "action", position: { x: 480, y: 0 }, data: { type: "move_to_lane", laneId: "prod" } },
  ],
  edges: [
    { id: "event-c1", source: "event", target: "c1" },
    { id: "c1-a1", source: "c1", target: "a1" },
  ],
};

/** The same rule with an Else branch: the doc form carries the synthesised `c1~else` node, written after the drawn ones. */
const withElse: CanvasDoc = {
  nodes: [
    ...threeNodes.nodes,
    { id: "a2", kind: "action", position: { x: 480, y: 120 }, data: { type: "set_flag", flag: "needs_human" } },
    { id: "c1~else", kind: "condition", position: { x: 240, y: 40 }, data: { kind: "not", condition: { kind: "evidence", typeId: "et1", result: "pass", op: "exists" } } },
  ],
  edges: [
    ...threeNodes.edges,
    { id: "event-c1~else", source: "event", target: "c1~else" },
    { id: "else-a2", source: "c1~else", target: "a2" },
  ],
};

describe("store doc round trip", () => {
  it("fromDoc then toDoc is the identity on a plain drawing", () => {
    expect(canonical(toDoc(fromDoc(threeNodes)))).toBe(canonical(threeNodes));
  });

  it("folds the else node into a labelled edge and writes it back the same way", () => {
    const s = fromDoc(withElse);
    expect(s.nodes.map((n) => n.id)).toEqual(["event", "c1", "a1", "a2"]);
    const elseEdge = s.edges.find((e) => e.label === "else");
    expect(elseEdge).toMatchObject({ id: "else-a2", source: "c1", target: "a2" });
    expect(s.edges.filter((e) => e.target === "c1~else")).toHaveLength(0);
    expect(canonical(toDoc(s))).toBe(canonical(withElse));
  });

  it("writes a doc the engine runs as an else branch", () => {
    const r = canvasToRule(toDoc(fromDoc(withElse)));
    expect("rule" in r).toBe(true);
    if ("rule" in r) {
      expect(r.rule.actions).toHaveLength(2);
      expect(r.rule.actions[1].when).toEqual([{ kind: "not", condition: { kind: "evidence", typeId: "et1", result: "pass", op: "exists" } }]);
    }
  });

  it("maps a server error on the synthesised node back to the condition", () => {
    expect(ownerOf("c1~else")).toBe("c1");
    expect(ownerOf("a1")).toBe("a1");
  });

  it("a new rule is one event node in the middle", () => {
    const doc = initialDoc();
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]).toMatchObject({ kind: "event", position: { x: 0, y: 0 } });
  });
});

function withSelection(s: CanvasState, ids: string[]): CanvasState {
  return reducer(s, { type: "select", nodeIds: ids });
}

describe("store reducer", () => {
  it("keyboard creation from the event node makes a condition then an action, each connected to the last", () => {
    let s = initialState(initialDoc());
    s = withSelection(s, ["event"]);
    let near = placeNear(s);
    expect(near.from).toBe("event");
    const c = buildNode("condition", near.position, "c1");
    s = reducer(s, { type: "addNode", node: c, from: near.from });
    expect(s.selectedNodes).toEqual(["c1"]);
    near = placeNear(s);
    expect(near.from).toBe("c1");
    expect(near.position.x).toBeGreaterThan(c.position.x);
    const a = buildNode("action", near.position, "a1");
    s = reducer(s, { type: "addNode", node: a, from: near.from });
    expect(s.edges.map((e) => [e.source, e.target])).toEqual([
      ["event", "c1"],
      ["c1", "a1"],
    ]);
    const r = canvasToRule(toDoc(s));
    // Connected, so the only complaints are the empty choices in each node.
    expect("errors" in r && r.errors.map((e) => e.code)).toEqual(["invalid", "invalid", "invalid"]);
  });

  it("never connects into an event node, from a node to itself, or twice", () => {
    let s = initialState(threeNodes);
    s = reducer(s, { type: "connect", source: "a1", target: "event" });
    s = reducer(s, { type: "connect", source: "a1", target: "a1" });
    s = reducer(s, { type: "connect", source: "event", target: "c1" });
    expect(s.edges).toHaveLength(2);
    s = reducer(s, { type: "connect", source: "event", target: "a1" });
    expect(s.edges).toHaveLength(3);
  });

  it("removes the selection with its edges and undoes and redoes it", () => {
    let s = initialState(threeNodes);
    s = withSelection(s, ["c1"]);
    s = reducer(s, { type: "removeSelection" });
    expect(s.nodes.map((n) => n.id)).toEqual(["event", "a1"]);
    expect(s.edges).toHaveLength(0);
    s = reducer(s, { type: "undo" });
    expect(canonical(toDoc(s))).toBe(canonical(threeNodes));
    s = reducer(s, { type: "redo" });
    expect(s.nodes.map((n) => n.id)).toEqual(["event", "a1"]);
  });

  it("keeps the last ten steps", () => {
    let s = initialState(threeNodes);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) s = reducer(s, { type: "setData", id: "a1", data: { type: "move_to_lane", laneId: `l${i}` } });
    expect(s.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) s = reducer(s, { type: "undo" });
    expect(s.nodes.find((n) => n.id === "a1")?.data.laneId).toBe("l4");
  });

  it("a drag is one undo step from where it started; a nudge is one step per press", () => {
    let s = initialState(threeNodes);
    s = reducer(s, { type: "nodesChange", changes: [{ type: "position", id: "a1", position: { x: 500, y: 0 }, dragging: true }] });
    s = reducer(s, { type: "nodesChange", changes: [{ type: "position", id: "a1", position: { x: 520, y: 0 }, dragging: true }] });
    s = reducer(s, { type: "nodesChange", changes: [{ type: "position", id: "a1", position: { x: 520, y: 0 }, dragging: false }] });
    expect(s.past).toHaveLength(1);
    s = reducer(s, { type: "nodesChange", changes: [{ type: "position", id: "a1", position: { x: 528, y: 0 } }] });
    expect(s.past).toHaveLength(2);
    s = reducer(s, { type: "undo" });
    expect(s.nodes.find((n) => n.id === "a1")?.position.x).toBe(520);
    s = reducer(s, { type: "undo" });
    expect(s.nodes.find((n) => n.id === "a1")?.position.x).toBe(480);
  });

  it("sets and clears the else label on an edge", () => {
    let s = initialState(threeNodes);
    s = reducer(s, { type: "setEdgeLabel", id: "c1-a1", label: "else" });
    expect(toDoc(s).nodes.some((n) => n.id === "c1~else")).toBe(true);
    s = reducer(s, { type: "setEdgeLabel", id: "c1-a1", label: undefined });
    expect(canonical(toDoc(s))).toBe(canonical(threeNodes));
  });
});
