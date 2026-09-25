import { describe, expect, it } from "vitest";
import { LoopGuard, type CausedBy } from "../index";

describe("LoopGuard", () => {
  it("allows at most five fires per rule per ticket in a rolling sixty seconds by default", () => {
    const g = new LoopGuard();
    for (let i = 0; i < 5; i++) expect(g.allow("r1", "t1", 1000)).toBe(true);
    expect(g.allow("r1", "t1", 1005)).toBe(false);
    expect(g.check("r1", "t1", 1005)).toEqual({ ok: false, reason: "window" });
    expect(g.allow("r1", "t2", 1005)).toBe(true);
    expect(g.allow("r2", "t1", 1005)).toBe(true);
    expect(g.allow("r1", "t1", 1000 + 59_999)).toBe(false);
    expect(g.allow("r1", "t1", 1000 + 60_000)).toBe(true);
  });
  it("takes its limits from options and a refused fire is not counted", () => {
    const g = new LoopGuard({ maxFires: 2, windowMs: 10 });
    expect(g.allow("r", "t", 0)).toBe(true);
    expect(g.allow("r", "t", 1)).toBe(true);
    expect(g.allow("r", "t", 2)).toBe(false);
    expect(g.allow("r", "t", 3)).toBe(false);
    expect(g.allow("r", "t", 11)).toBe(true);
    expect(g.allow("r", "t", 12)).toBe(true);
    expect(g.allow("r", "t", 13)).toBe(false);
  });
  it("refuses a fire deeper than eight causes", () => {
    const g = new LoopGuard();
    const chain = (n: number): CausedBy[] => Array.from({ length: n }, (_, i) => ({ ruleId: `r${i}`, ticketId: `t${i}` }));
    expect(g.check("rx", "tx", 0, chain(7))).toEqual({ ok: true });
    expect(g.check("rx", "tx", 0, chain(8))).toEqual({ ok: false, reason: "depth" });
    expect(g.allow("rx", "tx", 0, chain(9))).toBe(false);
    expect(new LoopGuard({ maxDepth: 2 }).allow("rx", "tx", 0, chain(2))).toBe(false);
  });
  it("refuses a second fire of the same rule on the same ticket within one causal chain", () => {
    const g = new LoopGuard();
    const chain: CausedBy[] = [{ ruleId: "r1", ticketId: "t1" }, { ruleId: "r2", ticketId: "t1" }];
    expect(g.check("r1", "t1", 0, chain)).toEqual({ ok: false, reason: "chain" });
    expect(g.check("r1", "t2", 0, chain)).toEqual({ ok: true });
    expect(g.check("r3", "t1", 0, chain)).toEqual({ ok: true });
  });
  it("depth and chain are checked before the window and a refused fire leaves the window count alone", () => {
    const g = new LoopGuard({ maxFires: 1 });
    const deep: CausedBy[] = Array.from({ length: 8 }, (_, i) => ({ ruleId: `r${i}`, ticketId: "t" }));
    expect(g.allow("r", "t", 0, deep)).toBe(false);
    expect(g.allow("r", "t", 0)).toBe(true);
    expect(g.allow("r", "t", 1)).toBe(false);
  });
});
