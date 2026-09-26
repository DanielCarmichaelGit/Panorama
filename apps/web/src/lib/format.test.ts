import { describe, expect, it } from "vitest";
import { when } from "./format";

describe("when", () => {
  it("reads an instant in the browser's locale and says Never for none", () => {
    const iso = "2026-09-25T10:30:00.000Z";
    expect(when(iso)).toBe(new Date(iso).toLocaleString());
    expect(when(null)).toBe("Never");
    expect(when(undefined)).toBe("Never");
    expect(when("")).toBe("Never");
  });
});
