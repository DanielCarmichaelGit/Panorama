import type { Action, EngineEvent, Rule, RuleContext, Ticket } from "@boomerang/core";
import { ActionSchema, canonical, ConditionSchema, evaluateCondition, evaluateRule } from "@boomerang/core";
import { getLane, listEvidence, type DB } from "@boomerang/db";
import { missingForLane, type MissingEntry } from "../services/tickets";
import { ruleContext } from "./runRules";

/**
 * What a rule would do to a ticket if its event happened now, without doing it. The event is
 * synthesised from the rule's own event node (a move into the lane it names, evidence of the
 * type and result it names), the conditions are evaluated against the ticket as it stands,
 * and each move is asked what the gate would refuse. `nodeIds` are the canvas nodes the view
 * lights: the event, every condition that holds, every action that would run. Nothing here
 * writes: no run row, no event, no ticket change.
 */
export interface DryRun {
  matched: boolean;
  nodeIds: string[];
  actions: Action[];
  refusals: { action: number; laneId: string; missing: MissingEntry[] }[];
}

function syntheticEvent(rule: Rule, ticket: Ticket): EngineEvent {
  const re = rule.event;
  const base = { id: ticket.id, ticketId: ticket.id, projectId: ticket.projectId };
  switch (re.type) {
    case "schedule":
      return { type: "trigger.fired", payload: { ruleId: rule.id, projectId: ticket.projectId } };
    case "ticket.moved":
      return { type: re.type, payload: { ...base, from: re.fromLaneId ?? ticket.laneId, to: re.toLaneId ?? ticket.laneId } };
    case "evidence.added":
      return { type: re.type, payload: { ...base, typeId: re.typeId ?? "", result: re.result ?? "info" } };
    case "ticket.flag_set":
    case "ticket.flag_cleared":
      return { type: re.type, payload: { ...base, flag: re.flag ?? "" } };
    case "ticket.updated":
      return { type: re.type, payload: { ...base, changed: re.changed ? [re.changed] : [] } };
    default:
      return { type: re.type, payload: base };
  }
}

export function dryRun(db: DB, rule: Rule, ticket: Ticket, actorKind: RuleContext["actorKind"]): DryRun {
  const ctx = ruleContext(db, ticket, actorKind);
  const event = syntheticEvent(rule, ticket);
  const matched = rule.conditions.every((c) => evaluateCondition(c, ctx));
  // A disabled rule is still worth testing: that is when the owner tests it.
  const actions = matched ? evaluateRule({ ...rule, enabled: true }, event, ctx) : [];

  // The actions that would run, in their unrendered form, so a canvas node can be matched by
  // its own data (templates on the returned actions are already filled in).
  const running = new Set<string>();
  if (matched) for (const { when, ...action } of rule.actions) if (!when || when.every((c) => evaluateCondition(c, ctx))) running.add(canonical(action));
  const nodeIds: string[] = [];
  for (const n of rule.canvas.nodes) {
    if (n.kind === "event" || n.kind === "schedule") nodeIds.push(n.id);
    else if (n.kind === "condition") {
      const c = ConditionSchema.safeParse(n.data);
      if (c.success && evaluateCondition(c.data, ctx)) nodeIds.push(n.id);
    } else {
      const a = ActionSchema.safeParse(n.data);
      if (a.success && running.has(canonical(a.data))) nodeIds.push(n.id);
    }
  }

  const evidence = listEvidence(db, ticket.id);
  const refusals: DryRun["refusals"] = [];
  actions.forEach((a, i) => {
    if (a.type !== "move_to_lane" && a.type !== "create_ticket") return;
    const lane = getLane(db, a.laneId);
    if (!lane) return;
    const missing = a.type === "move_to_lane" ? missingForLane(db, lane, evidence, ticket.projectId, ticket.id) : missingForLane(db, lane, [], ticket.projectId);
    if (missing.length) refusals.push({ action: i, laneId: lane.id, missing });
  });
  return { matched, nodeIds, actions, refusals };
}
