// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementRows, merge, toRequirements, type RequirementRow } from "./RequirementRows";

afterEach(cleanup);

const types = [
  { id: "et_test_run", name: "Test run", kind: "test_run" as const, params: {}, humanOnly: false, needsAttachment: false, createdAt: "" },
  { id: "et_eval_score", name: "Eval score", kind: "eval_score" as const, params: { threshold: 0.9 }, humanOnly: false, needsAttachment: false, createdAt: "" },
];

describe("merge", () => {
  it("merges two rows of the same evidence type into one, keeping the larger count", () => {
    const rows: RequirementRow[] = [{ typeId: "et_test_run", count: 1 }, { typeId: "et_test_run", count: 3 }];
    expect(merge(rows)).toEqual([{ typeId: "et_test_run", count: 3 }]);
  });

  it("leaves distinct rows untouched", () => {
    const rows: RequirementRow[] = [{ typeId: "et_test_run", count: 1 }, { typeId: "et_eval_score", count: 3 }];
    expect(merge(rows)).toEqual([{ typeId: "et_test_run", count: 1 }, { typeId: "et_eval_score", count: 3 }]);
  });

  it("does not mutate the rows it is given", () => {
    const rows: RequirementRow[] = [{ typeId: "et_test_run", count: 1 }, { typeId: "et_test_run", count: 3 }];
    merge(rows);
    expect(rows).toEqual([{ typeId: "et_test_run", count: 1 }, { typeId: "et_test_run", count: 3 }]);
  });

  it("keeps the first description written when two rows of one type merge", () => {
    const rows: RequirementRow[] = [{ typeId: "et_test_run", count: 1 }, { typeId: "et_test_run", count: 2, description: "Show the issue reproduces" }];
    expect(merge(rows)).toEqual([{ typeId: "et_test_run", count: 2, description: "Show the issue reproduces" }]);
  });
});

describe("toRequirements", () => {
  it("sends a trimmed description and omits the key when there is none", () => {
    const rows: RequirementRow[] = [{ typeId: "et_test_run", count: 1, description: "  Show the issue reproduces " }, { typeId: "et_eval_score", count: 2, description: "  " }];
    const out = toRequirements(rows);
    expect(out).toEqual([{ typeId: "et_test_run", count: 1, description: "Show the issue reproduces" }, { typeId: "et_eval_score", count: 2 }]);
    expect("description" in out[1]).toBe(false);
  });
});

describe("RequirementRows", () => {
  it("shows each requirement's description and reports edits to it by row", () => {
    const onChangeDescription = vi.fn();
    render(
      <RequirementRows
        rows={[{ typeId: "et_test_run", count: 1, description: "Show that the issue reproduces" }, { typeId: "et_eval_score", count: 1 }]}
        types={types}
        onChangeType={() => {}}
        onChangeCount={() => {}}
        onChangeDescription={onChangeDescription}
        onRemove={() => {}}
        onAdd={() => {}}
      />,
    );
    const fields = screen.getAllByLabelText("What it should show") as HTMLTextAreaElement[];
    expect(fields).toHaveLength(2);
    expect(fields[0].value).toBe("Show that the issue reproduces");
    expect(fields[1].value).toBe("");
    expect(fields[1].placeholder).toBe("Describe the evidence an agent must provide");

    fireEvent.change(fields[1], { target: { value: "A markdown file explaining what needs to be done" } });
    expect(onChangeDescription).toHaveBeenCalledWith(1, "A markdown file explaining what needs to be done");
  });

  it("disables Add requirement once every type has a row", () => {
    render(
      <RequirementRows
        rows={[{ typeId: "et_test_run", count: 1 }, { typeId: "et_eval_score", count: 1 }]}
        types={types}
        onChangeType={() => {}}
        onChangeCount={() => {}}
        onChangeDescription={() => {}}
        onRemove={() => {}}
        onAdd={() => {}}
      />,
    );
    expect((screen.getByRole("button", { name: "Add requirement" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
