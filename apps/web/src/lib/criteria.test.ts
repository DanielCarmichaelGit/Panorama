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

  it("does not count a checkbox-looking line inside a fenced code block", () => {
    // "- [ ] fake" renders as literal text inside the fence, not a checkbox, so it must not
    // consume an index: index 0 is the one real task item, after the fence.
    const md = "```\n- [ ] fake\n```\n\n- [ ] real\n";
    expect(toggleTaskItem(md, 0, true)).toBe("```\n- [ ] fake\n```\n\n- [x] real\n");
  });

  it("counts and toggles a task item inside a blockquote", () => {
    const md = "> - [ ] quoted\n";
    expect(toggleTaskItem(md, 0, true)).toBe("> - [x] quoted\n");
  });

  it("does not let a parent item's line swallow a nested child's identical-looking text", () => {
    // Regression guard for the parent/child raw-overlap hazard: marked's list_item.raw for a
    // parent item includes its nested content verbatim, so a naive search using that full raw
    // would jump the cursor past the child's own line entirely. Duplicate wording on parent and
    // child makes that failure mode visible if it regresses.
    const md = "- [ ] Todo\n  - [ ] Todo\n";
    expect(toggleTaskItem(md, 1, true)).toBe("- [ ] Todo\n  - [x] Todo\n");
  });
});
