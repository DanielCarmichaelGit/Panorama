// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { swapNeighbour } from "./reorder";

const items = [
  { id: "a", position: 0 },
  { id: "b", position: 1 },
  { id: "c", position: 2 },
];

describe("swapNeighbour", () => {
  it("swaps a middle item down with its next neighbour", () => {
    expect(swapNeighbour(items, 1, 1)).toEqual([
      { id: "b", position: 2 },
      { id: "c", position: 1 },
    ]);
  });

  it("swaps a middle item up with its previous neighbour", () => {
    expect(swapNeighbour(items, 1, -1)).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
  });

  it("returns null moving the first item further up", () => {
    expect(swapNeighbour(items, 0, -1)).toBeNull();
  });

  it("returns null moving the last item further down", () => {
    expect(swapNeighbour(items, 2, 1)).toBeNull();
  });
});
