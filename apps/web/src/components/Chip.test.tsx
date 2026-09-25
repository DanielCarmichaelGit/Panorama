// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { Epic, Tag } from "@boomerang/core";
import { afterEach, describe, expect, it } from "vitest";
import { derivePair } from "../lib/color";
import { Chip, EpicChip, TagChips } from "./Chip";

afterEach(cleanup);

const epic = (over: Partial<Epic> = {}): Epic => ({
  id: "e1", projectId: "p1", name: "Growth", description: null, family: "sky", color: null, position: 0, archived: false, createdAt: "", ...over,
});

const tag = (over: Partial<Tag> = {}): Tag => ({
  id: "tg1", projectId: "p1", name: "Bug", family: "coral", color: null, archived: false, createdAt: "", ...over,
});

describe("Chip", () => {
  it("styles through the family tokens when there is no colour", () => {
    render(<Chip family="mint">Ready</Chip>);
    const chip = screen.getByText("Ready");
    expect(chip.style.background).toBe("var(--mint-top)");
    expect(chip.style.color).toBe("var(--mint-ink)");
  });

  it("renders a custom colour as its derived top with a readable ink", () => {
    const pair = derivePair("#12706a");
    render(<Chip family="mint" color="#12706a">Custom</Chip>);
    const chip = screen.getByText("Custom");
    expect(chip.style.background).toBe(hexToRgb(pair.top));
    expect(chip.style.color).toBe(hexToRgb(pair.ink));
    expect(pair.top).not.toBe("#12706a");
  });

  it("falls back to the family for a malformed colour", () => {
    render(<Chip family="lilac" color="#12">Broken</Chip>);
    const chip = screen.getByText("Broken");
    expect(chip.style.background).toBe("var(--lilac-top)");
  });
});

describe("EpicChip and TagChips", () => {
  it("pass the arc's colour through to the chip", () => {
    const pair = derivePair("#f6c1b4");
    render(<EpicChip epic={epic({ color: "#f6c1b4" })} />);
    expect(screen.getByText("Growth").style.background).toBe(hexToRgb(pair.top));
  });

  it("pass each tag's colour through, family for the ones without", () => {
    const pair = derivePair("#b9ddf5");
    render(<TagChips tags={[tag({ id: "tg1", name: "Bug", color: "#b9ddf5" }), tag({ id: "tg2", name: "Urgent", family: "stone" })]} />);
    expect(screen.getByText("Bug").style.background).toBe(hexToRgb(pair.top));
    expect(screen.getByText("Urgent").style.background).toBe("var(--stone-top)");
  });
});

/** jsdom serialises a hex background as rgb(), so compare against that form. */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
