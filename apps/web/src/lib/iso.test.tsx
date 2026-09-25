// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoomerangScene, boomerangOutline, extrude, isoBoxFaces, isoPoint } from "./iso";

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
  it("extrudes a plan outline into a top face and only the sides that face the viewer", () => {
    const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const s = extrude(square, 0, 1, 20);
    expect(s.top).toBe(isoBoxFaces(0, 0, 0, 1, 1, 1, 20).top);
    expect(s.sides.map((f) => f.tone).sort()).toEqual(["left", "right"]);
    expect(extrude([...square].reverse(), 0, 1, 20).sides).toHaveLength(2);
  });
  it("draws the boomerang as one closed outline of two blades", () => {
    const o = boomerangOutline();
    expect(o.length).toBeGreaterThan(8);
    expect(o.length).toBeLessThan(26);
  });
});

describe("BoomerangScene", () => {
  const matchMedia = (matches: boolean) => vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("renders an svg with the role and label", () => {
    vi.stubGlobal("matchMedia", matchMedia(false));
    const { container } = render(<BoomerangScene />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("A boomerang mid-swoop with a tail of wind");
    expect(container.querySelectorAll("*").length).toBeLessThan(60);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("compact drops the shadow and keeps two streaks", () => {
    vi.stubGlobal("matchMedia", matchMedia(false));
    const full = render(<BoomerangScene />);
    const fullStreaks = full.container.querySelectorAll(".bm-streak").length;
    expect(fullStreaks).toBeGreaterThanOrEqual(3);
    expect(fullStreaks).toBeLessThanOrEqual(5);
    expect(full.container.querySelector("ellipse")).not.toBeNull();
    cleanup();
    const compact = render(<BoomerangScene compact />);
    expect(compact.container.querySelectorAll(".bm-streak")).toHaveLength(2);
    expect(compact.container.querySelector("ellipse")).toBeNull();
  });

  it("animates in with staggered streaks, unless motion is reduced", () => {
    vi.stubGlobal("matchMedia", matchMedia(false));
    const moving = render(<BoomerangScene />);
    expect(moving.container.querySelector(".bm-body.bm-swoop")).not.toBeNull();
    const delays = [...moving.container.querySelectorAll<SVGElement>(".bm-streak")].map((s) => s.style.animationDelay);
    expect(delays[0]).toBe("0ms");
    expect(delays[1]).toBe("40ms");
    cleanup();
    vi.stubGlobal("matchMedia", matchMedia(true));
    const still = render(<BoomerangScene />);
    expect(still.container.querySelector(".bm-swoop")).toBeNull();
    expect(still.container.querySelector(".bm-streak-in")).toBeNull();
    for (const s of still.container.querySelectorAll<SVGElement>(".bm-streak")) expect(s.style.animationDelay).toBe("");
  });
});
