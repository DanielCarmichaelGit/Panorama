import type { CausedBy } from "./evaluate";

export interface LoopGuardOptions {
  /** Fires allowed per rule per ticket inside one window. Default 5. */
  maxFires?: number;
  /** The rolling window, in milliseconds. Default 60 000. */
  windowMs?: number;
  /** How long a causal chain may grow: a fire whose event already has this many causes is refused. Default 8. */
  maxDepth?: number;
}

export type LoopGuardVerdict = { ok: true } | { ok: false; reason: "depth" | "chain" | "window" };

/** Above this many rule and ticket pairs the guard sweeps expired ones on every call rather
 *  than once per window. */
const SWEEP_ABOVE = 1000;

/**
 * Keeps rules from chasing their own tails. Three checks, in order: the causal chain on the
 * event is no deeper than `maxDepth`; this rule has not already fired on this ticket within
 * that chain (base spec section 8); and this rule has fired on this ticket fewer than
 * `maxFires` times in the last `windowMs`. The clock is injected as `now` (milliseconds), so
 * the guard is deterministic under test. A refused fire is not counted.
 *
 * Memory is bounded: every call sweeps pairs whose last fire fell out of the window, once
 * per window normally and on every call once more than SWEEP_ABOVE pairs are held.
 */
export class LoopGuard {
  private readonly maxFires: number;
  private readonly windowMs: number;
  private readonly maxDepth: number;
  private readonly fires = new Map<string, Map<string, number[]>>();
  private pairs = 0;
  private lastSweep = Number.NEGATIVE_INFINITY;

  constructor(opts: LoopGuardOptions = {}) {
    this.maxFires = opts.maxFires ?? 5;
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxDepth = opts.maxDepth ?? 8;
  }

  check(ruleId: string, ticketId: string, now: number, causedBy: CausedBy[] = []): LoopGuardVerdict {
    this.sweep(now);
    if (causedBy.length >= this.maxDepth) return { ok: false, reason: "depth" };
    if (causedBy.some((c) => c.ruleId === ruleId && c.ticketId === ticketId)) return { ok: false, reason: "chain" };
    if (this.recent(ruleId, ticketId, now).length >= this.maxFires) return { ok: false, reason: "window" };
    return { ok: true };
  }

  /** `check`, and when allowed, records the fire. */
  allow(ruleId: string, ticketId: string, now: number, causedBy: CausedBy[] = []): boolean {
    if (!this.check(ruleId, ticketId, now, causedBy).ok) return false;
    this.store(ruleId, ticketId, [...this.recent(ruleId, ticketId, now), now]);
    return true;
  }

  /** Rule and ticket pairs currently remembered; for tests and diagnostics. */
  size(): number {
    return this.pairs;
  }

  private recent(ruleId: string, ticketId: string, now: number): number[] {
    return (this.fires.get(ruleId)?.get(ticketId) ?? []).filter((t) => now - t < this.windowMs);
  }

  private store(ruleId: string, ticketId: string, times: number[]): void {
    let byTicket = this.fires.get(ruleId);
    if (!byTicket) this.fires.set(ruleId, (byTicket = new Map()));
    if (!byTicket.has(ticketId)) this.pairs += 1;
    byTicket.set(ticketId, times);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs && this.pairs <= SWEEP_ABOVE) return;
    this.lastSweep = now;
    for (const [ruleId, byTicket] of this.fires) {
      for (const [ticketId, times] of byTicket) {
        if (times.some((t) => now - t < this.windowMs)) continue;
        byTicket.delete(ticketId);
        this.pairs -= 1;
      }
      if (byTicket.size === 0) this.fires.delete(ruleId);
    }
  }
}
