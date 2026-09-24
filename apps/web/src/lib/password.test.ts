import { describe, expect, it } from "vitest";
import { generatePassword } from "./password";

describe("generatePassword", () => {
  it("makes 25 symbols from letters and digits, grouped by five", () => {
    const p = generatePassword();
    expect(p).toMatch(/^[a-z0-9]{5}(-[a-z0-9]{5}){4}$/);
  });
  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });
  it("uses every symbol of the alphabet over many draws", () => {
    const chars = new Set(Array.from({ length: 200 }, () => generatePassword()).join("").replace(/-/g, ""));
    expect(chars.size).toBe(36);
  });
});
