import type { Action, CanvasNodeKind, Family, RuleEvent } from "@boomerang/core";
import { ACTION_TARGET_KEY, ACTION_TYPES, MAX_CONDITION_DEPTH, RULE_EVENT_TYPES } from "@boomerang/core";
import type { CanvasError } from "@boomerang/core";
import { scheduleTitle } from "./schedule";

/**
 * The words the canvas uses for the engine's vocabulary: every event, condition, operator
 * and action as a person reads it, the sentence a condition node shows, and the plain
 * sentence each validation error becomes. Nothing here changes what the engine runs.
 */

export const KIND_FAMILY: Record<CanvasNodeKind, Family> = { event: "coral", condition: "sky", action: "mint", schedule: "lilac" };
export const KIND_LABEL: Record<CanvasNodeKind, string> = { event: "When", condition: "If", action: "Then", schedule: "Every" };
export const KIND_KEY: Record<CanvasNodeKind, string> = { event: "e", condition: "c", action: "a", schedule: "s" };

export type EventType = RuleEvent["type"];
export type ActionType = Action["type"];

const EVENT_LABELS: Partial<Record<EventType, string>> = {
  "ticket.created": "A ticket is created",
  "ticket.moved": "A ticket moves",
  "ticket.updated": "A ticket changes",
  "ticket.flag_set": "A flag is set",
  "ticket.flag_cleared": "A flag is cleared",
  "evidence.added": "Evidence is added",
  "comment.added": "A comment is added",
  "timer.started": "A timer starts",
  "timer.stopped": "A timer stops",
  "cost.added": "A cost is reported",
  "ticket.due_passed": "A due date passes",
  schedule: "On a schedule",
};

/** The events an event node offers: every engine event except the schedule, which has its own node. */
export const EVENT_OPTIONS = RULE_EVENT_TYPES.filter((t) => t !== "schedule").map((t) => ({ id: t, label: eventLabel(t) }));

export function eventLabel(type: string | undefined): string {
  if (!type) return "Choose an event";
  return EVENT_LABELS[type as EventType] ?? type;
}

const ACTION_LABELS: Record<ActionType, string> = {
  move_to_lane: "Move to lane",
  set_flag: "Set a flag",
  clear_flag: "Clear a flag",
  assign: "Assign",
  add_tag: "Add a tag",
  remove_tag: "Remove a tag",
  set_field: "Set a field",
  set_epic: "Set the arc",
  add_comment: "Add a comment",
  emit_webhook: "Send a webhook",
  create_ticket: "Create a ticket",
  start_timer: "Start the timer",
  stop_timer: "Stop the timer",
  move_to_board: "Move to board",
};

export const ACTION_OPTIONS = ACTION_TYPES.map((t) => ({ id: t, label: actionLabel(t) }));

export function actionLabel(type: string | undefined): string {
  if (!type) return "Choose an action";
  return ACTION_LABELS[type as ActionType] ?? type;
}

/** The noun for what an action still needs, for the error bar ("no lane chosen"). */
const TARGET_NOUN: Record<string, string> = {
  laneId: "lane",
  flag: "flag",
  actorId: "assignee",
  tagId: "tag",
  key: "field",
  epicId: "arc",
  body: "comment",
  destinationId: "destination",
  boardId: "board",
};

export function actionTargetNoun(type: string | undefined): string {
  const key = type && Object.prototype.hasOwnProperty.call(ACTION_TARGET_KEY, type) ? ACTION_TARGET_KEY[type as ActionType] : null;
  return key ? (TARGET_NOUN[key] ?? key) : "target";
}

export type ConditionKind = "lane" | "epic" | "board" | "tag" | "flag" | "title" | "assignee" | "due_date" | "evidence" | "field" | "actor";

export const CONDITION_KINDS: { id: ConditionKind; label: string }[] = [
  { id: "lane", label: "Lane" },
  { id: "board", label: "Board" },
  { id: "epic", label: "Arc" },
  { id: "tag", label: "Tag" },
  { id: "flag", label: "Flag" },
  { id: "assignee", label: "Assignee" },
  { id: "title", label: "Title" },
  { id: "due_date", label: "Due date" },
  { id: "evidence", label: "Evidence" },
  { id: "field", label: "Field" },
  { id: "actor", label: "Actor" },
];

export const CONDITION_KIND_LABEL: Record<string, string> = Object.fromEntries(CONDITION_KINDS.map((k) => [k.id, k.label]));

export type Op = "is" | "is_not" | "in" | "contains" | "gte" | "lte" | "exists" | "not_exists";

const OP_LABELS: Record<Op, string> = {
  is: "is",
  is_not: "is not",
  in: "is any of",
  contains: "contains",
  gte: "is at least",
  lte: "is at most",
  exists: "is set",
  not_exists: "is not set",
};

const DATE_OP_LABELS: Partial<Record<Op, string>> = { gte: "is on or after", lte: "is on or before", is: "is" };

/** The operators a condition kind (or a field kind) offers, in the order the schema allows them. */
export function opsFor(kind: string | undefined, fieldKind?: string): Op[] {
  switch (kind) {
    case "lane":
    case "board":
    case "tag":
    case "flag":
      return ["is", "is_not", "in"];
    case "epic":
    case "assignee":
      return ["is", "is_not", "in", "exists", "not_exists"];
    case "title":
      return ["is", "is_not", "contains"];
    case "due_date":
      return ["gte", "lte", "exists", "not_exists"];
    case "evidence":
      return ["exists", "not_exists", "gte", "lte", "is"];
    case "actor":
      return ["is", "is_not"];
    case "field":
      switch (fieldKind) {
        case "text":
          return ["is", "is_not", "contains", "exists", "not_exists"];
        case "number":
          return ["is", "is_not", "gte", "lte", "exists", "not_exists"];
        case "date":
          return ["is", "gte", "lte", "exists", "not_exists"];
        case "select":
          return ["is", "is_not", "in", "exists", "not_exists"];
        case "checkbox":
          return ["is", "exists", "not_exists"];
        case "file":
          return ["exists", "not_exists"];
        default:
          return ["exists", "not_exists"];
      }
    default:
      return [];
  }
}

export function opLabel(op: string | undefined, kind?: string, fieldKind?: string): string {
  if (!op) return "";
  if (kind === "evidence") {
    if (op === "gte") return "at least";
    if (op === "lte") return "at most";
    if (op === "is") return "exactly";
    if (op === "exists") return "is present";
    if (op === "not_exists") return "is missing";
  }
  if (kind === "due_date" || (kind === "field" && fieldKind === "date")) return DATE_OP_LABELS[op as Op] ?? OP_LABELS[op as Op] ?? op;
  return OP_LABELS[op as Op] ?? op;
}

export const OP_OPTIONS = (kind: string | undefined, fieldKind?: string) => opsFor(kind, fieldKind).map((op) => ({ id: op, label: opLabel(op, kind, fieldKind) }));

export const RESULT_OPTIONS = [
  { id: "pass", label: "Passed" },
  { id: "fail", label: "Failed" },
  { id: "info", label: "Info" },
];

export const ACTOR_OPTIONS = [
  { id: "human", label: "The human" },
  { id: "agent", label: "An agent" },
  { id: "system", label: "The system" },
];

/** What the project holds, so ids can be read back as names. */
export interface Names {
  lane: (id: string) => string;
  board: (id: string) => string;
  epic: (id: string) => string;
  tag: (id: string) => string;
  actor: (id: string) => string;
  evidenceType: (id: string) => string;
  field: (key: string) => string;
  destination: (id: string) => string;
}

const OPS_WITH_VALUE: Op[] = ["is", "is_not", "contains", "gte", "lte"];

function nameFor(kind: string, names: Names, v: unknown): string {
  const s = String(v ?? "");
  switch (kind) {
    case "lane":
      return names.lane(s);
    case "board":
      return names.board(s);
    case "epic":
      return names.epic(s);
    case "tag":
      return names.tag(s);
    case "assignee":
      return names.actor(s);
    case "actor":
      return ACTOR_OPTIONS.find((o) => o.id === s)?.label.toLowerCase() ?? s;
    case "field":
      return typeof v === "boolean" ? (v ? "checked" : "unchecked") : s;
    default:
      return s;
  }
}

/**
 * The short readable sentence a condition node shows under its Pickers: "Lane is Eval",
 * "Evidence Eval score passed", "Field Priority is at least 3". A composite condition (drawn
 * by ruleToCanvas from a rule an agent wrote) reads as its shape.
 */
export function conditionSentence(data: Record<string, unknown>, names: Names): string {
  const kind = data.kind as string | undefined;
  if (!kind) return "Choose what to check";
  if (kind === "all" || kind === "any") {
    const parts = (data.conditions as Record<string, unknown>[] | undefined) ?? [];
    return parts.map((c) => conditionSentence(c, names)).join(kind === "all" ? " and " : " or ");
  }
  if (kind === "not") return `Not: ${conditionSentence((data.condition as Record<string, unknown>) ?? {}, names)}`;
  const op = data.op as Op | undefined;
  if (kind === "evidence") {
    const type = data.typeId ? names.evidenceType(String(data.typeId)) : "";
    if (!type) return "Choose an evidence type";
    const result = data.result === "pass" ? " passed" : data.result === "fail" ? " failed" : "";
    if (!op) return `Evidence ${type}${result}`;
    if (op === "exists") return `Evidence ${type}${result}`;
    if (op === "not_exists") return `No evidence ${type}${result}`;
    const n = typeof data.count === "number" ? data.count : "";
    return `Evidence ${type}${result} ${opLabel(op, kind)} ${n} ${n === 1 ? "time" : "times"}`.replace(/\s+/g, " ");
  }
  const subject = kind === "field" ? (data.key ? names.field(String(data.key)) : "Choose a field") : CONDITION_KIND_LABEL[kind] ?? kind;
  if (!op) return subject;
  const label = opLabel(op, kind, data.fieldKind as string | undefined);
  if (op === "in") {
    const values = (data.values as unknown[] | undefined) ?? [];
    return values.length ? `${subject} is ${values.map((v) => nameFor(kind, names, v)).join(" or ")}` : `${subject} is any of`;
  }
  if (OPS_WITH_VALUE.includes(op)) {
    const v = data.value;
    if (v === undefined || v === "") return `${subject} ${label}`;
    return `${subject} ${label} ${nameFor(kind, names, v)}`;
  }
  return `${subject} ${label}`;
}

/** The one-line title an action node shows: "Move to lane Eval", "Add a comment". */
export function actionSentence(data: Record<string, unknown>, names: Names): string {
  const type = data.type as ActionType | undefined;
  if (!type) return "Choose an action";
  switch (type) {
    case "move_to_lane":
      return data.laneId ? `Move to ${names.lane(String(data.laneId))}` : "Move to lane";
    case "move_to_board":
      return data.boardId ? `Move to board ${names.board(String(data.boardId))}` : "Move to board";
    case "set_flag":
      return data.flag ? `Set flag ${data.flag}` : "Set a flag";
    case "clear_flag":
      return data.flag ? `Clear flag ${data.flag}` : "Clear a flag";
    case "assign":
      return data.actorId === null ? "Unassign" : data.actorId ? `Assign to ${names.actor(String(data.actorId))}` : "Assign";
    case "add_tag":
      return data.tagId ? `Add tag ${names.tag(String(data.tagId))}` : "Add a tag";
    case "remove_tag":
      return data.tagId ? `Remove tag ${names.tag(String(data.tagId))}` : "Remove a tag";
    case "set_field":
      return data.key ? `Set ${names.field(String(data.key))}` : "Set a field";
    case "set_epic":
      return data.epicId === null ? "Clear the arc" : data.epicId ? `Set arc ${names.epic(String(data.epicId))}` : "Set the arc";
    case "add_comment":
      return "Add a comment";
    case "emit_webhook":
      return data.destinationId ? `Send to ${names.destination(String(data.destinationId))}` : "Send a webhook";
    case "create_ticket":
      return data.laneId ? `Create a ticket in ${names.lane(String(data.laneId))}` : "Create a ticket";
    case "start_timer":
      return "Start the timer";
    case "stop_timer":
      return "Stop the timer";
    default:
      return actionLabel(type);
  }
}

/** The event node's title: the event plus its parameters when it has any. */
export function eventSentence(data: Record<string, unknown>, names: Names): string {
  const type = data.type as string | undefined;
  if (!type) return "Choose an event";
  const base = eventLabel(type);
  switch (type) {
    case "ticket.moved": {
      const from = data.fromLaneId ? ` from ${names.lane(String(data.fromLaneId))}` : "";
      const to = data.toLaneId ? ` to ${names.lane(String(data.toLaneId))}` : "";
      return `${base}${from}${to}`;
    }
    case "evidence.added": {
      const t = data.typeId ? ` of ${names.evidenceType(String(data.typeId))}` : "";
      const r = data.result === "pass" ? ", passing" : data.result === "fail" ? ", failing" : "";
      return `${base}${t}${r}`;
    }
    case "ticket.flag_set":
    case "ticket.flag_cleared":
      return data.flag ? `${base.replace("A flag", `Flag ${data.flag}`)}` : base;
    case "ticket.updated":
      return data.changed ? `${base} (${changedLabel(String(data.changed))})` : base;
    default:
      return base;
  }
}

/** The schedule node's title: the cron in words and its timezone ("Every weekday at 09:00, Europe/London"). */
export function scheduleSentence(data: Record<string, unknown>): string {
  return scheduleTitle(data);
}

/** The fields `ticket.updated` can name, as people read them; the id is the key the event carries. The Picker also takes a typed key. */
export const CHANGED_OPTIONS = [
  { id: "title", label: "Title" },
  { id: "metadata", label: "Description" },
  { id: "laneId", label: "Lane" },
  { id: "epicId", label: "Arc" },
  { id: "tagIds", label: "Tags" },
  { id: "assigneeId", label: "Assignee" },
  { id: "successCriteria", label: "Success criteria" },
  { id: "fields", label: "Fields" },
  { id: "boardId", label: "Board" },
  { id: "startDate", label: "Start date" },
  { id: "dueDate", label: "Due date" },
  { id: "needs_human", label: "Needs human" },
];

export function changedLabel(key: string): string {
  return CHANGED_OPTIONS.find((o) => o.id === key)?.label ?? key;
}

/** One refusal from a dry run as words: "Move to Ready for Production would be refused: needs Eval score (0 of 1), Blocked by STU-2". */
export function refusalSentence(r: { action: Record<string, unknown>; missing: { name: string; need: number; have: number }[] }, names: Names): string {
  const parts = r.missing.map((m) => (m.need > 0 ? `needs ${m.name} (${m.have} of ${m.need})` : m.name));
  return `${actionSentence(r.action, names)} would be refused${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

/**
 * One plain sentence per validation error, for the bar above the canvas. `describe` names the
 * node in the drawing ("the action node"); the node's own title is added when it has one.
 */
export function errorSentence(e: CanvasError, describe: (nodeId: string) => { kind: CanvasNodeKind; data: Record<string, unknown> } | undefined, names: Names): string {
  const node = e.nodeId ? describe(e.nodeId) : undefined;
  const noun = node ? `The ${KIND_LABEL[node.kind].toLowerCase()} node` : "A node";
  switch (e.code) {
    case "no_event":
      return "The rule has no event node. Press e to add one.";
    case "two_events":
      return "The rule has two event nodes. Keep one.";
    case "cycle":
      return "The edges run in a loop. A rule flows one way, from the event to its actions.";
    case "unknown_kind":
      return `${noun} has a kind the engine does not know.`;
    case "disconnected":
      return `${noun}${nodeTitle(node, names)} is not connected to the event.`;
    case "missing_target":
      return `${noun} has no ${actionTargetNoun(node?.data.type as string | undefined)} chosen.`;
    case "invalid":
      return `${noun}${nodeTitle(node, names)} cannot run as drawn: a choice is missing, or the engine refuses it (only a person clears needs_human, and conditions nest at most ${MAX_CONDITION_DEPTH} deep).`;
    case "bad_edge":
      return "An edge points at a node that is not on the canvas.";
    default:
      return e.name;
  }
}

function nodeTitle(node: { kind: CanvasNodeKind; data: Record<string, unknown> } | undefined, names: Names): string {
  if (!node) return "";
  const t =
    node.kind === "event" ? (node.data.type ? eventSentence(node.data, names) : "") :
    node.kind === "condition" ? (node.data.kind ? conditionSentence(node.data, names) : "") :
    node.kind === "action" ? (node.data.type ? actionSentence(node.data, names) : "") :
    node.data.cron ? scheduleSentence(node.data) : "";
  return t ? ` (${t})` : "";
}
