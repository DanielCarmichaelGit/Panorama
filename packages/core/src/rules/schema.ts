import { z } from "zod";
import { FIELD_KINDS, FieldValueSchema } from "../fields";

/**
 * A rule is data: the event that starts it, the conditions that must hold, and the actions
 * the engine performs. Nothing here can express what the server cannot run through its
 * existing routes and gate (spec 2026-09-24, "Rules"); a shape the engine cannot run is a
 * parse failure, not a runtime surprise.
 */

const id = z.string().min(1);
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
 *  `trigger.fired` event carrying this rule's id (base spec section 9). */
export const RuleEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ticket.created") }).strict(),
  z.object({ type: z.literal("ticket.moved"), fromLaneId: id.optional(), toLaneId: id.optional() }).strict(),
  z.object({ type: z.literal("evidence.added"), typeId: id.optional(), result: evidenceResult.optional() }).strict(),
  z.object({ type: z.literal("ticket.flag_set"), flag: flagName.optional() }).strict(),
  z.object({ type: z.literal("ticket.flag_cleared"), flag: flagName.optional() }).strict(),
  z.object({ type: z.literal("ticket.updated"), changed: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal("comment.added") }).strict(),
  z.object({ type: z.literal("schedule"), cron: z.string().refine(isCron, "five cron fields"), timezone: z.string().refine(isTimezone, "an IANA timezone") }).strict(),
]);
export type RuleEvent = z.infer<typeof RuleEventSchema>;

// Conditions. `is`, `is_not` and `in` compare an id; on tags and flags `is` means the ticket
// has it, `is_not` that it lacks it, and `in` that it has any of them. `exists` and
// `not_exists` ask whether the value is set at all.
const idOps = <K extends string>(kind: K) => [
  z.object({ kind: z.literal(kind), op: z.enum(["is", "is_not"]), value: id }).strict(),
  z.object({ kind: z.literal(kind), op: z.literal("in"), values: z.array(id).min(1) }).strict(),
];
const existsOps = <K extends string>(kind: K) => z.object({ kind: z.literal(kind), op: z.enum(["exists", "not_exists"]) }).strict();

const fieldBase = { kind: z.literal("field"), key: fieldKey };
const fieldOps = [
  z.object({ ...fieldBase, fieldKind: z.literal("text"), op: z.enum(["is", "is_not", "contains"]), value: z.string() }).strict(),
  z.object({ ...fieldBase, fieldKind: z.literal("number"), op: z.enum(["is", "is_not", "gte", "lte"]), value: z.number().finite() }).strict(),
  z.object({ ...fieldBase, fieldKind: z.literal("date"), op: z.enum(["is", "gte", "lte"]), value: isoDate }).strict(),
  z.object({ ...fieldBase, fieldKind: z.literal("select"), op: z.enum(["is", "is_not"]), value: z.string().min(1) }).strict(),
  z.object({ ...fieldBase, fieldKind: z.literal("select"), op: z.literal("in"), values: z.array(z.string().min(1)).min(1) }).strict(),
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
  z.object({ kind: z.literal("title"), op: z.enum(["is", "is_not", "contains"]), value: z.string() }).strict(),
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

type Members = [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]];
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    ...leafConditions,
    z.object({ kind: z.literal("all"), conditions: z.array(ConditionSchema) }).strict(),
    z.object({ kind: z.literal("any"), conditions: z.array(ConditionSchema) }).strict(),
    z.object({ kind: z.literal("not"), condition: ConditionSchema }).strict(),
  ] as unknown as Members)
);

// Actions, each the exact input of a server route: move (POST /tickets/:id/move), flags
// (POST /tickets/:id/flags), comment (POST /comments as the system actor), tags, field, assignee
// and epic (PATCH /tickets/:id), webhook (outbox, task 5). `clear_flag needs_human` is refused
// because only a human may clear it (permissions: flag.clear_needs_human).
const actionVariants = [
  z.object({ type: z.literal("move_to_lane"), laneId: id }).strict(),
  z.object({ type: z.literal("set_flag"), flag: flagName }).strict(),
  z.object({ type: z.literal("clear_flag"), flag: flagName.refine((f) => f !== "needs_human", "only a human clears needs_human") }).strict(),
  z.object({ type: z.literal("add_comment"), body: z.string().min(1).max(20000) }).strict(),
  z.object({ type: z.literal("add_tag"), tagId: id }).strict(),
  z.object({ type: z.literal("remove_tag"), tagId: id }).strict(),
  z.object({ type: z.literal("set_field"), key: fieldKey, value: FieldValueSchema }).strict(),
  z.object({ type: z.literal("assign"), actorId: id.nullable() }).strict(),
  z.object({ type: z.literal("emit_webhook"), destinationId: id }).strict(),
  z.object({ type: z.literal("set_epic"), epicId: id.nullable() }).strict(),
] as const;

export const ActionSchema = z.discriminatedUnion("type", [...actionVariants]);
export type Action = z.infer<typeof ActionSchema>;
export const ACTION_TYPES = actionVariants.map((v) => v.shape.type.value) as Action["type"][];

/** The picker value each action needs; an empty one is `missing_target` on the canvas. */
export const ACTION_TARGET_KEY: Record<Action["type"], string> = {
  move_to_lane: "laneId",
  set_flag: "flag",
  clear_flag: "flag",
  add_comment: "body",
  add_tag: "tagId",
  remove_tag: "tagId",
  set_field: "key",
  assign: "actorId",
  emit_webhook: "destinationId",
  set_epic: "epicId",
};

/** An action inside a rule may carry its own `when` list, evaluated on top of the rule's
 *  conditions, so one rule can hold the branches the canvas draws (Then and Else). */
export type RuleAction = Action & { when?: Condition[] };
export const RuleActionSchema: z.ZodType<RuleAction> = z.discriminatedUnion(
  "type",
  actionVariants.map((v) => v.extend({ when: z.array(ConditionSchema).optional() })) as unknown as [z.ZodObject<any>, ...z.ZodObject<any>[]]
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

export const CanvasDocSchema = z.object({ nodes: z.array(CanvasNodeSchema), edges: z.array(CanvasEdgeSchema) }).strict();
export type CanvasDoc = z.infer<typeof CanvasDocSchema>;

export const RuleSchema = z
  .object({
    id: id,
    projectId: id,
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    event: RuleEventSchema,
    conditions: z.array(ConditionSchema),
    actions: z.array(RuleActionSchema),
    canvas: CanvasDocSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type Rule = z.infer<typeof RuleSchema>;

/** The part of a rule the canvas determines; the rest is metadata the server owns. */
export type RuleBody = Pick<Rule, "event" | "conditions" | "actions">;
