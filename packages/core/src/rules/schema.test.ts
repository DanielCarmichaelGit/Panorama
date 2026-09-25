import { describe, expect, it } from "vitest";
import { ACTION_TYPES, ActionSchema, CanvasDocSchema, type Condition, ConditionSchema, conditionDepth, MAX_CONDITION_DEPTH, RULE_EVENT_TYPES, RuleActionSchema, RuleEventSchema, RuleSchema } from "../index";

describe("RuleEventSchema", () => {
  it("parses every event kind", () => {
    expect(RuleEventSchema.safeParse({ type: "ticket.created" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "ticket.moved", toLaneId: "l2" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "ticket.moved", fromLaneId: "l1", toLaneId: "l2" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "evidence.added", typeId: "et_eval_score", result: "pass" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "ticket.flag_set", flag: "needs_human" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "ticket.flag_cleared", flag: "blocked" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "ticket.updated", changed: "title" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "comment.added" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "timer.started" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "timer.stopped" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "cost.added" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "ticket.due_passed" }).success).toBe(true);
    expect(RuleEventSchema.safeParse({ type: "schedule", cron: "0 9 * * 1-5", timezone: "Europe/London" }).success).toBe(true);
  });
  it("lists exactly the spec's events", () => {
    expect([...RULE_EVENT_TYPES].sort()).toEqual(
      ["ticket.created", "ticket.moved", "ticket.updated", "ticket.flag_set", "ticket.flag_cleared", "evidence.added", "comment.added", "timer.started", "timer.stopped", "cost.added", "ticket.due_passed", "schedule"].sort()
    );
  });
  it("rejects an unknown type, an extra key, a bad cron and a bad timezone", () => {
    expect(RuleEventSchema.safeParse({ type: "ticket.deleted" }).success).toBe(false);
    expect(RuleEventSchema.safeParse({ type: "ticket.created", laneId: "l1" }).success).toBe(false);
    expect(RuleEventSchema.safeParse({ type: "evidence.added", result: "maybe" }).success).toBe(false);
    expect(RuleEventSchema.safeParse({ type: "schedule", cron: "every monday", timezone: "UTC" }).success).toBe(false);
    expect(RuleEventSchema.safeParse({ type: "schedule", cron: "0 9 * * *", timezone: "Mars/Olympus" }).success).toBe(false);
  });
});

describe("ConditionSchema", () => {
  const ok = (c: unknown) => expect(ConditionSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
  const bad = (c: unknown) => expect(ConditionSchema.safeParse(c).success, JSON.stringify(c)).toBe(false);

  it("parses id comparisons on lane, epic, board, tag and flag", () => {
    for (const kind of ["lane", "epic", "board", "tag", "flag"]) {
      ok({ kind, op: "is", value: "x" });
      ok({ kind, op: "is_not", value: "x" });
      ok({ kind, op: "in", values: ["x", "y"] });
      bad({ kind, op: "in", values: [] });
      bad({ kind, op: "is", value: "" });
      bad({ kind, op: "gte", value: "x" });
    }
    ok({ kind: "epic", op: "exists" });
    ok({ kind: "epic", op: "not_exists" });
    bad({ kind: "lane", op: "exists" });
  });
  it("parses title, assignee, due_date and actor", () => {
    ok({ kind: "title", op: "contains", value: "bug" });
    bad({ kind: "title", op: "gte", value: "bug" });
    ok({ kind: "assignee", op: "is", value: "a1" });
    ok({ kind: "assignee", op: "not_exists" });
    ok({ kind: "due_date", op: "lte", value: "2026-10-01" });
    bad({ kind: "due_date", op: "lte", value: "next week" });
    ok({ kind: "due_date", op: "exists" });
    ok({ kind: "actor", op: "is", value: "agent" });
    bad({ kind: "actor", op: "is", value: "robot" });
  });
  it("parses evidence counts", () => {
    ok({ kind: "evidence", typeId: "et_eval_score", result: "fail", op: "gte", count: 2 });
    ok({ kind: "evidence", typeId: "et_eval_score", op: "exists" });
    bad({ kind: "evidence", typeId: "et_eval_score", op: "gte", count: -1 });
    bad({ kind: "evidence", typeId: "et_eval_score", op: "gte" });
  });
  it("parses custom field comparisons by kind", () => {
    ok({ kind: "field", key: "severity", fieldKind: "select", op: "in", values: ["high"] });
    ok({ kind: "field", key: "retries", fieldKind: "number", op: "gte", value: 2 });
    bad({ kind: "field", key: "retries", fieldKind: "number", op: "gte", value: "2" });
    ok({ kind: "field", key: "notes", fieldKind: "text", op: "contains", value: "x" });
    ok({ kind: "field", key: "review", fieldKind: "date", op: "lte", value: "2026-09-30" });
    ok({ kind: "field", key: "urgent", fieldKind: "checkbox", op: "is", value: true });
    bad({ kind: "field", key: "urgent", fieldKind: "checkbox", op: "is", value: "yes" });
    ok({ kind: "field", key: "spec", fieldKind: "file", op: "exists" });
    bad({ kind: "field", key: "spec", fieldKind: "file", op: "is", value: "x" });
    bad({ kind: "field", key: "Bad Key", fieldKind: "text", op: "exists" });
  });
  it("composes with all, any and not", () => {
    ok({ kind: "all", conditions: [{ kind: "lane", op: "is", value: "l1" }, { kind: "not", condition: { kind: "flag", op: "is", value: "blocked" } }] });
    ok({ kind: "any", conditions: [] });
    bad({ kind: "not", condition: { kind: "lane", op: "nope" } });
  });
  it("accepts nesting eight deep and refuses nine", () => {
    const nest = (n: number): unknown => (n === 1 ? { kind: "lane", op: "is", value: "l1" } : { kind: "not", condition: nest(n - 1) });
    expect(MAX_CONDITION_DEPTH).toBe(8);
    expect(conditionDepth(nest(8) as Condition)).toBe(8);
    ok(nest(8));
    bad(nest(9));
    bad({ kind: "all", conditions: [nest(1), nest(8)] });
  });
  it("bounds ids at 128 and text at 2000", () => {
    ok({ kind: "lane", op: "is", value: "x".repeat(128) });
    bad({ kind: "lane", op: "is", value: "x".repeat(129) });
    ok({ kind: "title", op: "contains", value: "x".repeat(2000) });
    bad({ kind: "title", op: "contains", value: "x".repeat(2001) });
    bad({ kind: "field", key: "notes", fieldKind: "text", op: "is", value: "x".repeat(2001) });
    bad({ kind: "field", key: "severity", fieldKind: "select", op: "in", values: ["x".repeat(2001)] });
  });
});

describe("ActionSchema", () => {
  it("parses each action shape and rejects a bad one of each", () => {
    const cases: [unknown, unknown][] = [
      [{ type: "move_to_lane", laneId: "l1" }, { type: "move_to_lane" }],
      [{ type: "set_flag", flag: "needs_human" }, { type: "set_flag", flag: "Needs Human" }],
      [{ type: "clear_flag", flag: "blocked" }, { type: "clear_flag", flag: "needs_human" }],
      [{ type: "add_comment", body: "Moved {{ticket.key}}" }, { type: "add_comment", body: "" }],
      [{ type: "add_tag", tagId: "t1" }, { type: "add_tag", tagId: "" }],
      [{ type: "remove_tag", tagId: "t1" }, { type: "remove_tag" }],
      [{ type: "set_field", key: "retries", value: 3 }, { type: "set_field", key: "retries", value: [3] }],
      [{ type: "assign", actorId: "a1" }, { type: "assign", actorId: 7 }],
      [{ type: "assign", actorId: null }, { type: "assign" }],
      [{ type: "emit_webhook", destinationId: "d1" }, { type: "emit_webhook", destinationId: "d1", url: "https://x" }],
      [{ type: "set_epic", epicId: "e1" }, { type: "set_epic", epicId: "" }],
      [{ type: "set_epic", epicId: null }, { type: "set_epic" }],
      [{ type: "create_ticket", title: "Follow up on {{ticket.key}}", laneId: "l1" }, { type: "create_ticket", title: "", laneId: "l1" }],
      [{ type: "create_ticket", title: "Retest", laneId: "l1", boardId: "b1", epicId: "e1", tagIds: ["t1"] }, { type: "create_ticket", title: "Retest", laneId: "l1", assigneeId: "a1" }],
      [{ type: "move_to_board", boardId: "b2" }, { type: "move_to_board", boardId: "" }],
      [{ type: "start_timer" }, { type: "start_timer", actorId: "a1" }],
      [{ type: "stop_timer" }, { type: "stop_timer", ticketId: "t1" }],
    ];
    for (const [good, bad] of cases) {
      expect(ActionSchema.safeParse(good).success, JSON.stringify(good)).toBe(true);
      expect(ActionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(ActionSchema.safeParse({ type: "delete_ticket" }).success).toBe(false);
  });
  it("lists exactly the spec's actions", () => {
    expect([...ACTION_TYPES].sort()).toEqual(
      ["move_to_lane", "set_flag", "clear_flag", "assign", "add_tag", "remove_tag", "set_field", "set_epic", "add_comment", "emit_webhook", "create_ticket", "start_timer", "stop_timer", "move_to_board"].sort()
    );
  });
  it("a rule action may carry its own when list and nothing else extra", () => {
    expect(RuleActionSchema.safeParse({ type: "move_to_lane", laneId: "l1", when: [{ kind: "flag", op: "is_not", value: "blocked" }] }).success).toBe(true);
    expect(RuleActionSchema.safeParse({ type: "move_to_lane", laneId: "l1", when: [{ kind: "flag", op: "bogus" }] }).success).toBe(false);
    expect(RuleActionSchema.safeParse({ type: "move_to_lane", laneId: "l1", extra: 1 }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: "move_to_lane", laneId: "l1", when: [] }).success).toBe(false);
  });
});

describe("RuleSchema and CanvasDocSchema", () => {
  const canvas = { nodes: [{ id: "n1", kind: "event", position: { x: 0, y: 0 }, data: { type: "ticket.created" } }], edges: [] };
  const rule = {
    id: "r1",
    projectId: "p1",
    name: "Flag new work",
    enabled: true,
    event: { type: "ticket.created" },
    conditions: [],
    actions: [{ type: "set_flag", flag: "needs_human" }],
    canvas,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
  };
  it("parses a rule and rejects an extra key, an empty name and a bad canvas", () => {
    expect(RuleSchema.safeParse(rule).success).toBe(true);
    expect(RuleSchema.safeParse({ ...rule, priority: 1 }).success).toBe(false);
    expect(RuleSchema.safeParse({ ...rule, name: "" }).success).toBe(false);
    expect(CanvasDocSchema.safeParse(canvas).success).toBe(true);
    expect(CanvasDocSchema.safeParse({ nodes: [{ ...canvas.nodes[0], kind: "note" }], edges: [] }).success).toBe(false);
    expect(CanvasDocSchema.safeParse({ nodes: [], edges: [{ id: "e1", source: "a" }] }).success).toBe(false);
  });
});
