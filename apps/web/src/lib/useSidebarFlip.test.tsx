// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { useSidebarFlip } from "./useSidebarFlip";

function Harness() {
  const [collapsed, setCollapsed] = useState(false);
  const flip = useSidebarFlip(collapsed);
  return (
    <div className={collapsed ? "shell collapsed" : "shell"}>
      <nav ref={flip.sideRef as React.RefObject<HTMLElement>} data-testid="side" />
      <main ref={flip.mainRef as React.RefObject<HTMLElement>} data-testid="main" />
      <button onClick={() => { flip.capture(); setCollapsed((c) => !c); }}>toggle</button>
    </div>
  );
}

function mockMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
}

/** jsdom has no layout: report the geometry a real browser would after the class flips. */
function mockGeometry() {
  const proto = HTMLElement.prototype;
  vi.spyOn(proto, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const collapsed = !!this.closest(".collapsed");
    const isSide = this.dataset.testid === "side";
    const left = isSide ? 0 : collapsed ? 64 : 232;
    const width = isSide ? (collapsed ? 64 : 232) : 800;
    return { left, width, top: 0, height: 100, right: left + width, bottom: 100, x: left, y: 0, toJSON() {} } as DOMRect;
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useSidebarFlip", () => {
  it("translates the main column back to where it was and scales the sidebar surface, then eases both home", () => {
    mockMotion(false);
    mockGeometry();
    const raf: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { raf.push(cb); return raf.length; });
    const { getByText, getByTestId } = render(<Harness />);
    fireEvent.click(getByText("toggle"));
    const main = getByTestId("main");
    const side = getByTestId("side");
    expect(main.style.transform).toBe("translateX(168px)");
    expect(side.style.getPropertyValue("--side-scale")).toBe(String(232 / 64));
    act(() => raf.forEach((cb) => cb(0)));
    expect(main.style.transform).toBe("translateX(0)");
    expect(side.style.getPropertyValue("--side-scale")).toBe("1");
  });

  it("applies no transform under reduced motion", () => {
    mockMotion(true);
    mockGeometry();
    const { getByText, getByTestId } = render(<Harness />);
    fireEvent.click(getByText("toggle"));
    expect(getByTestId("main").style.transform).toBe("");
    expect(getByTestId("side").style.getPropertyValue("--side-scale")).toBe("");
  });
});
