import { describe, expect, it } from "vitest";
import { scopesFromForm, shortKey } from "./Agents";
describe("agents helpers", () => {
  it("shortens keys", () => { expect(shortKey("0123456789abcdef".repeat(4))).toBe("01234567…cdef"); });
  it("builds scopes and always keeps read first", () => {
    expect(scopesFromForm("*", ["ticket.move", "read"])).toEqual({ projects: "*", actions: ["read", "ticket.move"] });
    expect(scopesFromForm(["p1"], ["read"])).toEqual({ projects: ["p1"], actions: ["read"] });
  });
});
