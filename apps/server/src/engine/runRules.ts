import { randomUUID } from "node:crypto";
import type { Action, CausedBy, ChainEvent, EngineEvent, Rule, RuleContext, Ticket } from "@boomerang/core";
import { evaluateRule, LoopGuard, matchesEvent } from "@boomerang/core";
import { addRuleRun, appendEvent, getActor, getDestination, getLane, getTicket, listEvidence, listRules, type DB, type RuleRunOutcome } from "@boomerang/db";
import type { Ctx } from "../context";
import { HttpError } from "../errors";
import { addCommentAs, createTicketAs, moveTicketAs, setFlagAs, updateTicketAs, type Acting, type MissingEntry } from "../services/tickets";
import { startTimerAs, stopOwnTimerAs } from "../services/timers";
import { enqueueNotification } from "../workers/outbox";
import { ENGINE_ACTOR_ID, ensureEngineActor } from "./actor";

/**
 * The rule engine. After a request's transaction has committed, its events come here (the
 * onSend hook in install.ts, the same point the bus publishes from; the workers hand their
 * own events in the same way); for each event with a project, that project's enabled rules
 * are evaluated against the ticket as it stands now, and the actions of a rule that matches
 * are applied through the ticket services, the same code a route runs, gate included. Other
 * requests may commit between the route's commit and this run, so every action re-checks
 * its gate when it runs, never from the event's snapshot.
 *
 * Every fire is one transaction: its actions, its `rule_runs` row and its `rule.fired` event
 * commit together, and a failing action rolls the whole fire back before a second, smaller
 * transaction records why (refused at a gate, or error). Events a fire produces are queued
 * and evaluated in turn, carrying the causal chain the loop guard reads: at most 8 fires deep,
 * one fire per rule per ticket per chain, and a rolling per-minute cap on top. One call also
 * has a budget, MAX_FIRES fires and MAX_CREATED created tickets, so a rule that fans out
 * through create_ticket cannot run away inside the depth limit. A rule whose conditions do
 * not hold records nothing; a guard or budget refusal records a skipped run, a rule.fired,
 * and flags needs_human. Each fire's committed events reach the caller's sink as that fire
 * completes, so a failure later in the queue cannot cost the stream what already happened.
 */

/** What an event a rule caused carries so the chain can be followed back to the fire. */
export interface RuleCause { ruleId: string; runId: string; eventSeq: number }

/** Fires one runRules call may make before it stops its queue, and tickets it may create. */
export const MAX_FIRES = 50;
export const MAX_CREATED = 20;

export interface RunOptions {
  /** Receives each fire's committed events as that fire completes. */
  sink?: (events: ChainEvent[]) => void;
  /** Where an engine failure that is not an action's own refusal is reported. */
  log?: (message: string, error: unknown) => void;
}

interface Queued { event: ChainEvent; chain: CausedBy[]; rootTicketId: string | undefined }
interface Budget { fires: number; created: number }

const guards = new WeakMap<Ctx, LoopGuard>();
/** One guard per server, kept off the Ctx type so the engine adds nothing to context.ts. */
export function guardFor(ctx: Ctx): LoopGuard {
  let g = guards.get(ctx);
  if (!g) guards.set(ctx, (g = new LoopGuard({ maxDepth: 8 })));
  return g;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const payloadOf = (ev: ChainEvent): Record<string, unknown> => (ev.payload && typeof ev.payload === "object" ? (ev.payload as Record<string, unknown>) : {});
/** The ticket an event is about: `ticketId` where the payload names one, else `id` on a
 *  `ticket.*` event. A schedule trigger names none. */
export function ticketIdOf(ev: ChainEvent): string | undefined {
  const p = payloadOf(ev);
  return str(p.ticketId) ?? (ev.type.startsWith("ticket.") ? str(p.id) : undefined);
}

/** A ticket the engine may act on. An archived one is gone as far as the API is concerned
 *  (the routes answer 404 for it), so here it is no ticket at all. */
const liveTicket = (db: DB, id: string | undefined): Ticket | undefined => {
  const t = id ? getTicket(db, id) : undefined;
  return t && !t.archived ? t : undefined;
};

const EMPTY_TICKET: RuleContext["ticket"] = { id: "", key: "", title: "", boardId: "", laneId: "", epicId: null, tagIds: [], flags: [], assigneeId: null, dueDate: null, fields: {} };

/** The conditions' view of the world: the ticket as it stands now, its lane, its evidence,
 *  and who raised the event. Without a ticket (a schedule) every ticket condition sees an
 *  empty one, so only `not_exists` style conditions can hold. */
export function ruleContext(db: DB, ticket: Ticket | undefined, actorKind: RuleContext["actorKind"]): RuleContext {
  if (!ticket) return { ticket: EMPTY_TICKET, lane: { id: "", name: "" }, evidence: [], actorKind };
  const lane = getLane(db, ticket.laneId);
  return { ticket, lane: { id: ticket.laneId, name: lane?.name ?? "" }, evidence: listEvidence(db, ticket.id).map((e) => ({ typeId: e.typeId, result: e.result })), actorKind };
}

function actorKindOf(db: DB, actorId: string): RuleContext["actorKind"] {
  if (actorId === ENGINE_ACTOR_ID) return "system";
  return getActor(db, actorId)?.kind ?? "system";
}

const asEngineEvent = (ev: ChainEvent, chain: CausedBy[]): EngineEvent => ({ type: ev.type, payload: payloadOf(ev), causedBy: chain });

/** Runs every enabled rule of the events' projects, and of the events those fires produce,
 *  until the queue drains or the budget is spent. Returns every event the engine appended,
 *  in order; a request also gets them through `sink` as each fire commits. */
export function runRules(ctx: Ctx, events: ChainEvent[], opts: RunOptions = {}): ChainEvent[] {
  const db = ctx.db;
  if (!db) return [];
  const log = opts.log ?? ((message, error) => console.error(message, error));
  const produced: ChainEvent[] = [];
  const emit = (out: ChainEvent[]) => {
    if (out.length === 0) return;
    produced.push(...out);
    opts.sink?.(out);
  };
  const budget: Budget = { fires: 0, created: 0 };
  const queue: Queued[] = events.map((event) => ({ event, chain: [], rootTicketId: ticketIdOf(event) }));
  while (queue.length) {
    const { event, chain, rootTicketId } = queue.shift()!;
    if (event.type === "rule.fired") continue;
    const projectId = str(payloadOf(event).projectId);
    if (!projectId) continue;
    const rules = listRules(db, projectId, { enabledOnly: true });
    if (rules.length === 0) continue;
    const engineEvent = asEngineEvent(event, chain);
    for (const rule of rules) {
      if (!matchesEvent(rule.event, engineEvent, rule.id)) continue;
      let out: ChainEvent[];
      let exhausted = false;
      try {
        ({ out, exhausted } = fire(ctx, db, rule, event, chain, budget, rootTicketId));
      } catch (error) {
        // Not an action's own refusal (those are the fire's to record) but the engine itself
        // failing, say while writing a refusal's comment. Say so, record it, carry on.
        log(`engine: rule ${rule.id} failed on event ${event.seq}`, error);
        out = recordEngineError(ctx, db, rule, event, error, log);
      }
      emit(out);
      const link: CausedBy = { ruleId: rule.id, ticketId: ticketIdOf(event) ?? "" };
      for (const e of out) {
        if (e.type === "ticket.created") budget.created += 1;
        queue.push({ event: e, chain: [...chain, link], rootTicketId });
      }
      if (exhausted) return produced;
    }
  }
  return produced;
}

/** The engine's own log entry, signed by the causing event rather than a request. */
function engineLog(db: DB, event: ChainEvent, cause: RuleCause, now: () => string, out: ChainEvent[]): Acting["log"] {
  return (type, payload) => {
    const ev = appendEvent(db, { actorId: ENGINE_ACTOR_ID, type, payload: { ...payload, causedBy: cause }, signature: `engine:${event.hash}`, now: now() });
    out.push(ev);
    return ev;
  };
}

/** One rule against one event: the conditions, then the budget and the guard, then the
 *  actions in one transaction. Returns the events it appended (none of a rolled back fire)
 *  and whether the budget ran out here. */
function fire(ctx: Ctx, db: DB, rule: Rule, event: ChainEvent, chain: CausedBy[], budget: Budget, rootTicketId: string | undefined): { out: ChainEvent[]; exhausted: boolean } {
  const iso = () => ctx.now().toISOString();
  const ticketId = ticketIdOf(event);
  const runId = randomUUID();
  const cause: RuleCause = { ruleId: rule.id, runId, eventSeq: event.seq };
  const out: ChainEvent[] = [];
  const acting: Acting = { db, actor: ensureEngineActor(db, iso()), kind: "system", now: iso, log: engineLog(db, event, cause, iso, out) };
  const fired = (outcome: RuleRunOutcome, detail: Record<string, unknown>) => {
    addRuleRun(db, { id: runId, ruleId: rule.id, ticketId: ticketId ?? null, eventSeq: event.seq, outcome, detail }, iso());
    acting.log("rule.fired", { ruleId: rule.id, projectId: rule.projectId, ticketId: ticketId ?? null, runId, eventSeq: event.seq, outcome, ...detail });
  };
  const flagForHuman = (t: Ticket | undefined) => {
    if (t && !t.flags.includes("needs_human")) setFlagAs(acting, t, "needs_human", true, "rule");
  };

  // Conditions first: a rule the event starts but whose conditions do not hold has nothing
  // to say, so it leaves no run and no event.
  const ticket = liveTicket(db, ticketId);
  const actions = evaluateRule(rule, asEngineEvent(event, chain), ruleContext(db, ticket, actorKindOf(db, event.actorId)));
  if (actions.length === 0) return { out, exhausted: false };

  if (budget.fires >= MAX_FIRES || budget.created >= MAX_CREATED) {
    db.transaction(() => {
      fired("skipped", { reason: "budget", actions });
      flagForHuman(liveTicket(db, rootTicketId));
    })();
    return { out, exhausted: true };
  }

  const verdict = guardFor(ctx).check(rule.id, ticketId ?? "", ctx.now().getTime(), chain);
  if (!verdict.ok) {
    db.transaction(() => {
      fired("skipped", { reason: verdict.reason, actions });
      flagForHuman(ticket);
    })();
    return { out, exhausted: false };
  }

  budget.fires += 1;
  let failed: { action: Action; index: number; error: unknown } | undefined;
  try {
    db.transaction(() => {
      actions.forEach((action, index) => {
        try {
          applyAction(acting, rule, action, liveTicket(db, ticketId), event);
        } catch (error) {
          failed = { action, index, error };
          throw error;
        }
      });
      fired("applied", { actions });
    })();
  } catch (error) {
    // The fire rolled back: nothing it appended exists any more, only what follows does.
    out.length = 0;
    const f = failed ?? { action: actions[0], index: 0, error };
    db.transaction(() => recordFailure(acting, rule, actions, f, liveTicket(db, ticketId), fired))();
  }
  guardFor(ctx).allow(rule.id, ticketId ?? "", ctx.now().getTime(), chain);
  return { out, exhausted: false };
}

/** A gate refusal is a refused run: the ticket stays put, gets `blocked`, and a system comment
 *  names the rule, what it tried, and what is missing (base spec section 8). Anything else
 *  is an error run carrying the code and message. */
function recordFailure(acting: Acting, rule: Rule, actions: Action[], f: { action: Action; index: number; error: unknown }, ticket: Ticket | undefined, fired: (o: RuleRunOutcome, d: Record<string, unknown>) => void): void {
  const e = f.error;
  if (e instanceof HttpError && e.code === "gate") {
    const { laneId, missing } = e.details as { laneId: string; missing: MissingEntry[] };
    const lane = getLane(acting.db, laneId);
    fired("refused", { actions, action: f.action, index: f.index, laneId, missing });
    if (!ticket) return;
    const tried = f.action.type === "create_ticket" ? `create a ticket in ${lane?.name ?? laneId}` : `move ${ticket.key} to ${lane?.name ?? laneId}`;
    const needs = missing.map((m) => (m.typeId === "blocked_by" ? m.name.charAt(0).toLowerCase() + m.name.slice(1) : `${m.name} (${m.need - m.have} more)`)).join(", ");
    addCommentAs(acting, ticket, `Rule "${rule.name}" tried to ${tried} and was refused: it needs ${needs}.`, []);
    if (!ticket.flags.includes("blocked")) setFlagAs(acting, ticket, "blocked", true, "rule");
    return;
  }
  // Any other 422 is something that cannot be done now rather than a broken rule (the outbox
  // refusing a destination that is archived or gone): refused, without the gate's comment.
  if (e instanceof HttpError && e.status === 422) {
    fired("refused", { actions, action: f.action, index: f.index, code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) });
    return;
  }
  const code = e instanceof HttpError ? e.code : "internal";
  const message = e instanceof Error ? e.message : String(e);
  fired("error", { actions, action: f.action, index: f.index, code, message, ...(e instanceof HttpError && e.details !== undefined ? { details: e.details } : {}) });
}

/** When the fire itself failed outside its actions: an error run and its event in a fresh
 *  transaction, or a log line when even that cannot be written. */
function recordEngineError(ctx: Ctx, db: DB, rule: Rule, event: ChainEvent, error: unknown, log: NonNullable<RunOptions["log"]>): ChainEvent[] {
  const iso = () => ctx.now().toISOString();
  const runId = randomUUID();
  const out: ChainEvent[] = [];
  const message = error instanceof Error ? error.message : String(error);
  try {
    db.transaction(() => {
      const ticketId = ticketIdOf(event) ?? null;
      ensureEngineActor(db, iso());
      addRuleRun(db, { id: runId, ruleId: rule.id, ticketId, eventSeq: event.seq, outcome: "error", detail: { code: "internal", message } }, iso());
      engineLog(db, event, { ruleId: rule.id, runId, eventSeq: event.seq }, iso, out)("rule.fired", { ruleId: rule.id, projectId: rule.projectId, ticketId, runId, eventSeq: event.seq, outcome: "error", code: "internal", message });
    })();
  } catch (again) {
    log(`engine: could not record the failure of rule ${rule.id} on event ${event.seq}`, again);
    return [];
  }
  return out;
}

const needTicket = (t: Ticket | undefined, what: string): Ticket => {
  if (!t) throw new HttpError(400, "no_ticket", `This event has no ticket to ${what}`);
  return t;
};

/** One action through the same path a request takes. Anything a route would refuse, this
 *  refuses the same way, and the HttpError becomes the run's outcome. */
function applyAction(a: Acting, rule: Rule, action: Action, ticket: Ticket | undefined, event: ChainEvent): void {
  const { db } = a;
  switch (action.type) {
    case "move_to_lane":
      moveTicketAs(a, needTicket(ticket, "move"), action.laneId);
      return;
    case "set_flag":
      setFlagAs(a, needTicket(ticket, "flag"), action.flag, true, "rule");
      return;
    case "clear_flag":
      // The schema already refuses it; this is the engine's own word on the matter.
      if (action.flag === "needs_human") throw new HttpError(403, "forbidden", "Only a human clears needs_human");
      setFlagAs(a, needTicket(ticket, "flag"), action.flag, false, "rule");
      return;
    case "assign":
      updateTicketAs(a, needTicket(ticket, "assign"), { assigneeId: action.actorId });
      return;
    case "add_tag": {
      const t = needTicket(ticket, "tag");
      updateTicketAs(a, t, { tagIds: [...new Set([...t.tagIds, action.tagId])] });
      return;
    }
    case "remove_tag": {
      const t = needTicket(ticket, "tag");
      updateTicketAs(a, t, { tagIds: t.tagIds.filter((id) => id !== action.tagId) });
      return;
    }
    case "set_field":
      updateTicketAs(a, needTicket(ticket, "update"), { fields: { [action.key]: action.value } });
      return;
    case "set_epic":
      updateTicketAs(a, needTicket(ticket, "update"), { epicId: action.epicId });
      return;
    case "move_to_board":
      updateTicketAs(a, needTicket(ticket, "move"), { boardId: action.boardId });
      return;
    case "add_comment":
      addCommentAs(a, needTicket(ticket, "comment on"), action.body, []);
      return;
    case "emit_webhook": {
      // Another project's destination is a rule authoring error; what the outbox itself will
      // not take (a destination gone or archived) is a refusal, recorded as one.
      const dest = getDestination(db, action.destinationId);
      if (dest && dest.projectId !== rule.projectId) throw new HttpError(400, "wrong_project", "That destination belongs to another project");
      try {
        // Written in the same transaction as the fire, through the outbox's own door (task 5);
        // its worker signs and delivers it.
        enqueueNotification(db, action.destinationId, event.seq, { event: { seq: event.seq, type: event.type, payload: event.payload, createdAt: event.createdAt }, ticket: ticket ?? null, ruleId: rule.id }, a.now());
      } catch (e) {
        const code = (e as Error).message;
        if (code === "no_destination") throw new HttpError(422, code, "That destination no longer exists", { destinationId: action.destinationId });
        if (code === "destination_archived") throw new HttpError(422, code, "That destination is archived", { destinationId: action.destinationId });
        throw e;
      }
      return;
    }
    case "create_ticket":
      createTicketAs(a, { projectId: rule.projectId, title: action.title, laneId: action.laneId, ...(action.boardId ? { boardId: action.boardId } : {}), ...(action.epicId ? { epicId: action.epicId } : {}), ...(action.tagIds ? { tagIds: action.tagIds } : {}) });
      return;
    case "start_timer":
      startTimerAs(a, needTicket(ticket, "time"));
      return;
    case "stop_timer":
      stopOwnTimerAs(a, needTicket(ticket, "time"));
      return;
    default: {
      const unreachable: never = action;
      throw new HttpError(400, "unsupported_action", `Unknown action ${(unreachable as Action).type}`);
    }
  }
}
