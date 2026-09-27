import type { Evidence } from "../evidence";
import type { FieldValue } from "../fields";
import { isFileValue } from "../fields";
import type { Ticket } from "../schemas";
import { conditionDepth, MAX_CONDITION_DEPTH, type Action, type Condition, type Rule, type RuleEvent } from "./schema";

/** One link in a causal chain: the rule fire that produced the event now being evaluated. */
export interface CausedBy {
  ruleId: string;
  ticketId: string;
}

/** A chain event as the engine sees it. `causedBy` lists the rule fires that led here,
 *  oldest first; an event a human or agent raised directly has none. */
export interface EngineEvent {
  type: string;
  payload: Record<string, unknown>;
  causedBy?: CausedBy[];
}

export interface RuleContext {
  ticket: Pick<Ticket, "id" | "key" | "title" | "boardId" | "laneId" | "epicId" | "tagIds" | "flags" | "assigneeId" | "dueDate" | "fields">;
  lane: { id: string; name: string };
  evidence: Pick<Evidence, "typeId" | "result">[];
  actorKind: "human" | "agent" | "system";
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Does this chain event start the rule? Parameters left blank on the rule event match anything. */
export function matchesEvent(re: RuleEvent, ev: EngineEvent, ruleId: string): boolean {
  const p = ev.payload;
  switch (re.type) {
    case "schedule":
      return ev.type === "trigger.fired" && str(p.ruleId) === ruleId;
    case "ticket.moved":
      return ev.type === re.type && (re.fromLaneId === undefined || str(p.from) === re.fromLaneId) && (re.toLaneId === undefined || str(p.to) === re.toLaneId);
    case "evidence.added":
      return ev.type === re.type && (re.typeId === undefined || str(p.typeId) === re.typeId) && (re.result === undefined || str(p.result) === re.result);
    case "ticket.flag_set":
    case "ticket.flag_cleared":
      return ev.type === re.type && (re.flag === undefined || str(p.flag) === re.flag);
    case "ticket.updated":
      return ev.type === re.type && (re.changed === undefined || (Array.isArray(p.changed) && p.changed.includes(re.changed)));
    case "ticket.created":
    case "comment.added":
    case "timer.started":
    case "timer.stopped":
    case "cost.added":
    case "ticket.due_passed":
      return ev.type === re.type;
    default: {
      const unreachable: never = re;
      return unreachable;
    }
  }
}

const idTest = (op: "is" | "is_not" | "in", actual: string | null, value?: string, values?: string[]): boolean => {
  if (op === "is") return actual === value;
  if (op === "is_not") return actual !== value;
  return actual !== null && (values ?? []).includes(actual);
};
const setTest = (op: "is" | "is_not" | "in", actual: string[], value?: string, values?: string[]): boolean => {
  if (op === "is") return actual.includes(value!);
  if (op === "is_not") return !actual.includes(value!);
  return (values ?? []).some((v) => actual.includes(v));
};
const contains = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

function fieldTest(c: Extract<Condition, { kind: "field" }>, raw: FieldValue | undefined): boolean {
  const present = raw !== undefined && raw !== null;
  if (c.op === "exists" || c.op === "not_exists") {
    const rightKind =
      present &&
      ((c.fieldKind === "text" && typeof raw === "string") ||
        (c.fieldKind === "number" && typeof raw === "number") ||
        (c.fieldKind === "date" && typeof raw === "string") ||
        (c.fieldKind === "select" && typeof raw === "string") ||
        (c.fieldKind === "checkbox" && typeof raw === "boolean") ||
        (c.fieldKind === "file" && isFileValue(raw)));
    return c.op === "exists" ? rightKind : !rightKind;
  }
  // The exists variant is gone after the early return; TypeScript cannot see that through
  // a two-literal discriminant, so say so once here.
  const cmp = c as Exclude<typeof c, { op: "exists" | "not_exists" }>;
  switch (cmp.fieldKind) {
    case "text":
      if (typeof raw !== "string") return false;
      return cmp.op === "is" ? raw === cmp.value : cmp.op === "is_not" ? raw !== cmp.value : contains(raw, cmp.value);
    case "number":
      if (typeof raw !== "number") return false;
      return cmp.op === "is" ? raw === cmp.value : cmp.op === "is_not" ? raw !== cmp.value : cmp.op === "gte" ? raw >= cmp.value : raw <= cmp.value;
    case "date":
      if (typeof raw !== "string") return false;
      return cmp.op === "is" ? raw === cmp.value : cmp.op === "gte" ? raw >= cmp.value : raw <= cmp.value;
    case "select":
      if (typeof raw !== "string") return false;
      return cmp.op === "in" ? cmp.values.includes(raw) : cmp.op === "is" ? raw === cmp.value : raw !== cmp.value;
    case "checkbox":
      return typeof raw === "boolean" && raw === cmp.value;
  }
}

/** The same nesting guard the schema applies; a stored rule passed the schema, so hitting
 *  this means a caller built a condition by hand, and a loud error beats a silent false. */
export function evaluateCondition(c: Condition, ctx: RuleContext): boolean {
  if (conditionDepth(c) > MAX_CONDITION_DEPTH) throw new RangeError(`conditions nest deeper than ${MAX_CONDITION_DEPTH}`);
  return evaluate(c, ctx);
}

function evaluate(c: Condition, ctx: RuleContext): boolean {
  const t = ctx.ticket;
  switch (c.kind) {
    case "all":
      return c.conditions.every((x) => evaluate(x, ctx));
    case "any":
      return c.conditions.some((x) => evaluate(x, ctx));
    case "not":
      return !evaluate(c.condition, ctx);
    case "lane":
      return idTest(c.op, t.laneId, "value" in c ? c.value : undefined, "values" in c ? c.values : undefined);
    case "board":
      return idTest(c.op, t.boardId, "value" in c ? c.value : undefined, "values" in c ? c.values : undefined);
    case "epic":
      if (c.op === "exists") return t.epicId !== null;
      if (c.op === "not_exists") return t.epicId === null;
      return idTest(c.op, t.epicId, "value" in c ? c.value : undefined, "values" in c ? c.values : undefined);
    case "assignee":
      if (c.op === "exists") return t.assigneeId !== null;
      if (c.op === "not_exists") return t.assigneeId === null;
      return idTest(c.op, t.assigneeId, "value" in c ? c.value : undefined, "values" in c ? c.values : undefined);
    case "tag":
      return setTest(c.op, t.tagIds, "value" in c ? c.value : undefined, "values" in c ? c.values : undefined);
    case "flag":
      return setTest(c.op, t.flags, "value" in c ? c.value : undefined, "values" in c ? c.values : undefined);
    case "title":
      return c.op === "is" ? t.title === c.value : c.op === "is_not" ? t.title !== c.value : contains(t.title, c.value);
    case "due_date":
      if (c.op === "exists") return t.dueDate !== null;
      if (c.op === "not_exists") return t.dueDate === null;
      if (t.dueDate === null || !("value" in c)) return false;
      return c.op === "gte" ? t.dueDate >= c.value : t.dueDate <= c.value;
    case "evidence": {
      const n = ctx.evidence.filter((e) => e.typeId === c.typeId && (c.result === undefined || e.result === c.result)).length;
      if (!("count" in c)) return c.op === "exists" ? n > 0 : n === 0;
      return c.op === "is" ? n === c.count : c.op === "gte" ? n >= c.count : n <= c.count;
    }
    case "field":
      return fieldTest(c, t.fields[c.key]);
    case "actor":
      return c.op === "is" ? ctx.actorKind === c.value : ctx.actorKind !== c.value;
  }
}

/** Backslash-escapes what a markdown renderer could read as structure: the inline specials
 *  everywhere, and at the start of a line a list marker (`-`, `+`, or digits then a dot).
 *  Comments are markdown (base spec section 11), so a substituted title renders as the
 *  literal text it is, including inside a code span. */
export const escapeMarkdown = (s: string): string =>
  s
    .replace(/[\\*_`#[\]<>|]/g, (ch) => `\\${ch}`)
    .replace(/(^|\n)([-+])/g, (_, nl: string, mark: string) => `${nl}\\${mark}`)
    .replace(/(^|\n)(\d+)\./g, (_, nl: string, digits: string) => `${nl}${digits}\\.`);

export interface TemplateScope {
  ticket: { key: string; title: string };
  lane: { name: string };
  event: { type: string };
}

/** Fills `{{ticket.key}}`, `{{ticket.title}}`, `{{lane.name}}` and `{{event.type}}`; any
 *  other placeholder is left as written. Substituted values are escaped by default so a title
 *  cannot smuggle markdown structure into a system comment; a plain-text target such as a
 *  created ticket's title asks for `escape: false` and gets the values verbatim. */
export function renderTemplate(body: string, scope: TemplateScope, opts: { escape?: boolean } = {}): string {
  const escape = opts.escape ?? true;
  return body.replace(/\{\{\s*(ticket\.key|ticket\.title|lane\.name|event\.type)\s*\}\}/g, (_, path: string) => {
    const value = path === "ticket.key" ? scope.ticket.key : path === "ticket.title" ? scope.ticket.title : path === "lane.name" ? scope.lane.name : scope.event.type;
    return escape ? escapeMarkdown(value) : value;
  });
}

/**
 * The actions a rule performs for this event, or [] when the rule is disabled, the event
 * does not start it, or its conditions fail. Each action's own `when` list is applied on top
 * of the rule's conditions and stripped from what is returned, so the engine sees only what
 * to run. Pure: nothing here reads a clock or touches the rule.
 */
export function evaluateRule(rule: Rule, event: EngineEvent, ctx: RuleContext): Action[] {
  if (!rule.enabled || !matchesEvent(rule.event, event, rule.id)) return [];
  if (!rule.conditions.every((c) => evaluateCondition(c, ctx))) return [];
  const scope: TemplateScope = { ticket: { key: ctx.ticket.key, title: ctx.ticket.title }, lane: { name: ctx.lane.name }, event: { type: event.type } };
  const out: Action[] = [];
  for (const { when, ...action } of rule.actions) {
    if (when && !when.every((c) => evaluateCondition(c, ctx))) continue;
    if (action.type === "add_comment") out.push({ ...action, body: renderTemplate(action.body, scope) });
    // A ticket title is plain text, not markdown: no escaping, or the backslashes would show.
    else if (action.type === "create_ticket") out.push({ ...action, title: renderTemplate(action.title, scope, { escape: false }) });
    else out.push(action);
  }
  return out;
}
