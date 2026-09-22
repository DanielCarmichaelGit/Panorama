import { describe, expect, it } from "vitest";
import { isoBoxFaces, isoPoint } from "./iso";
describe("iso", () => {
  it("projects at 30 degrees", () => {
    expect(isoPoint(0, 0, 0, 20)).toEqual([0, 0]);
    expect(isoPoint(1, 0, 0, 20)[0]).toBeCloseTo(17.32, 2);
    expect(isoPoint(1, 0, 0, 20)[1]).toBeCloseTo(10, 2);
    expect(isoPoint(0, 0, 1, 20)).toEqual([0, -20]);
  });
  it("returns three four-point faces", () => {
    const f = isoBoxFaces(0, 0, 0, 1, 1, 1, 20);
    for (const face of [f.top, f.left, f.right]) expect(face.trim().split(" ")).toHaveLength(4);
  });
});
