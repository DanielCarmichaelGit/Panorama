import { randomUUID } from "node:crypto";
import type { Action, CausedBy, ChainEvent, EngineEvent, Rule, RuleContext, Ticket } from "@boomerang/core";
import { evaluateRule, LoopGuard, matchesEvent } from "@boomerang/core";
import { addRuleRun, appendEvent, getActor, getDestination, getLane, getTicket, listEvidence, listRules, startTimer, stopTimer, type DB, type RuleRunOutcome } from "@boomerang/db";
import type { Ctx } from "../context";
import { HttpError } from "../errors";
import { addCommentAs, createTicketAs, moveTicketAs, setFlagAs, updateTicketAs, type Acting, type MissingEntry } from "../services/tickets";
import { enqueueNotification } from "../workers/outbox";
import { ENGINE_ACTOR_ID, ensureEngineActor } from "./actor";

/**
 * The rule engine. After a request's transaction has committed, its events come here (the
 * onSend hook in install.ts, the same point the bus publishes from); for each event with a
 * project, that project's enabled rules are evaluated against the ticket as it stands now,
 * and the actions of a rule that matches are applied through the ticket services, the same
 * code a route runs, gate included. Every fire is one transaction: its actions, its
 * `rule_runs` row and its `rule.fired` event commit together, and a failing action rolls the
 * whole fire back before a second, smaller transaction records why (refused at a gate, or
 * error). Events a fire produces are queued and evaluated in turn, carrying the causal chain
 * the loop guard reads: at most 8 fires deep, one fire per rule per ticket per chain, and a
 * rolling per-minute cap on top. A guard refusal is a skipped run that flags `needs_human`.
 */

/** What an event a rule caused carries so the chain can be followed back to the fire. */
export interface RuleCause { ruleId: string; runId: string; eventSeq: number }

interface Queued { event: ChainEvent; chain: CausedBy[] }

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
 *  until the queue drains. Returns every event the engine appended, in order, for the caller
 *  to publish once its own events are out (a request pushes them onto `req.emitted`). */
export function runRules(ctx: Ctx, events: ChainEvent[]): ChainEvent[] {
  const db = ctx.db;
  if (!db) return [];
  const produced: ChainEvent[] = [];
  const queue: Queued[] = events.map((event) => ({ event, chain: [] }));
  while (queue.length) {
    const { event, chain } = queue.shift()!;
    if (event.type === "rule.fired") continue;
    const projectId = str(payloadOf(event).projectId);
    if (!projectId) continue;
    const rules = listRules(db, projectId, { enabledOnly: true });
    if (rules.length === 0) continue;
    const engineEvent = asEngineEvent(event, chain);
    for (const rule of rules) {
      if (!matchesEvent(rule.event, engineEvent, rule.id)) continue;
      const out = fire(ctx, db, rule, event, chain);
      produced.push(...out);
      const link: CausedBy = { ruleId: rule.id, ticketId: ticketIdOf(event) ?? "" };
      for (const e of out) queue.push({ event: e, chain: [...chain, link] });
    }
  }
  return produced;
}

/** One rule against one event: the guard, the conditions, then the actions in one
 *  transaction. Returns the events it appended (none of a rolled back fire). */
function fire(ctx: Ctx, db: DB, rule: Rule, event: ChainEvent, chain: CausedBy[]): ChainEvent[] {
  const iso = () => ctx.now().toISOString();
  const ticketId = ticketIdOf(event);
  const runId = randomUUID();
  const cause: RuleCause = { ruleId: rule.id, runId, eventSeq: event.seq };
  const out: ChainEvent[] = [];
  const acting: Acting = {
    db,
    actor: ensureEngineActor(db, iso()),
    kind: "system",
    now: iso,
    // Engine events carry no request signature: the signature column names the signed event
    // that caused the fire instead, so the attribution can be followed back to a real key.
    log: (type, payload) => {
      const ev = appendEvent(db, { actorId: ENGINE_ACTOR_ID, type, payload: { ...payload, causedBy: cause }, signature: `engine:${event.hash}`, now: iso() });
      out.push(ev);
      return ev;
    },
  };
  const currentTicket = () => (ticketId ? getTicket(db, ticketId) : undefined);
  const fired = (outcome: RuleRunOutcome, detail: Record<string, unknown>) => {
    addRuleRun(db, { id: runId, ruleId: rule.id, ticketId: ticketId ?? null, eventSeq: event.seq, outcome, detail }, iso());
    acting.log("rule.fired", { ruleId: rule.id, projectId: rule.projectId, ticketId: ticketId ?? null, runId, eventSeq: event.seq, outcome, ...detail });
  };

  const verdict = guardFor(ctx).check(rule.id, ticketId ?? "", ctx.now().getTime(), chain);
  if (!verdict.ok) {
    db.transaction(() => {
      fired("skipped", { reason: verdict.reason, actions: [] });
      const t = currentTicket();
      if (t && !t.flags.includes("needs_human")) setFlagAs(acting, t, "needs_human", true, "rule");
    })();
    return out;
  }

  const ticket = currentTicket();
  const actions = evaluateRule(rule, asEngineEvent(event, chain), ruleContext(db, ticket, actorKindOf(db, event.actorId)));
  if (actions.length === 0) {
    db.transaction(() => fired("skipped", { reason: "conditions", actions: [] }))();
    return out;
  }

  let failed: { action: Action; index: number; error: unknown } | undefined;
  try {
    db.transaction(() => {
      actions.forEach((action, index) => {
        try {
          applyAction(acting, rule, action, currentTicket(), event);
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
    db.transaction(() => recordFailure(acting, rule, actions, f, currentTicket(), fired))();
  }
  guardFor(ctx).allow(rule.id, ticketId ?? "", ctx.now().getTime(), chain);
  return out;
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
  const code = e instanceof HttpError ? e.code : "internal";
  const message = e instanceof Error ? e.message : String(e);
  fired("error", { actions, action: f.action, index: f.index, code, message, ...(e instanceof HttpError && e.details !== undefined ? { details: e.details } : {}) });
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
    case "add_comment":
      addCommentAs(a, needTicket(ticket, "comment on"), action.body, []);
      return;
    case "emit_webhook": {
      const dest = getDestination(db, action.destinationId);
      if (!dest || dest.projectId !== rule.projectId) throw new HttpError(400, "wrong_project", "That destination belongs to another project");
      if (dest.archived) throw new HttpError(400, "validation", "That destination is archived", { destinationId: dest.id });
      // Written in the same transaction as the fire, through the outbox's own door (task 5);
      // its worker signs and delivers it.
      enqueueNotification(db, dest.id, event.seq, { event: { seq: event.seq, type: event.type, payload: event.payload, createdAt: event.createdAt }, ticket: ticket ?? null, ruleId: rule.id }, a.now());
      return;
    }
    case "create_ticket":
      createTicketAs(a, { projectId: rule.projectId, title: action.title, laneId: action.laneId, ...(action.boardId ? { boardId: action.boardId } : {}), ...(action.epicId ? { epicId: action.epicId } : {}), ...(action.tagIds ? { tagIds: action.tagIds } : {}) });
      return;
    case "start_timer": {
      const t = needTicket(ticket, "time");
      try {
        startTimer(db, { ticketId: t.id, actorId: ENGINE_ACTOR_ID }, a.now());
      } catch (e) {
        if ((e as Error).message === "timer_open") throw new HttpError(409, "timer_open", "The engine already has a timer open on this ticket");
        throw e;
      }
      // The same payload shape as the timer routes (task 6) record, so the chain reads alike.
      a.log("timer.started", { ticketId: t.id, actorId: ENGINE_ACTOR_ID, projectId: t.projectId });
      return;
    }
    case "stop_timer": {
      const t = needTicket(ticket, "time");
      let timer;
      try {
        timer = stopTimer(db, { ticketId: t.id, actorId: ENGINE_ACTOR_ID }, a.now());
      } catch (e) {
        if ((e as Error).message === "no_open_timer") throw new HttpError(409, "no_open_timer", "The engine has no timer open on this ticket");
        throw e;
      }
      const seconds = Math.max(0, Math.round((Date.parse(timer.stoppedAt ?? a.now()) - Date.parse(timer.startedAt)) / 1000));
      a.log("timer.stopped", { ticketId: t.id, actorId: ENGINE_ACTOR_ID, projectId: t.projectId, seconds });
      return;
    }
    case "move_to_board":
      // No route moves a ticket between boards yet, so no rule may either.
      throw new HttpError(400, "unsupported_action", "Moving a ticket between boards is not available yet");
    default: {
      const unreachable: never = action;
      throw new HttpError(400, "unsupported_action", `Unknown action ${(unreachable as Action).type}`);
    }
  }
}
