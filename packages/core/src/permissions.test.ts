import { describe, expect, it } from "vitest";
import { can, type Actor } from "./index";

const human = { kind: "human", status: "active", scopes: null } as Pick<Actor, "kind" | "status" | "scopes">;
const agent = (over: Partial<Actor> = {}) => ({ kind: "agent", status: "active", scopes: { projects: ["p1"], actions: ["read", "ticket.move"] }, ...over }) as Pick<Actor, "kind" | "status" | "scopes">;

describe("can", () => {
  it("lets the human do everything", () => {
    expect(can(human, "agent.approve")).toBe(true);
    expect(can(human, "ticket.move", "p9")).toBe(true);
  });
  it("limits agents to granted actions inside granted projects", () => {
    expect(can(agent(), "ticket.move", "p1")).toBe(true);
    expect(can(agent(), "ticket.create", "p1")).toBe(false);
    expect(can(agent(), "ticket.move", "p2")).toBe(false);
    expect(can(agent({ scopes: { projects: "*", actions: ["read"] } }), "read", "p2")).toBe(true);
  });
  it("never lets an agent perform a human action, whatever its scopes say", () => {
    const forged = agent({ scopes: { projects: "*", actions: ["agent.approve", "ticket.archive", "flag.clear_needs_human"] as never } });
    expect(can(forged, "agent.approve")).toBe(false);
    expect(can(forged, "ticket.archive", "p1")).toBe(false);
    expect(can(forged, "flag.clear_needs_human", "p1")).toBe(false);
  });
  it("denies pending and revoked actors", () => {
    expect(can(agent({ status: "pending" }), "read", "p1")).toBe(false);
    expect(can(agent({ status: "revoked" }), "read", "p1")).toBe(false);
  });
});
