import { getTicket, listOpenTimers, listTimers, startTimer, stopTimer, type Timer } from "@boomerang/db";
import { HttpError } from "../errors";
import type { Acting } from "./tickets";

/**
 * Timers as functions of who is acting (milestone 3, task 6, moved here so the rule engine's
 * start_timer and stop_timer run through the same code the routes do). The server measures
 * time: a timer is opened and closed here and its duration is never taken from the caller.
 */

/** Whole seconds a timer has run, an open one counting up to `nowMs`. */
export const secondsOf = (t: Timer, nowMs: number): number => Math.max(0, Math.round(((t.stoppedAt === null ? nowMs : Date.parse(t.stoppedAt)) - Date.parse(t.startedAt)) / 1000));

/** Opens the acting actor's timer on a ticket and records `timer.started`; 409 `timer_open`
 *  when that actor already has one running there. */
export function startTimerAs(a: Acting, ticket: { id: string; projectId: string }): Timer {
  return a.db.transaction(() => {
    let timer: Timer;
    try {
      timer = startTimer(a.db, { ticketId: ticket.id, actorId: a.actor.id }, a.now());
    } catch (e) {
      if ((e as Error).message === "timer_open") throw new HttpError(409, "timer_open", "You already have a timer running on this ticket");
      throw e;
    }
    a.log("timer.started", { ticketId: ticket.id, actorId: a.actor.id, projectId: ticket.projectId });
    return timer;
  })();
}

/**
 * Closes one timer inside the caller's transaction and records `timer.stopped`. The event's
 * actor is whoever caused the stop (the timer's owner, the mover of a ticket into a done lane,
 * the human revoking an agent, or the engine); the payload names the timer's owner, and
 * `auto: true` says the owner did not ask for it.
 */
function stopOne(a: Acting, timer: Timer, projectId: string, auto: boolean): Timer & { seconds: number } {
  const now = a.now();
  const stopped = stopTimer(a.db, { ticketId: timer.ticketId, actorId: timer.actorId }, now);
  const seconds = secondsOf(stopped, Date.parse(now));
  a.log("timer.stopped", { ticketId: stopped.ticketId, actorId: stopped.actorId, projectId, seconds, ...(auto ? { auto: true } : {}) });
  return { ...stopped, seconds };
}

/** Stops the acting actor's own open timer on a ticket; 404 `timer_not_open` when there is none. */
export function stopOwnTimerAs(a: Acting, ticket: { id: string; projectId: string }): Timer & { seconds: number } {
  const open = listTimers(a.db, ticket.id).find((x) => x.actorId === a.actor.id && x.stoppedAt === null);
  if (!open) throw new HttpError(404, "timer_not_open", "You have no timer running on this ticket");
  return a.db.transaction(() => stopOne(a, open, ticket.projectId, false))();
}

/** Stops every open timer on a ticket, whoever owns it; the move service calls this when the
 *  ticket enters a done lane. Runs inside the move's transaction. */
export function stopTicketTimers(a: Acting, ticket: { id: string; projectId: string }): void {
  for (const t of listTimers(a.db, ticket.id)) if (t.stoppedAt === null) stopOne(a, t, ticket.projectId, true);
}

/** Stops an actor's open timers on every ticket; the revoke handler calls this so a revoked
 *  agent's clock does not run on. Runs inside the revoke's transaction. */
export function stopActorTimers(a: Acting, actorId: string): void {
  for (const t of listOpenTimers(a.db, actorId)) stopOne(a, t, getTicket(a.db, t.ticketId)?.projectId ?? "", true);
}
