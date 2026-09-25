import { canonical } from "../canonical";
import { ACTION_TARGET_KEY, ActionSchema, CANVAS_NODE_KINDS, CanvasDoc, CanvasNode, Condition, ConditionSchema, RuleAction, RuleBody, RuleEvent, RuleEventSchema } from "./schema";

/**
 * How a drawing becomes a rule.
 *
 * The canvas is a directed graph from one event (or schedule) node. Conditions on the path
 * from the event to an action chain as `all`; two paths into the same action branch as `any`
 * (one `any` of one `all` per path). The conditions every action shares, the common prefix of
 * all paths counted in nodes, become the rule's `conditions`; whatever remains on an action's
 * own paths becomes that action's `when`. When every action ends up with the same `when` it
 * is lifted into `conditions` too, so a rule has one canonical form and the round trip
 * canvas, rule, canvas, rule is stable. Action nodes may chain (Then after Then): a later
 * action inherits the conditions of the path, never the earlier action.
 *
 * Errors are named so the canvas can light the offending node:
 *   no_event, two_events, cycle, unknown_kind:<nodeId>, disconnected:<nodeId>,
 *   missing_target:<nodeId> (an action whose picker value is empty), invalid:<nodeId>
 *   (data that does not parse for any other reason), bad_edge:<edgeId> (an edge to a node
 *   not on the canvas).
 */

export type CanvasErrorCode = "no_event" | "two_events" | "cycle" | "unknown_kind" | "disconnected" | "missing_target" | "invalid" | "bad_edge";
export interface CanvasError {
  name: string;
  code: CanvasErrorCode;
  nodeId?: string;
  edgeId?: string;
}

const err = (code: CanvasErrorCode, ref?: { nodeId?: string; edgeId?: string }): CanvasError => ({
  name: ref?.nodeId ? `${code}:${ref.nodeId}` : ref?.edgeId ? `${code}:${ref.edgeId}` : code,
  code,
  ...(ref?.nodeId ? { nodeId: ref.nodeId } : {}),
  ...(ref?.edgeId ? { edgeId: ref.edgeId } : {}),
});

const isEmpty = (v: unknown) => v === undefined || v === "";

/** Parses one node's data with the strict schema for its kind. */
function parseNode(n: CanvasNode): { ok: true; data: RuleEvent | Condition | RuleAction } | { ok: false; error: CanvasError } {
  const invalid = { ok: false as const, error: err("invalid", { nodeId: n.id }) };
  switch (n.kind) {
    case "event": {
      const r = RuleEventSchema.safeParse(n.data);
      return r.success && r.data.type !== "schedule" ? { ok: true, data: r.data } : invalid;
    }
    case "schedule": {
      const r = RuleEventSchema.safeParse({ ...n.data, type: "schedule" });
      return r.success ? { ok: true, data: r.data } : invalid;
    }
    case "condition": {
      const r = ConditionSchema.safeParse(n.data);
      return r.success ? { ok: true, data: r.data } : invalid;
    }
    case "action": {
      const type = n.data.type as keyof typeof ACTION_TARGET_KEY;
      const targetKey = Object.prototype.hasOwnProperty.call(ACTION_TARGET_KEY, type) ? ACTION_TARGET_KEY[type] : undefined;
      if (targetKey && isEmpty(n.data[targetKey])) return { ok: false, error: err("missing_target", { nodeId: n.id }) };
      const r = ActionSchema.safeParse(n.data);
      return r.success ? { ok: true, data: r.data } : invalid;
    }
  }
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export function canvasToRule(doc: CanvasDoc): { rule: RuleBody } | { errors: CanvasError[] } {
  const errors: CanvasError[] = [];
  const known = new Map<string, CanvasNode>();
  for (const n of doc.nodes) {
    if (!(CANVAS_NODE_KINDS as readonly string[]).includes(n.kind)) errors.push(err("unknown_kind", { nodeId: n.id }));
    else known.set(n.id, n);
  }
  const edges = doc.edges.filter((e) => {
    const ok = known.has(e.source) && known.has(e.target);
    if (!ok) errors.push(err("bad_edge", { edgeId: e.id }));
    return ok;
  });
  const out = new Map<string, string[]>([...known.keys()].map((id) => [id, []]));
  for (const e of edges) out.get(e.source)!.push(e.target);

  const starts = [...known.values()].filter((n) => n.kind === "event" || n.kind === "schedule");
  if (starts.length === 0) errors.push(err("no_event"));
  else if (starts.length > 1) errors.push(err("two_events"));

  // Cycle: a back edge in a depth first walk over every node.
  const state = new Map<string, 1 | 2>();
  const hasCycle = (id: string): boolean => {
    const s = state.get(id);
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    const cyc = out.get(id)!.some(hasCycle);
    state.set(id, 2);
    return cyc;
  };
  const cyclic = [...known.keys()].some(hasCycle);
  if (cyclic) errors.push(err("cycle"));

  if (starts.length === 1) {
    const reached = new Set<string>([starts[0].id]);
    const queue = [starts[0].id];
    while (queue.length) for (const next of out.get(queue.shift()!)!) if (!reached.has(next)) reached.add(next), queue.push(next);
    for (const n of known.values()) if (!reached.has(n.id)) errors.push(err("disconnected", { nodeId: n.id }));
  }

  const parsed = new Map<string, RuleEvent | Condition | RuleAction>();
  for (const n of known.values()) {
    const r = parseNode(n);
    if (r.ok) parsed.set(n.id, r.data);
    else errors.push(r.error);
  }
  if (errors.length) return { errors };

  // Every path from the event to each action, as the condition node ids along it.
  const start = starts[0].id;
  const actionOrder: string[] = [];
  const paths = new Map<string, string[][]>();
  const walk = (id: string, conds: string[]) => {
    const node = known.get(id)!;
    const here = node.kind === "condition" ? [...conds, id] : conds;
    if (node.kind === "action") {
      if (!paths.has(id)) (actionOrder.push(id), paths.set(id, []));
      paths.get(id)!.push(here);
    }
    for (const next of out.get(id)!) walk(next, here);
  };
  walk(start, []);

  const allPaths = actionOrder.flatMap((id) => paths.get(id)!);
  let prefix = allPaths.length ? allPaths[0] : [];
  for (const p of allPaths) {
    let i = 0;
    while (i < prefix.length && i < p.length && prefix[i] === p[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const cond = (id: string) => parsed.get(id) as Condition;

  const actions: RuleAction[] = actionOrder.map((id) => {
    const rests = paths.get(id)!.map((p) => p.slice(prefix.length));
    const action = parsed.get(id) as RuleAction;
    if (rests.some((r) => r.length === 0)) return action;
    if (rests.length === 1) return { ...action, when: rests[0].map(cond) };
    return { ...action, when: [{ kind: "any", conditions: rests.map((r) => (r.length === 1 ? cond(r[0]) : { kind: "all", conditions: r.map(cond) })) }] };
  });
  const conditions = prefix.map(cond);
  const shared = actions.length && actions[0].when && actions.every((a) => same(a.when, actions[0].when)) ? actions[0].when : undefined;
  return {
    rule: {
      event: parsed.get(start) as RuleEvent,
      conditions: shared ? [...conditions, ...shared] : conditions,
      actions: shared ? actions.map(({ when: _when, ...a }) => a) : actions,
    },
  };
}

export const CANVAS_GRID = { x: 240, y: 120 } as const;

/** Draws a rule left to right: the event, the shared conditions in a row, then one row per
 *  action holding its own `when` chain and the action. Deterministic, so two draws of one
 *  rule are equal and a saved drawing can be compared with a fresh one. */
export function ruleToCanvas(rule: RuleBody): CanvasDoc {
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const at = (col: number, row: number) => ({ x: col * CANVAS_GRID.x, y: row * CANVAS_GRID.y });
  const nodes: CanvasNode[] = [];
  const edges: CanvasDoc["edges"] = [];
  const link = (source: string, target: string) => edges.push({ id: `${source}-${target}`, source, target });

  const startId = rule.event.type === "schedule" ? "schedule" : "event";
  nodes.push({ id: startId, kind: rule.event.type === "schedule" ? "schedule" : "event", position: at(0, 0), data: clone(rule.event) });
  let last = startId;
  rule.conditions.forEach((c, i) => {
    const id = `c${i + 1}`;
    nodes.push({ id, kind: "condition", position: at(i + 1, 0), data: clone(c) as Record<string, unknown> });
    link(last, id);
    last = id;
  });
  const shared = last;
  const base = rule.conditions.length + 1;
  rule.actions.forEach(({ when = [], ...action }, j) => {
    let prev = shared;
    when.forEach((c, k) => {
      const id = `a${j + 1}w${k + 1}`;
      nodes.push({ id, kind: "condition", position: at(base + k, j), data: clone(c) as Record<string, unknown> });
      link(prev, id);
      prev = id;
    });
    const id = `a${j + 1}`;
    nodes.push({ id, kind: "action", position: at(base + when.length, j), data: clone(action) });
    link(prev, id);
  });
  return { nodes, edges };
}
