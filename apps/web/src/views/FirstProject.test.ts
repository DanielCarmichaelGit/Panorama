import { describe, expect, it } from "vitest";
import { keyFor } from "./FirstProject";

describe("keyFor", () => {
  it("capitalises the name and turns spaces into underscores", () => {
    expect(keyFor("firetower")).toBe("FIRETOWER");
    expect(keyFor("Fire tower  two")).toBe("FIRE_TOWER_TWO");
  });
  it("drops symbols, leading digits, and anything past 32 characters", () => {
    expect(keyFor("2nd. project!")).toBe("ND_PROJECT");
    expect(keyFor("a".repeat(40))).toHaveLength(32);
    expect(keyFor("  ")).toBe("");
  });
});
