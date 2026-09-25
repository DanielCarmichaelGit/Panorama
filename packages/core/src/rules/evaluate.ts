import type { Evidence } from "../evidence";
import type { FieldValue } from "../fields";
import { isFileValue } from "../fields";
import type { Ticket } from "../schemas";
import type { Action, Condition, Rule, RuleEvent } from "./schema";

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

export function evaluateCondition(c: Condition, ctx: RuleContext): boolean {
  const t = ctx.ticket;
  switch (c.kind) {
    case "all":
      return c.conditions.every((x) => evaluateCondition(x, ctx));
    case "any":
      return c.conditions.some((x) => evaluateCondition(x, ctx));
    case "not":
      return !evaluateCondition(c.condition, ctx);
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

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapePlainText = (s: string): string => s.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

export interface TemplateScope {
  ticket: { key: string; title: string };
  lane: { name: string };
  event: { type: string };
}

/** Fills `{{ticket.key}}`, `{{ticket.title}}`, `{{lane.name}}` and `{{event.type}}`; any
 *  other placeholder is left as written. Substituted values are escaped so a title cannot
 *  smuggle markup into a system comment. */
export function renderTemplate(body: string, scope: TemplateScope): string {
  return body.replace(/\{\{\s*(ticket\.key|ticket\.title|lane\.name|event\.type)\s*\}\}/g, (_, path: string) => {
    const value = path === "ticket.key" ? scope.ticket.key : path === "ticket.title" ? scope.ticket.title : path === "lane.name" ? scope.lane.name : scope.event.type;
    return escapePlainText(value);
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
    out.push(action.type === "add_comment" ? { ...action, body: renderTemplate(action.body, scope) } : action);
  }
  return out;
}
