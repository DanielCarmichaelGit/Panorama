import { describe, expect, it } from "vitest";
import { escapeMarkdown, evaluateCondition, evaluateRule, matchesEvent, renderTemplate, type Condition, type EngineEvent, type Rule, type RuleContext, type RuleEvent } from "../index";

const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  ticket: {
    id: "t1",
    key: "BOOM-7",
    title: "Fix the <b>login</b> bug",
    boardId: "b1",
    laneId: "l_eval",
    epicId: "e1",
    tagIds: ["tag_bug", "tag_auth"],
    flags: ["blocked"],
    assigneeId: "agent_1",
    dueDate: "2026-10-01",
    fields: { severity: "high", retries: 2, notes: "see thread", review: "2026-09-30", urgent: true, spec: { attachmentId: "att1" }, empty: null },
  },
  lane: { id: "l_eval", name: "Eval" },
  evidence: [
    { typeId: "et_eval_score", result: "fail" },
    { typeId: "et_eval_score", result: "fail" },
    { typeId: "et_test_run", result: "pass" },
  ],
  actorKind: "agent",
  ...over,
});

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: "r1",
  projectId: "p1",
  name: "Test",
  enabled: true,
  event: { type: "ticket.moved", toLaneId: "l_eval" },
  conditions: [],
  actions: [{ type: "set_flag", flag: "needs_human" }],
  canvas: { nodes: [], edges: [] },
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
  ...over,
});

const moved: EngineEvent = { type: "ticket.moved", payload: { id: "t1", projectId: "p1", from: "l_progress", to: "l_eval" } };

describe("matchesEvent", () => {
  const cases: [RuleEvent, EngineEvent, boolean][] = [
    [{ type: "ticket.created" }, { type: "ticket.created", payload: { id: "t1" } }, true],
    [{ type: "ticket.created" }, moved, false],
    [{ type: "ticket.moved" }, moved, true],
    [{ type: "ticket.moved", toLaneId: "l_eval" }, moved, true],
    [{ type: "ticket.moved", toLaneId: "l_done" }, moved, false],
    [{ type: "ticket.moved", fromLaneId: "l_progress", toLaneId: "l_eval" }, moved, true],
    [{ type: "ticket.moved", fromLaneId: "l_backlog" }, moved, false],
    [{ type: "evidence.added", typeId: "et_eval_score", result: "pass" }, { type: "evidence.added", payload: { typeId: "et_eval_score", result: "pass" } }, true],
    [{ type: "evidence.added", typeId: "et_eval_score", result: "pass" }, { type: "evidence.added", payload: { typeId: "et_eval_score", result: "fail" } }, false],
    [{ type: "evidence.added", typeId: "et_eval_score" }, { type: "evidence.added", payload: { typeId: "et_test_run", result: "pass" } }, false],
    [{ type: "evidence.added" }, { type: "evidence.added", payload: { typeId: "et_test_run", result: "pass" } }, true],
    [{ type: "ticket.flag_set", flag: "needs_human" }, { type: "ticket.flag_set", payload: { flag: "needs_human" } }, true],
    [{ type: "ticket.flag_set", flag: "needs_human" }, { type: "ticket.flag_set", payload: { flag: "blocked" } }, false],
    [{ type: "ticket.flag_cleared" }, { type: "ticket.flag_cleared", payload: { flag: "blocked" } }, true],
    [{ type: "ticket.updated", changed: "title" }, { type: "ticket.updated", payload: { changed: ["title", "dueDate"] } }, true],
    [{ type: "ticket.updated", changed: "epicId" }, { type: "ticket.updated", payload: { changed: ["title"] } }, false],
    [{ type: "ticket.updated" }, { type: "ticket.updated", payload: { changed: [] } }, true],
    [{ type: "comment.added" }, { type: "comment.added", payload: { id: "c1" } }, true],
    [{ type: "timer.started" }, { type: "timer.started", payload: { ticketId: "t1", actorId: "a1" } }, true],
    [{ type: "timer.stopped" }, { type: "timer.started", payload: { ticketId: "t1", actorId: "a1" } }, false],
    [{ type: "cost.added" }, { type: "cost.added", payload: { ticketId: "t1", model: "m" } }, true],
    [{ type: "ticket.due_passed" }, { type: "ticket.due_passed", payload: { ticketId: "t1", dueDate: "2026-10-01" } }, true],
    [{ type: "ticket.due_passed" }, { type: "ticket.updated", payload: { changed: ["dueDate"] } }, false],
    [{ type: "schedule", cron: "* * * * *", timezone: "UTC" }, { type: "trigger.fired", payload: { ruleId: "r1" } }, true],
    [{ type: "schedule", cron: "* * * * *", timezone: "UTC" }, { type: "trigger.fired", payload: { ruleId: "r2" } }, false],
  ];
  it.each(cases)("%j against %j gives %s", (re, ev, expected) => {
    expect(matchesEvent(re, ev, "r1")).toBe(expected);
  });
});

describe("evaluateCondition", () => {
  const c = ctx();
  const yes = (cond: Condition) => expect(evaluateCondition(cond, c), JSON.stringify(cond)).toBe(true);
  const no = (cond: Condition) => expect(evaluateCondition(cond, c), JSON.stringify(cond)).toBe(false);

  it("lane", () => {
    yes({ kind: "lane", op: "is", value: "l_eval" });
    no({ kind: "lane", op: "is", value: "l_done" });
    yes({ kind: "lane", op: "is_not", value: "l_done" });
    no({ kind: "lane", op: "is_not", value: "l_eval" });
    yes({ kind: "lane", op: "in", values: ["l_done", "l_eval"] });
    no({ kind: "lane", op: "in", values: ["l_done"] });
  });
  it("epic", () => {
    yes({ kind: "epic", op: "is", value: "e1" });
    no({ kind: "epic", op: "is", value: "e2" });
    yes({ kind: "epic", op: "is_not", value: "e2" });
    no({ kind: "epic", op: "is_not", value: "e1" });
    yes({ kind: "epic", op: "in", values: ["e1"] });
    no({ kind: "epic", op: "in", values: ["e2"] });
    yes({ kind: "epic", op: "exists" });
    no({ kind: "epic", op: "not_exists" });
    expect(evaluateCondition({ kind: "epic", op: "not_exists" }, ctx({ ticket: { ...c.ticket, epicId: null } }))).toBe(true);
    expect(evaluateCondition({ kind: "epic", op: "exists" }, ctx({ ticket: { ...c.ticket, epicId: null } }))).toBe(false);
    expect(evaluateCondition({ kind: "epic", op: "is_not", value: "e1" }, ctx({ ticket: { ...c.ticket, epicId: null } }))).toBe(true);
  });
  it("board", () => {
    yes({ kind: "board", op: "is", value: "b1" });
    no({ kind: "board", op: "is", value: "b2" });
    yes({ kind: "board", op: "is_not", value: "b2" });
    no({ kind: "board", op: "is_not", value: "b1" });
    yes({ kind: "board", op: "in", values: ["b1", "b2"] });
    no({ kind: "board", op: "in", values: ["b2"] });
  });
  it("tag: is means has, is_not means lacks, in means has any of", () => {
    yes({ kind: "tag", op: "is", value: "tag_bug" });
    no({ kind: "tag", op: "is", value: "tag_docs" });
    yes({ kind: "tag", op: "is_not", value: "tag_docs" });
    no({ kind: "tag", op: "is_not", value: "tag_bug" });
    yes({ kind: "tag", op: "in", values: ["tag_docs", "tag_auth"] });
    no({ kind: "tag", op: "in", values: ["tag_docs"] });
  });
  it("flag", () => {
    yes({ kind: "flag", op: "is", value: "blocked" });
    no({ kind: "flag", op: "is", value: "needs_human" });
    yes({ kind: "flag", op: "is_not", value: "needs_human" });
    no({ kind: "flag", op: "is_not", value: "blocked" });
    yes({ kind: "flag", op: "in", values: ["needs_human", "blocked"] });
    no({ kind: "flag", op: "in", values: ["needs_human"] });
  });
  it("title", () => {
    yes({ kind: "title", op: "is", value: "Fix the <b>login</b> bug" });
    no({ kind: "title", op: "is", value: "Fix" });
    yes({ kind: "title", op: "is_not", value: "Fix" });
    no({ kind: "title", op: "is_not", value: "Fix the <b>login</b> bug" });
    yes({ kind: "title", op: "contains", value: "LOGIN" });
    no({ kind: "title", op: "contains", value: "logout" });
  });
  it("assignee", () => {
    yes({ kind: "assignee", op: "is", value: "agent_1" });
    no({ kind: "assignee", op: "is", value: "agent_2" });
    yes({ kind: "assignee", op: "is_not", value: "agent_2" });
    no({ kind: "assignee", op: "is_not", value: "agent_1" });
    yes({ kind: "assignee", op: "exists" });
    no({ kind: "assignee", op: "not_exists" });
    expect(evaluateCondition({ kind: "assignee", op: "not_exists" }, ctx({ ticket: { ...c.ticket, assigneeId: null } }))).toBe(true);
    expect(evaluateCondition({ kind: "assignee", op: "exists" }, ctx({ ticket: { ...c.ticket, assigneeId: null } }))).toBe(false);
  });
  it("due_date", () => {
    yes({ kind: "due_date", op: "gte", value: "2026-10-01" });
    no({ kind: "due_date", op: "gte", value: "2026-10-02" });
    yes({ kind: "due_date", op: "lte", value: "2026-10-01" });
    no({ kind: "due_date", op: "lte", value: "2026-09-30" });
    yes({ kind: "due_date", op: "exists" });
    no({ kind: "due_date", op: "not_exists" });
    const undated = ctx({ ticket: { ...c.ticket, dueDate: null } });
    expect(evaluateCondition({ kind: "due_date", op: "not_exists" }, undated)).toBe(true);
    expect(evaluateCondition({ kind: "due_date", op: "exists" }, undated)).toBe(false);
    expect(evaluateCondition({ kind: "due_date", op: "gte", value: "2000-01-01" }, undated)).toBe(false);
    expect(evaluateCondition({ kind: "due_date", op: "lte", value: "2999-01-01" }, undated)).toBe(false);
  });
  it("evidence counts, with and without a result", () => {
    yes({ kind: "evidence", typeId: "et_eval_score", result: "fail", op: "gte", count: 2 });
    no({ kind: "evidence", typeId: "et_eval_score", result: "fail", op: "gte", count: 3 });
    yes({ kind: "evidence", typeId: "et_eval_score", result: "fail", op: "lte", count: 2 });
    no({ kind: "evidence", typeId: "et_eval_score", result: "fail", op: "lte", count: 1 });
    yes({ kind: "evidence", typeId: "et_eval_score", op: "is", count: 2 });
    no({ kind: "evidence", typeId: "et_eval_score", result: "pass", op: "is", count: 2 });
    yes({ kind: "evidence", typeId: "et_test_run", op: "exists" });
    no({ kind: "evidence", typeId: "et_test_run", result: "fail", op: "exists" });
    yes({ kind: "evidence", typeId: "et_pr_link", op: "not_exists" });
    no({ kind: "evidence", typeId: "et_test_run", op: "not_exists" });
  });
  it("custom fields by kind", () => {
    yes({ kind: "field", key: "severity", fieldKind: "select", op: "is", value: "high" });
    no({ kind: "field", key: "severity", fieldKind: "select", op: "is", value: "low" });
    yes({ kind: "field", key: "severity", fieldKind: "select", op: "is_not", value: "low" });
    no({ kind: "field", key: "severity", fieldKind: "select", op: "is_not", value: "high" });
    yes({ kind: "field", key: "severity", fieldKind: "select", op: "in", values: ["high", "low"] });
    no({ kind: "field", key: "severity", fieldKind: "select", op: "in", values: ["low"] });
    yes({ kind: "field", key: "retries", fieldKind: "number", op: "is", value: 2 });
    no({ kind: "field", key: "retries", fieldKind: "number", op: "is", value: 3 });
    yes({ kind: "field", key: "retries", fieldKind: "number", op: "is_not", value: 3 });
    no({ kind: "field", key: "retries", fieldKind: "number", op: "is_not", value: 2 });
    yes({ kind: "field", key: "retries", fieldKind: "number", op: "gte", value: 2 });
    no({ kind: "field", key: "retries", fieldKind: "number", op: "gte", value: 3 });
    yes({ kind: "field", key: "retries", fieldKind: "number", op: "lte", value: 2 });
    no({ kind: "field", key: "retries", fieldKind: "number", op: "lte", value: 1 });
    yes({ kind: "field", key: "notes", fieldKind: "text", op: "is", value: "see thread" });
    no({ kind: "field", key: "notes", fieldKind: "text", op: "is", value: "thread" });
    yes({ kind: "field", key: "notes", fieldKind: "text", op: "is_not", value: "thread" });
    no({ kind: "field", key: "notes", fieldKind: "text", op: "is_not", value: "see thread" });
    yes({ kind: "field", key: "notes", fieldKind: "text", op: "contains", value: "THREAD" });
    no({ kind: "field", key: "notes", fieldKind: "text", op: "contains", value: "needle" });
    yes({ kind: "field", key: "review", fieldKind: "date", op: "is", value: "2026-09-30" });
    no({ kind: "field", key: "review", fieldKind: "date", op: "is", value: "2026-09-29" });
    yes({ kind: "field", key: "review", fieldKind: "date", op: "gte", value: "2026-09-30" });
    no({ kind: "field", key: "review", fieldKind: "date", op: "gte", value: "2026-10-01" });
    yes({ kind: "field", key: "review", fieldKind: "date", op: "lte", value: "2026-09-30" });
    no({ kind: "field", key: "review", fieldKind: "date", op: "lte", value: "2026-09-29" });
    yes({ kind: "field", key: "urgent", fieldKind: "checkbox", op: "is", value: true });
    no({ kind: "field", key: "urgent", fieldKind: "checkbox", op: "is", value: false });
    yes({ kind: "field", key: "spec", fieldKind: "file", op: "exists" });
    no({ kind: "field", key: "spec", fieldKind: "file", op: "not_exists" });
    yes({ kind: "field", key: "empty", fieldKind: "text", op: "not_exists" });
    no({ kind: "field", key: "empty", fieldKind: "text", op: "exists" });
    yes({ kind: "field", key: "missing", fieldKind: "number", op: "not_exists" });
    no({ kind: "field", key: "missing", fieldKind: "number", op: "exists" });
  });
  it("a field whose stored value is the wrong kind never matches a comparison", () => {
    no({ kind: "field", key: "severity", fieldKind: "number", op: "gte", value: 0 });
    no({ kind: "field", key: "retries", fieldKind: "text", op: "contains", value: "2" });
    no({ kind: "field", key: "urgent", fieldKind: "number", op: "exists" });
    yes({ kind: "field", key: "urgent", fieldKind: "number", op: "not_exists" });
  });
  it("actor kind", () => {
    yes({ kind: "actor", op: "is", value: "agent" });
    no({ kind: "actor", op: "is", value: "human" });
    yes({ kind: "actor", op: "is_not", value: "human" });
    no({ kind: "actor", op: "is_not", value: "agent" });
    expect(evaluateCondition({ kind: "actor", op: "is", value: "system" }, ctx({ actorKind: "system" }))).toBe(true);
  });
  it("all, any and not compose, and empty composites are the identities", () => {
    const t: Condition = { kind: "lane", op: "is", value: "l_eval" };
    const f: Condition = { kind: "lane", op: "is", value: "l_done" };
    yes({ kind: "all", conditions: [t, t] });
    no({ kind: "all", conditions: [t, f] });
    yes({ kind: "all", conditions: [] });
    yes({ kind: "any", conditions: [f, t] });
    no({ kind: "any", conditions: [f, f] });
    no({ kind: "any", conditions: [] });
    yes({ kind: "not", condition: f });
    no({ kind: "not", condition: t });
    yes({ kind: "not", condition: { kind: "any", conditions: [f, { kind: "not", condition: t }] } });
  });
});

describe("evaluateRule", () => {
  it("returns the actions when the event matches and the conditions hold", () => {
    expect(evaluateRule(rule(), moved, ctx())).toEqual([{ type: "set_flag", flag: "needs_human" }]);
  });
  it("returns [] for a disabled rule, a non-matching event, or failing conditions", () => {
    expect(evaluateRule(rule({ enabled: false }), moved, ctx())).toEqual([]);
    expect(evaluateRule(rule(), { type: "ticket.created", payload: { id: "t1" } }, ctx())).toEqual([]);
    expect(evaluateRule(rule({ conditions: [{ kind: "flag", op: "is_not", value: "blocked" }] }), moved, ctx())).toEqual([]);
  });
  it("applies each action's own when list on top of the rule's conditions and strips it", () => {
    const r = rule({
      conditions: [{ kind: "epic", op: "is", value: "e1" }],
      actions: [
        { type: "move_to_lane", laneId: "l_rfp", when: [{ kind: "evidence", typeId: "et_eval_score", result: "fail", op: "lte", count: 1 }] },
        { type: "set_flag", flag: "needs_human", when: [{ kind: "evidence", typeId: "et_eval_score", result: "fail", op: "gte", count: 2 }] },
        { type: "add_comment", body: "Eval failed twice on {{ticket.key}}" },
      ],
    });
    expect(evaluateRule(r, moved, ctx())).toEqual([
      { type: "set_flag", flag: "needs_human" },
      { type: "add_comment", body: "Eval failed twice on BOOM-7" },
    ]);
  });
  it("renders comment templates with the four placeholders and escapes markdown in the values", () => {
    const r = rule({ actions: [{ type: "add_comment", body: "{{ticket.key}} {{ticket.title}} entered {{lane.name}} on {{event.type}} {{unknown}} {{ ticket.key }}" }] });
    expect(evaluateRule(r, moved, ctx())).toEqual([
      { type: "add_comment", body: "BOOM-7 Fix the \\<b\\>login\\</b\\> bug entered Eval on ticket.moved {{unknown}} BOOM-7" },
    ]);
  });
  it("renders the title template of create_ticket the same way", () => {
    const r = rule({ actions: [{ type: "create_ticket", title: "Retest {{ticket.key}}: {{ticket.title}}", laneId: "l_ready", tagIds: ["tag_bug"] }] });
    expect(evaluateRule(r, moved, ctx({ ticket: { ...ctx().ticket, title: "*bold* move" } }))).toEqual([
      { type: "create_ticket", title: "Retest BOOM-7: \\*bold\\* move", laneId: "l_ready", tagIds: ["tag_bug"] },
    ]);
  });
  it("refuses a condition nested deeper than the cap rather than evaluating it", () => {
    const nest = (n: number): Condition => (n === 1 ? { kind: "lane", op: "is", value: "l_eval" } : { kind: "not", condition: nest(n - 1) });
    expect(evaluateCondition(nest(8), ctx())).toBe(false);
    expect(() => evaluateCondition(nest(9), ctx())).toThrow(RangeError);
    expect(() => evaluateRule(rule({ conditions: [nest(9)] }), moved, ctx())).toThrow(RangeError);
  });
  it("does not mutate the rule", () => {
    const r = rule({ actions: [{ type: "add_comment", body: "{{ticket.key}}", when: [] }] });
    const copy = JSON.parse(JSON.stringify(r));
    evaluateRule(r, moved, ctx());
    expect(r).toEqual(copy);
  });
});

describe("renderTemplate", () => {
  it("backslash-escapes markdown specials in substituted values only, leaving the template alone", () => {
    const out = renderTemplate("<b>{{ticket.title}}</b> & {{lane.name}}", { ticket: { key: "K", title: `Tom & "Jerry" <'x'>` }, lane: { name: "A<B" }, event: { type: "e" } });
    expect(out).toBe("<b>Tom & \"Jerry\" \\<'x'\\></b> & A\\<B");
  });
  it("escapes every special the renderer could read as structure", () => {
    expect(escapeMarkdown("*bold* _it_ `code` # h [l](u) a|b \\ <b>")).toBe("\\*bold\\* \\_it\\_ \\`code\\` \\# h \\[l\\](u) a\\|b \\\\ \\<b\\>");
    expect(escapeMarkdown("- item\n+ plus\n12. twelve\n1.5 also\nmid - dash 2.")).toBe("\\- item\n\\+ plus\n12\\. twelve\n1\\.5 also\nmid - dash 2.");
  });
});
