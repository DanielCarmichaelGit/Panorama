import type { Family } from "@boomerang/core";

/** The family names as people read them, for swatch pickers. */
export const FAMILY_LABEL: Record<Family, string> = { coral: "Coral", sky: "Sky", lilac: "Lilac", mint: "Mint", stone: "Stone" };

export const FAMILY: Record<Family, { top: string; left: string; right: string; ink: string }> = {
  coral: { top: "#FFD3C9", left: "#F7A999", right: "#E98672", ink: "#8A2A17" },
  sky: { top: "#CFE6FB", left: "#A3CDF3", right: "#7FB3E6", ink: "#124A7A" },
  lilac: { top: "#E1DAFB", left: "#C2B5F2", right: "#A595E6", ink: "#43318F" },
  mint: { top: "#CDF0E2", left: "#9FDDC5", right: "#78C7A9", ink: "#0E5A43" },
  stone: { top: "#EEF1F5", left: "#D9DEE6", right: "#C3CAD6", ink: "#3A4352" },
};
