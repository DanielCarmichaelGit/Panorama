import { z } from "zod";
import { FIELD_KINDS, FieldValueSchema } from "../fields";

/**
 * A rule is data: the event that starts it, the conditions that must hold, and the actions
 * the engine performs. Nothing here can express what the server cannot run through its
 * existing routes and gate (spec 2026-09-24, "Rules"); a shape the engine cannot run is a
 * parse failure, not a runtime surprise. The event and action lists here are the spec's
 * lists, exactly.
 */

const id = z.string().min(1).max(128);
const text = z.string().max(2000);
const flagName = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const evidenceResult = z.enum(["pass", "fail", "info"]);

// Five space separated fields, each a list of ranges with optional steps, as croner reads
// them. Names for months and weekdays are accepted; the scheduler (task 5) is the final judge.
const cronField = /^(\*|[0-9a-z]+(-[0-9a-z]+)?)(\/\d+)?(,(\*|[0-9a-z]+(-[0-9a-z]+)?)(\/\d+)?)*$/i;
export const isCron = (s: string): boolean => {
  const parts = s.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => cronField.test(p));
};
export const isTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Which chain event starts the rule. A `schedule` event is fired by the scheduler as a
 *  `trigger.fired` event carrying this rule's id (base spec section 9); `ticket.due_passed`
 *  is emitted by the same scheduler when a due date passes, with `{ticketId, dueDate}`. */
const ruleEventVariants = [
  z.object({ type: z.literal("ticket.created") }).strict(),
  z.object({ type: z.literal("ticket.moved"), fromLaneId: id.optional(), toLaneId: id.optional() }).strict(),
  z.object({ type: z.literal("ticket.updated"), changed: z.string().min(1).max(64).optional() }).strict(),
  z.object({ type: z.literal("ticket.flag_set"), flag: flagName.optional() }).strict(),
  z.object({ type: z.literal("ticket.flag_cleared"), flag: flagName.optional() }).strict(),
  z.object({ type: z.literal("evidence.added"), typeId: id.optional(), result: evidenceResult.optional() }).strict(),
  z.object({ type: z.literal("comment.added") }).strict(),
  z.object({ type: z.literal("timer.started") }).strict(),
  z.object({ type: z.literal("timer.stopped") }).strict(),
  z.object({ type: z.literal("cost.added") }).strict(),
  z.object({ type: z.literal("ticket.due_passed") }).strict(),
  z.object({
    type: z.literal("schedule"),
    cron: z.string().max(200).refine(isCron, "five cron fields"),
    timezone: z.string().max(64).refine(isTimezone, "an IANA timezone"),
    /** What the scheduler does with runs that fell in downtime or a lock: drop them, fold them
     *  into one fire, or fire each (capped). The trigger row carries the scheduler's copy. */
    missed: z.enum(["skip", "run_once", "run_all"]).default("run_once"),
  }).strict(),
] as const;
export const RuleEventSchema = z.discriminatedUnion("type", [...ruleEventVariants]);
export type RuleEvent = z.infer<typeof RuleEventSchema>;
export const RULE_EVENT_TYPES = ruleEventVariants.map((v) => v.shape.type.value) as RuleEvent["type"][];

// Conditions. `is`, `is_not` and `in` compare an id; on tags and flags `is` means the ticket
// has it, `is_not` that it lacks it, and `in` that it has any of them. `exists` and
// `not_exists` ask whether the value is set at all.
const idOps = <K extends string>(kind: K) => [
  z.object({ kind: z.literal(kind), op: z.enum(["is", "is_not"]), value: id }).strict(),
  z.object({ kind: z.literal(kind), op: z.literal("in"), values: z.array(id).min(1).max(100) }).strict(),
];
const existsOps = <K extends string>(kind: K) => z.object({ kind: z.literal(kind), op: z.enum(["exists", "not_exists"]) }).strict();

const fieldBase = { kind: z.literal("field"), key: fieldKey };
const fieldOps = [
  z.object({ ...fieldBase, fieldKind: z.literal("text"), op: z.enum(["is", "is_not", "contains"]), value: text }).strict(),
  z.object({ ...fieldBase, fieldKind: z.literal("number"), op: z.enum(["is", "is_not", "gte", "lte"]), value: z.number().finite() }).strict(),
  z.object({ ...fieldBase, fieldKind: z.literal("date"), op: z.enum(["is", "gte", "lte"]), value: isoDate }).strict(),
  z.object({ ...fieldBase, fieldKind: z.literal("select"), op: z.enum(["is", "is_not"]), value: text.min(1) }).strict(),
  z.object({ ...fieldBase, fieldKind: z.literal("select"), op: z.literal("in"), values: z.array(text.min(1)).min(1).max(100) }).strict(),
  z.object({ ...fieldBase, fieldKind: z.literal("checkbox"), op: z.literal("is"), value: z.boolean() }).strict(),
  z.object({ ...fieldBase, fieldKind: z.enum(FIELD_KINDS), op: z.enum(["exists", "not_exists"]) }).strict(),
];

const leafConditions = [
  ...idOps("lane"),
  ...idOps("epic"),
  existsOps("epic"),
  ...idOps("board"),
  ...idOps("tag"),
  ...idOps("flag"),
  z.object({ kind: z.literal("title"), op: z.enum(["is", "is_not", "contains"]), value: text }).strict(),
  ...idOps("assignee"),
  existsOps("assignee"),
  z.object({ kind: z.literal("due_date"), op: z.enum(["gte", "lte"]), value: isoDate }).strict(),
  existsOps("due_date"),
  z.object({ kind: z.literal("evidence"), typeId: id, result: evidenceResult.optional(), op: z.enum(["gte", "lte", "is"]), count: z.number().int().min(0) }).strict(),
  z.object({ kind: z.literal("evidence"), typeId: id, result: evidenceResult.optional(), op: z.enum(["exists", "not_exists"]) }).strict(),
  ...fieldOps,
  z.object({ kind: z.literal("actor"), op: z.enum(["is", "is_not"]), value: z.enum(["human", "agent", "system"]) }).strict(),
] as const;

type LeafCondition = z.infer<(typeof leafConditions)[number]>;
export type Condition = LeafCondition | { kind: "all"; conditions: Condition[] } | { kind: "any"; conditions: Condition[] } | { kind: "not"; condition: Condition };

/** How deep `all`, `any` and `not` may nest: a leaf is depth 1, each composite adds one. */
export const MAX_CONDITION_DEPTH = 8;
export function conditionDepth(c: Condition): number {
  switch (c.kind) {
    case "all":
    case "any":
      return 1 + c.conditions.reduce((m, x) => Math.max(m, conditionDepth(x)), 0);
    case "not":
      return 1 + conditionDepth(c.condition);
    default:
      return 1;
  }
}

type Members = [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]];
const conditionUnion: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    ...leafConditions,
    z.object({ kind: z.literal("all"), conditions: z.array(conditionUnion).max(100) }).strict(),
    z.object({ kind: z.literal("any"), conditions: z.array(conditionUnion).max(100) }).strict(),
    z.object({ kind: z.literal("not"), condition: conditionUnion }).strict(),
  ] as unknown as Members)
);
export const ConditionSchema: z.ZodType<Condition> = conditionUnion.superRefine((c, ctx) => {
  if (conditionDepth(c) > MAX_CONDITION_DEPTH) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `conditions nest deeper than ${MAX_CONDITION_DEPTH}` });
});

// Actions, each the exact input of a server route: move (POST /tickets/:id/move), flags
// (POST /tickets/:id/flags), comment (POST /comments as the system actor), tags, field,
// assignee, epic and board (PATCH /tickets/:id), create (POST /tickets from a template),
// webhook (outbox, task 5), timers (POST /tickets/:id/timer/start|stop as the engine actor,
// task 6). `clear_flag needs_human` is refused because only a human may clear it
// (permissions: flag.clear_needs_human). `title` on create_ticket is a template.
const actionVariants = [
  z.object({ type: z.literal("move_to_lane"), laneId: id }).strict(),
  z.object({ type: z.literal("set_flag"), flag: flagName }).strict(),
  z.object({ type: z.literal("clear_flag"), flag: flagName.refine((f) => f !== "needs_human", "only a human clears needs_human") }).strict(),
  z.object({ type: z.literal("assign"), actorId: id.nullable() }).strict(),
  z.object({ type: z.literal("add_tag"), tagId: id }).strict(),
  z.object({ type: z.literal("remove_tag"), tagId: id }).strict(),
  z.object({ type: z.literal("set_field"), key: fieldKey, value: FieldValueSchema }).strict(),
  z.object({ type: z.literal("set_epic"), epicId: id.nullable() }).strict(),
  z.object({ type: z.literal("add_comment"), body: z.string().min(1).max(20000) }).strict(),
  z.object({ type: z.literal("emit_webhook"), destinationId: id }).strict(),
  z.object({ type: z.literal("create_ticket"), title: z.string().min(1).max(200), laneId: id, boardId: id.optional(), epicId: id.optional(), tagIds: z.array(id).max(20).optional() }).strict(),
  z.object({ type: z.literal("start_timer") }).strict(),
  z.object({ type: z.literal("stop_timer") }).strict(),
  z.object({ type: z.literal("move_to_board"), boardId: id }).strict(),
] as const;

export const ActionSchema = z.discriminatedUnion("type", [...actionVariants]);
export type Action = z.infer<typeof ActionSchema>;
export const ACTION_TYPES = actionVariants.map((v) => v.shape.type.value) as Action["type"][];

/** The picker value each action needs, or null when it needs none; an empty one is
 *  `missing_target` on the canvas. */
export const ACTION_TARGET_KEY: Record<Action["type"], string | null> = {
  move_to_lane: "laneId",
  set_flag: "flag",
  clear_flag: "flag",
  assign: "actorId",
  add_tag: "tagId",
  remove_tag: "tagId",
  set_field: "key",
  set_epic: "epicId",
  add_comment: "body",
  emit_webhook: "destinationId",
  create_ticket: "laneId",
  start_timer: null,
  stop_timer: null,
  move_to_board: "boardId",
};

/** An action inside a rule may carry its own `when` list, evaluated on top of the rule's
 *  conditions, so one rule can hold the branches the canvas draws (Then and Else). */
export type RuleAction = Action & { when?: Condition[] };
export const RuleActionSchema: z.ZodType<RuleAction> = z.discriminatedUnion(
  "type",
  actionVariants.map((v) => v.extend({ when: z.array(ConditionSchema).max(100).optional() })) as unknown as [z.ZodObject<any>, ...z.ZodObject<any>[]]
) as unknown as z.ZodType<RuleAction>;

export const CANVAS_NODE_KINDS = ["event", "condition", "action", "schedule"] as const;
export type CanvasNodeKind = (typeof CANVAS_NODE_KINDS)[number];

// Node data is loose on purpose: the canvas holds half-drawn nodes (an action whose lane is
// not yet picked); canvasToRule is where the strict schemas apply and name the node.
export const CanvasNodeSchema = z
  .object({
    id: id,
    kind: z.enum(CANVAS_NODE_KINDS),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    data: z.record(z.unknown()),
  })
  .strict();
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const CanvasEdgeSchema = z.object({ id: id, source: id, target: id }).strict();
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;

export const CanvasDocSchema = z.object({ nodes: z.array(CanvasNodeSchema).max(500), edges: z.array(CanvasEdgeSchema).max(1000) }).strict();
export type CanvasDoc = z.infer<typeof CanvasDocSchema>;

export const RuleSchema = z
  .object({
    id: id,
    projectId: id,
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    event: RuleEventSchema,
    conditions: z.array(ConditionSchema).max(100),
    actions: z.array(RuleActionSchema).max(100),
    canvas: CanvasDocSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type Rule = z.infer<typeof RuleSchema>;

/** The part of a rule the canvas determines; the rest is metadata the server owns. */
export type RuleBody = Pick<Rule, "event" | "conditions" | "actions">;
