import { describe, expect, it } from "vitest";
import { toggleTaskItem } from "./criteria";

describe("toggleTaskItem", () => {
  it("checks an unchecked item", () => {
    expect(toggleTaskItem("- [ ] Ship it", 0, true)).toBe("- [x] Ship it");
  });

  it("unchecks a checked item", () => {
    expect(toggleTaskItem("- [x] Ship it", 0, false)).toBe("- [ ] Ship it");
  });

  it("counts task items in document order, including nested lists", () => {
    const md = "- [ ] Parent task\n  - [ ] Child task\n- [x] Another task\n";
    expect(toggleTaskItem(md, 1, true)).toBe("- [ ] Parent task\n  - [x] Child task\n- [x] Another task\n");
    expect(toggleTaskItem(md, 2, false)).toBe("- [ ] Parent task\n  - [ ] Child task\n- [ ] Another task\n");
  });

  it("skips a plain list item that has no checkbox marker", () => {
    const md = "- [ ] Task one\n- Not a task\n- [ ] Task two\n";
    expect(toggleTaskItem(md, 1, true)).toBe("- [ ] Task one\n- Not a task\n- [x] Task two\n");
  });

  it("preserves the rest of the line, including trailing text and markup", () => {
    const md = "- [ ] Fix the **bug** in `parser.ts`";
    expect(toggleTaskItem(md, 0, true)).toBe("- [x] Fix the **bug** in `parser.ts`");
  });

  it("supports * and + bullet markers", () => {
    expect(toggleTaskItem("* [ ] a", 0, true)).toBe("* [x] a");
    expect(toggleTaskItem("+ [ ] a", 0, true)).toBe("+ [x] a");
  });

  it("returns the markdown unchanged when the index is out of range", () => {
    const md = "- [ ] Only task";
    expect(toggleTaskItem(md, 5, true)).toBe(md);
  });

  it("returns the markdown unchanged when there are no task items at all", () => {
    const md = "Just a paragraph.\n\n- a plain list item";
    expect(toggleTaskItem(md, 0, true)).toBe(md);
  });
});
