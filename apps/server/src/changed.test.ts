import { describe, expect, it } from "vitest";
import { changedKeys, deepEqual } from "./changed";

describe("deepEqual", () => {
  it("compares primitives, null, arrays, and plain objects by value", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "b")).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1, b: { c: [1] } }, { b: { c: [1] }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([{ value: "s", label: "Small" }], [{ value: "s", label: "Small" }])).toBe(true);
    expect(deepEqual([{ value: "s", label: "Small" }], [{ value: "s", label: "Smol" }])).toBe(false);
  });
});

describe("changedKeys", () => {
  const row = { name: "Bug", color: null as string | null, options: [{ value: "s", label: "Small" }], tagIds: ["a", "b"], fields: { points: 3, size: "s" } };

  it("lists only the patch keys whose value differs from the row, in patch order", () => {
    expect(changedKeys(row, { name: "Bug", color: "#abcdef" })).toEqual(["color"]);
    expect(changedKeys(row, { color: "#abcdef", name: "Defect" })).toEqual(["color", "name"]);
    expect(changedKeys(row, { name: "Bug", options: [{ value: "s", label: "Small" }] })).toEqual([]);
    expect(changedKeys(row, { options: [{ value: "s", label: "Small" }, { value: "l", label: "Large" }] })).toEqual(["options"]);
  });

  it("treats an undefined patch key as not present", () => {
    expect(changedKeys(row, { name: undefined, color: "#abcdef" })).toEqual(["color"]);
    expect(changedKeys(row, {})).toEqual([]);
  });

  it("takes a comparator per key, for set-like arrays and merged records", () => {
    const compare = {
      tagIds: (before: unknown, after: unknown) => deepEqual([...(before as string[])].sort(), [...(after as string[])].sort()),
      fields: (before: unknown, after: unknown) => Object.entries(after as Record<string, unknown>).every(([k, v]) => deepEqual((before as Record<string, unknown>)[k] ?? null, v ?? null)),
    };
    expect(changedKeys(row, { tagIds: ["b", "a"] }, compare)).toEqual([]);
    expect(changedKeys(row, { tagIds: ["a"] }, compare)).toEqual(["tagIds"]);
    expect(changedKeys(row, { fields: { points: 3 } }, compare)).toEqual([]);
    expect(changedKeys(row, { fields: { points: 4 } }, compare)).toEqual(["fields"]);
    expect(changedKeys(row, { fields: { extra: null } }, compare)).toEqual([]);
  });
});
