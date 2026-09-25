import { describe, expect, it } from "vitest";
import { BoomerangError, describeError, ToolRefusal } from "./errors";

const ctx = { name: "laptop-claude", url: "http://127.0.0.1:4499", keyFile: "/home/me/.boomerang-mcp/laptop-claude.json" };

describe("describeError", () => {
  it("names a locked server", () => {
    expect(describeError(new BoomerangError(423, "locked", "Boomerang is locked"), ctx)).toBe("Boomerang is locked. Ask the owner to unlock it.");
  });

  it("tells an unapproved agent to wait for the owner", () => {
    expect(describeError(new BoomerangError(403, "pending", "This agent key is waiting for approval"), ctx)).toBe(
      "Waiting for the owner to approve agent laptop-claude on the Agents page"
    );
  });

  it("says what to do after a revoke or a forgotten key", () => {
    expect(describeError(new BoomerangError(403, "revoked", "This agent key was revoked"), ctx)).toContain("Remove /home/me/.boomerang-mcp/laptop-claude.json");
    expect(describeError(new BoomerangError(401, "unknown_actor", "Unknown actor"), ctx)).toContain("Remove /home/me/.boomerang-mcp/laptop-claude.json");
  });

  it("lists every missing requirement of a gate refusal with its description and the blockers", () => {
    const e = new BoomerangError(422, "gate", "Ready for Production needs evidence first", {
      laneId: "l5",
      missing: [
        { typeId: "et_eval_score", name: "Eval score", need: 1, have: 0, description: "A run of the eval suite at or above the threshold" },
        { typeId: "et_test_run", name: "Test run", need: 2, have: 1 },
        { typeId: "blocked_by", name: "Blocked by DEMO-2", need: 1, have: 0 },
      ],
    });
    expect(describeError(e, ctx)).toBe(
      [
        "Ready for Production needs evidence first",
        "- Eval score (0 of 1). It should show: A run of the eval suite at or above the threshold",
        "- Test run (1 of 2)",
        "- Blocked by DEMO-2: that ticket must reach a done lane first, or the owner must remove the link",
      ].join("\n")
    );
  });

  it("carries the server's message and code for anything else", () => {
    expect(describeError(new BoomerangError(404, "not_found", "No such lane"), ctx)).toBe("No such lane (not_found)");
    expect(describeError(new BoomerangError(403, "forbidden", "This key may not perform criteria.edit"), ctx)).toBe("This key may not perform criteria.edit (forbidden)");
    expect(describeError(new BoomerangError(400, "validation", "Invalid request", [{ path: ["title"], message: "String must contain at least 1 character(s)" }]), ctx)).toBe(
      "Invalid request\n- title: String must contain at least 1 character(s)"
    );
  });

  it("cuts oversized details at 2 KB", () => {
    const out = describeError(new BoomerangError(400, "validation", "Bad field values", { issues: "x".repeat(5000) }), ctx);
    expect(out.length).toBeLessThan(2200);
    expect(out).toMatch(/\.\.\. \(\d+ more characters\)\)$/);
  });

  it("explains an unreachable server and passes local refusals through", () => {
    const down = new TypeError("fetch failed");
    (down as { cause?: unknown }).cause = { code: "ECONNREFUSED" };
    expect(describeError(down, ctx)).toBe("Cannot reach Boomerang at http://127.0.0.1:4499. Start it with pnpm start, or set BOOMERANG_URL.");
    expect(describeError(new ToolRefusal("No lane named Shipping in this project"), ctx)).toBe("No lane named Shipping in this project");
  });
});
