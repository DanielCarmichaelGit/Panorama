import { createContext, useContext, useEffect, useMemo } from "react";

/**
 * The unsaved-changes guard. A view with something unsaved (a rule being drawn) calls
 * `useUnsavedGuard(dirty)`: while it is dirty the browser asks before a reload or a close, and
 * everything in the app that navigates away (the Shell's g shortcuts, the sidebar links, the
 * rule list, a link inside a node) asks through `useConfirmLeave` first. The app runs on
 * BrowserRouter without a data router, so react-router's useBlocker is not available; this
 * small context does the same job with one question.
 */

export const LEAVE_QUESTION = "You have unsaved changes. Leave this rule?";

export interface Unsaved {
  set: (dirty: boolean) => void;
  /** True when it is fine to leave: nothing is dirty, or the person said so. */
  confirm: () => boolean;
}

export function createUnsaved(): Unsaved {
  let dirty = false;
  return {
    set: (d) => {
      dirty = d;
    },
    confirm: () => !dirty || window.confirm(LEAVE_QUESTION),
  };
}

export const UnsavedContext = createContext<Unsaved>(createUnsaved());

/** The Shell's own guard: one per app, provided to everything under it. */
export function useUnsavedState(): Unsaved {
  return useMemo(createUnsaved, []);
}

export function useUnsavedGuard(dirty: boolean): void {
  const { set } = useContext(UnsavedContext);
  useEffect(() => {
    set(dirty);
    return () => set(false);
  }, [dirty, set]);
  useEffect(() => {
    if (!dirty) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);
}

export function useConfirmLeave(): () => boolean {
  return useContext(UnsavedContext).confirm;
}
