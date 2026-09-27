import { useLayoutEffect, useRef } from "react";

const DURATION = 220;

function reducedMotion(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Makes the sidebar's expand and collapse read as motion while the grid track itself still
 * changes in one frame (animating grid-template-columns reflows the whole page on every frame).
 *
 * FLIP: `capture()` records where the main column starts and how wide the sidebar is, the
 * caller flips `collapsed`, and after React commits this effect measures again. The main
 * column is translated back to where it was and eased to its new place; the sidebar's
 * background layer (its `::before`, driven by `--side-scale`) is scaled from the old width to
 * the new one. Only transform changes. Measuring with getBoundingClientRect includes any
 * transform still running, so a second toggle mid-flight starts from what is on screen.
 * With reduced motion nothing is animated.
 */
export function useSidebarFlip(collapsed: boolean) {
  const sideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const before = useRef<{ left: number; width: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  function capture() {
    const side = sideRef.current;
    const main = mainRef.current;
    if (!side || !main || reducedMotion()) {
      before.current = null;
      return;
    }
    before.current = { left: main.getBoundingClientRect().left, width: side.getBoundingClientRect().width };
  }

  useLayoutEffect(() => {
    const first = before.current;
    before.current = null;
    const side = sideRef.current;
    const main = mainRef.current;
    if (!first || !side || !main) return;
    // Drop what a previous toggle left, then measure the settled layout.
    window.clearTimeout(timer.current);
    main.style.transition = "none";
    main.style.transform = "";
    side.classList.add("side-flip-start");
    side.style.removeProperty("--side-scale");
    const last = { left: main.getBoundingClientRect().left, width: side.getBoundingClientRect().width };
    const dx = first.left - last.left;
    const scale = last.width > 0 ? first.width / last.width : 1;
    if (Math.abs(dx) < 1 && Math.abs(scale - 1) < 0.01) {
      side.classList.remove("side-flip-start");
      main.style.transition = "";
      return;
    }
    main.style.transform = `translateX(${dx}px)`;
    side.style.setProperty("--side-scale", String(scale));
    // Commit the start frame, then let both ease to where the layout already is.
    void main.offsetWidth;
    requestAnimationFrame(() => {
      side.classList.remove("side-flip-start");
      side.style.setProperty("--side-scale", "1");
      main.style.transition = `transform ${DURATION}ms var(--ease)`;
      main.style.transform = "translateX(0)";
      timer.current = window.setTimeout(() => {
        main.style.transition = "";
        main.style.transform = "";
        side.style.removeProperty("--side-scale");
      }, DURATION + 40);
    });
  }, [collapsed]);

  return { sideRef, mainRef, capture };
}
