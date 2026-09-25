import type { CanvasDoc, CanvasNodeKind } from "@boomerang/core";
import type { EdgeChange, NodeChange } from "@xyflow/react";

/**
 * The canvas store: the drawing as the canvas edits it, the selection, and a small history.
 * Plain React state (useReducer), no state library. `fromDoc` and `toDoc` convert between
 * this shape and the `CanvasDoc` the server keeps, so fromDoc then toDoc is the identity.
 *
 * The one thing this shape holds that the doc cannot is the Else edge. `CanvasEdge` is
 * strict (id, source, target), so an edge labelled "else" out of a condition C to a node T
 * is written to the doc as a synthesised condition node `C~else` holding `not C`, wired from
 * C's predecessors to T in C's place. That is exactly what the engine should run (the path
 * requires C to be false) and fromDoc folds it back into the labelled edge.
 */

export interface StoreNode {
  id: string;
  kind: CanvasNodeKind;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface StoreEdge {
  id: string;
  source: string;
  target: string;
  label?: "else";
}

interface Snapshot {
  nodes: StoreNode[];
  edges: StoreEdge[];
}

export interface CanvasState extends Snapshot {
  selectedNodes: string[];
  selectedEdges: string[];
  past: Snapshot[];
  future: Snapshot[];
  /** The drawing as it was when a drag started, committed to history when the drag ends. */
  pendingDrag: Snapshot | null;
}

export type CanvasAction =
  | { type: "load"; doc: CanvasDoc }
  | { type: "addNode"; node: StoreNode; from?: string; edgeId?: string }
  | { type: "connect"; source: string; target: string; edgeId?: string }
  | { type: "setData"; id: string; data: Record<string, unknown> }
  | { type: "setEdgeLabel"; id: string; label: "else" | undefined }
  | { type: "removeSelection" }
  | { type: "select"; nodeIds: string[]; edgeIds?: string[] }
  | { type: "nodesChange"; changes: NodeChange[] }
  | { type: "edgesChange"; changes: EdgeChange[] }
  | { type: "undo" }
  | { type: "redo" };

export const HISTORY_LIMIT = 10;
export const ELSE_SUFFIX = "~else";

const ELSE_RE = /^(.+)~else$/;

let counter = 0;
/** A node or edge id unique within a drawing: short, readable, and free of the else suffix. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}`;
}

/** The data a fresh node of a kind starts with. */
export function defaultData(kind: CanvasNodeKind): Record<string, unknown> {
  if (kind === "schedule") {
    let timezone = "UTC";
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      // keep UTC
    }
    return { timezone };
  }
  return {};
}

export function buildNode(kind: CanvasNodeKind, position: { x: number; y: number }, id = newId(kind[0])): StoreNode {
  return { id, kind, position, data: defaultData(kind) };
}

/** A new rule: one event node, in the middle, waiting for its event. */
export function initialDoc(): CanvasDoc {
  return { nodes: [{ id: "event", kind: "event", position: { x: 0, y: 0 }, data: {} }], edges: [] };
}

/** A short stable hash (FNV-1a, base 36) for a base id too long to carry the suffix within the 128 char limit. */
function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The id of the synthesised not-node for a condition: `<id>~else`, or a hash of the id when it would not fit. */
export function elseId(conditionId: string): string {
  const base = conditionId.length > 120 ? `h${hashId(conditionId)}` : conditionId;
  return `${base}${ELSE_SUFFIX}`;
}

/** Synthesised node id to the condition it negates, for every condition node in the list. */
function elseOwners(nodes: { id: string; kind: CanvasNodeKind }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of nodes) if (n.kind === "condition") m.set(elseId(n.id), n.id);
  return m;
}

export function fromDoc(doc: CanvasDoc): Snapshot {
  const owners = elseOwners(doc.nodes);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  // Synthesised node id -> the condition it negates, when the node really is that shape.
  const elseNodes = new Map<string, string>();
  for (const n of doc.nodes) {
    const owner = owners.get(n.id);
    if (owner !== undefined && n.kind === "condition" && n.data.kind === "not" && byId.get(owner)?.kind === "condition") elseNodes.set(n.id, owner);
  }
  const nodes: StoreNode[] = doc.nodes
    .filter((n) => !elseNodes.has(n.id))
    .map((n) => ({ id: n.id, kind: n.kind, position: { ...n.position }, data: clone(n.data) }));
  const edges: StoreEdge[] = [];
  for (const e of doc.edges) {
    if (elseNodes.has(e.target)) continue; // the feed into a synthesised node
    if (elseNodes.has(e.source)) edges.push({ id: e.id, source: elseNodes.get(e.source)!, target: e.target, label: "else" });
    else edges.push({ id: e.id, source: e.source, target: e.target });
  }
  return { nodes, edges };
}

/**
 * The doc form. An else edge out of condition C becomes a synthesised not-node in C's place:
 * it is fed by every edge into C, an else edge from B feeding it from B's own not-node, so a
 * chain B -else-> C -else-> T runs as not B, not C, T.
 */
export function toDoc(s: Snapshot): CanvasDoc {
  const nodes: CanvasDoc["nodes"] = s.nodes.map((n) => ({ id: n.id, kind: n.kind, position: { x: n.position.x, y: n.position.y }, data: clone(n.data) }));
  const edges: CanvasDoc["edges"] = [];
  const made = new Set<string>();
  const feed = (p: StoreEdge) => (p.label === "else" ? elseId(p.source) : p.source);
  for (const e of s.edges) {
    if (e.label !== "else") {
      edges.push({ id: e.id, source: e.source, target: e.target });
      continue;
    }
    const cond = s.nodes.find((n) => n.id === e.source);
    if (!cond) continue;
    const notId = elseId(cond.id);
    if (!made.has(notId)) {
      made.add(notId);
      nodes.push({ id: notId, kind: "condition", position: { x: cond.position.x, y: cond.position.y + 40 }, data: { kind: "not", condition: clone(cond.data) } });
      for (const p of s.edges) if (p.target === cond.id) edges.push({ id: elseId(p.id), source: feed(p), target: notId });
    }
    edges.push({ id: e.id, source: notId, target: e.target });
  }
  return { nodes, edges };
}

/** The node a server error or a dry run names, folded back to the node the canvas shows. */
export function ownerOf(nodeId: string, nodes: { id: string; kind: CanvasNodeKind }[] = []): string {
  const owner = elseOwners(nodes).get(nodeId);
  if (owner !== undefined) return owner;
  const m = ELSE_RE.exec(nodeId);
  return m ? m[1] : nodeId;
}

/** True when an id names a synthesised not-node rather than a drawn node. */
export function isElseId(nodeId: string, nodes: { id: string; kind: CanvasNodeKind }[] = []): boolean {
  return elseOwners(nodes).has(nodeId) || ELSE_RE.test(nodeId);
}

export function initialState(doc: CanvasDoc): CanvasState {
  return { ...fromDoc(doc), selectedNodes: [], selectedEdges: [], past: [], future: [], pendingDrag: null };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const snap = (s: Snapshot): Snapshot => ({ nodes: s.nodes, edges: s.edges });

/** Applies a change that belongs in the history: the drawing before it becomes the last undo step. */
function commit(s: CanvasState, next: Partial<Snapshot>, before: Snapshot = snap(s)): CanvasState {
  return { ...s, ...next, past: [...s.past.slice(-(HISTORY_LIMIT - 1)), before], future: [], pendingDrag: null };
}

/** Where a new node goes: to the right of the selected node (or the rightmost one), stepping down past anything already there. */
export function placeNear(s: Snapshot & { selectedNodes: string[] }): { position: { x: number; y: number }; from: string | undefined } {
  const anchor = s.nodes.find((n) => n.id === s.selectedNodes[0]) ?? s.nodes.find((n) => n.kind === "event" || n.kind === "schedule") ?? s.nodes[s.nodes.length - 1];
  if (!anchor) return { position: { x: 0, y: 0 }, from: undefined };
  const position = { x: anchor.position.x + 336, y: anchor.position.y };
  const taken = (p: { x: number; y: number }) => s.nodes.some((n) => Math.abs(n.position.x - p.x) < 200 && Math.abs(n.position.y - p.y) < 96);
  let guard = 0;
  while (taken(position) && guard++ < 50) position.y += 120;
  return { position, from: anchor.id };
}

function canConnect(s: Snapshot, source: string, target: string): boolean {
  if (source === target) return false;
  const to = s.nodes.find((n) => n.id === target);
  if (!to || to.kind === "event" || to.kind === "schedule") return false;
  if (!s.nodes.some((n) => n.id === source)) return false;
  return !s.edges.some((e) => e.source === source && e.target === target);
}

export function reducer(s: CanvasState, a: CanvasAction): CanvasState {
  switch (a.type) {
    case "load":
      return initialState(a.doc);
    case "addNode": {
      if (s.nodes.some((n) => n.id === a.node.id)) return s;
      const nodes = [...s.nodes, a.node];
      const edges = a.from && canConnect({ nodes, edges: s.edges }, a.from, a.node.id) ? [...s.edges, { id: a.edgeId ?? `${a.from}-${a.node.id}`, source: a.from, target: a.node.id }] : s.edges;
      return { ...commit(s, { nodes, edges }), selectedNodes: [a.node.id], selectedEdges: [] };
    }
    case "connect":
      if (!canConnect(s, a.source, a.target)) return s;
      return commit(s, { edges: [...s.edges, { id: a.edgeId ?? `${a.source}-${a.target}`, source: a.source, target: a.target }] });
    case "setData": {
      const nodes = s.nodes.map((n) => (n.id === a.id ? { ...n, data: a.data } : n));
      return commit(s, { nodes });
    }
    case "setEdgeLabel": {
      const edges = s.edges.map((e) => (e.id === a.id ? (a.label ? { ...e, label: a.label } : { id: e.id, source: e.source, target: e.target }) : e));
      return commit(s, { edges });
    }
    case "removeSelection": {
      if (!s.selectedNodes.length && !s.selectedEdges.length) return s;
      const gone = new Set(s.selectedNodes);
      const nodes = s.nodes.filter((n) => !gone.has(n.id));
      const edges = s.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target) && !s.selectedEdges.includes(e.id));
      return { ...commit(s, { nodes, edges }), selectedNodes: [], selectedEdges: [] };
    }
    case "select":
      return { ...s, selectedNodes: a.nodeIds, selectedEdges: a.edgeIds ?? [] };
    case "nodesChange": {
      let next = s;
      let nodes = s.nodes;
      let selected = s.selectedNodes;
      let touchedSelection = false;
      let dragging = false;
      let moved = false;
      for (const c of a.changes) {
        if (c.type === "select") {
          touchedSelection = true;
          selected = c.selected ? (selected.includes(c.id) ? selected : [...selected, c.id]) : selected.filter((id) => id !== c.id);
        } else if (c.type === "position" && c.position) {
          const p = c.position;
          nodes = nodes.map((n) => (n.id === c.id ? { ...n, position: { x: p.x, y: p.y } } : n));
          moved = true;
          if (c.dragging) dragging = true;
        }
      }
      if (moved) {
        if (dragging) {
          // Mid drag: keep the drawing live, remember where it started once.
          next = { ...next, nodes, pendingDrag: next.pendingDrag ?? snap(s) };
        } else if (next.pendingDrag) {
          // Drag end: the start of the drag is the undo step.
          next = commit({ ...next, nodes }, {}, next.pendingDrag);
        } else {
          // A keyboard nudge: one step per press.
          next = commit(next, { nodes });
        }
      }
      if (touchedSelection) next = { ...next, selectedNodes: selected };
      return next;
    }
    case "edgesChange": {
      let selected = s.selectedEdges;
      let touched = false;
      for (const c of a.changes) {
        if (c.type === "select") {
          touched = true;
          selected = c.selected ? (selected.includes(c.id) ? selected : [...selected, c.id]) : selected.filter((id) => id !== c.id);
        }
      }
      return touched ? { ...s, selectedEdges: selected } : s;
    }
    case "undo": {
      const before = s.past[s.past.length - 1];
      if (!before) return s;
      const live = new Set(before.nodes.map((n) => n.id));
      return { ...s, ...before, past: s.past.slice(0, -1), future: [snap(s), ...s.future].slice(0, HISTORY_LIMIT), pendingDrag: null, selectedNodes: s.selectedNodes.filter((id) => live.has(id)), selectedEdges: [] };
    }
    case "redo": {
      const after = s.future[0];
      if (!after) return s;
      const live = new Set(after.nodes.map((n) => n.id));
      return { ...s, ...after, past: [...s.past.slice(-(HISTORY_LIMIT - 1)), snap(s)], future: s.future.slice(1), pendingDrag: null, selectedNodes: s.selectedNodes.filter((id) => live.has(id)), selectedEdges: [] };
    }
  }
}
