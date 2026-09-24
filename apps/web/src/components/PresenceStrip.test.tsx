// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Actor } from "@panorama/core";
import { agentFamily } from "./AgentCard";
import { presenceLine } from "./PresenceStrip";

const agent = (over: Partial<Actor>): Actor => ({
  id: "a1", kind: "agent", name: "worker", publicKey: "aa".repeat(32), scopes: { projects: "*", actions: ["read"] },
  status: "active", lastSeen: "2026-09-24T12:00:00.000Z", currentTicketId: null, createdAt: "2026-09-01T00:00:00.000Z", ...over,
});

const now = new Date("2026-09-24T12:05:00.000Z");

describe("presenceLine", () => {
  it("says no agents are connected when none are active", () => {
    expect(presenceLine([], now)).toBe("No agents connected yet");
    expect(presenceLine([agent({ status: "pending" })], now)).toBe("No agents connected yet");
  });

  it("counts one connected, idle agent", () => {
    const idle = agent({ id: "a1", currentTicketId: null });
    expect(presenceLine([idle], now)).toBe("1 agent connected, 0 working");
  });

  it("counts two connected agents with one working", () => {
    const working = agent({ id: "a1", currentTicketId: "t1", lastSeen: "2026-09-24T12:00:00.000Z" });
    const idle = agent({ id: "a2", currentTicketId: null, lastSeen: "2026-09-24T12:04:00.000Z" });
    expect(presenceLine([working, idle], now)).toBe("2 agents connected, 1 working");
  });

  it("treats an agent not seen in over 10 minutes as idle even with a current ticket", () => {
    const stale = agent({ id: "a1", currentTicketId: "t1", lastSeen: "2026-09-24T11:50:00.000Z" });
    expect(presenceLine([stale], now)).toBe("1 agent connected, 0 working");
  });

  it("ignores revoked agents", () => {
    const revoked = agent({ id: "a1", status: "revoked" });
    expect(presenceLine([revoked], now)).toBe("No agents connected yet");
  });
});

describe("agentFamily", () => {
  it("is stable for the same id", () => {
    expect(agentFamily("agent-123")).toBe(agentFamily("agent-123"));
  });

  it("is never coral, which is reserved for needs-human and pending", () => {
    const ids = ["a", "ab", "abc", "worker-1", "worker-2", "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"];
    for (const id of ids) expect(agentFamily(id)).not.toBe("coral");
  });

  it("picks from the four non-coral families", () => {
    const families = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(agentFamily));
    for (const f of families) expect(["sky", "lilac", "mint", "stone"]).toContain(f);
  });
});
