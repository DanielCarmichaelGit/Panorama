import { describe, expect, it } from "vitest";
import { canonical, GENESIS, hashEvent, verifyChain, type ChainEvent } from "./index";

const mk = (seq: number, prevHash: string, payload: unknown): ChainEvent => {
  const base = { seq, prevHash, actorId: "human", type: "t", payload, createdAt: "2026-09-21T00:00:00.000Z" };
  return { ...base, hash: hashEvent(base) };
};

describe("canonical", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(canonical({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});

describe("chain", () => {
  it("verifies an intact chain and returns the head", () => {
    const e1 = mk(1, GENESIS, { a: 1 });
    const e2 = mk(2, e1.hash, { a: 2 });
    expect(verifyChain([e1, e2])).toEqual({ ok: true, head: e2.hash });
  });
  it("returns GENESIS as head of an empty chain", () => {
    expect(verifyChain([])).toEqual({ ok: true, head: GENESIS });
  });
  it("reports the first edited event", () => {
    const e1 = mk(1, GENESIS, { a: 1 });
    const e2 = mk(2, e1.hash, { a: 2 });
    const e3 = mk(3, e2.hash, { a: 3 });
    expect(verifyChain([e1, { ...e2, payload: { a: 99 } }, e3])).toEqual({ ok: false, brokenAt: 2 });
  });
  it("reports a deleted event as a break at the next seq", () => {
    const e1 = mk(1, GENESIS, {});
    const e2 = mk(2, e1.hash, {});
    const e3 = mk(3, e2.hash, {});
    expect(verifyChain([e1, e3])).toEqual({ ok: false, brokenAt: 3 });
  });
});
