// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GateList, laneOptionLabel, nextLane } from "./GateList";

afterEach(cleanup);

const lane = (over: Record<string, unknown>) => ({
  id: "l1", projectId: "p", name: "Review", position: 1, family: "lilac", setsNeedsHuman: false, isDone: false, evidenceRequirements: [], ...over,
}) as any;

const evalScoreType = { id: "et_eval_score", name: "Eval score", kind: "eval_score", params: { threshold: 0.9 }, humanOnly: false, needsAttachment: false, createdAt: "" };
const testRunType = { id: "et_test_run", name: "Test run", kind: "test_run", params: {}, humanOnly: false, needsAttachment: false, createdAt: "" };
const types = [evalScoreType, testRunType] as any;

describe("nextLane", () => {
  const lanes = [lane({ id: "l1", position: 1 }), lane({ id: "l2", position: 2 }), lane({ id: "l3", position: 5 })];

  it("returns the lane with the next-greater position", () => {
    expect(nextLane(lanes, "l1")?.id).toBe("l2");
    expect(nextLane(lanes, "l2")?.id).toBe("l3");
  });

  it("returns null past the last lane", () => {
    expect(nextLane(lanes, "l3")).toBeNull();
  });
});

describe("GateList", () => {
  it("shows a stone circle with the count for an unmet requirement and a mint check for a met one", () => {
    const reviewLane = lane({
      id: "l2",
      name: "Review",
      evidenceRequirements: [{ typeId: "et_eval_score", count: 1 }, { typeId: "et_test_run", count: 1 }],
    });
    render(<GateList lane={reviewLane} missing={[{ typeId: "et_eval_score", name: "Eval score", need: 1, have: 0 }]} types={types} />);

    expect(screen.getByText("Eval score, 0 of 1")).toBeTruthy();
    expect(screen.getByText("Test run")).toBeTruthy();
    expect(screen.getByLabelText("met")).toBeTruthy();
  });

  it("shows what an unmet requirement should show, under its name", () => {
    const reviewLane = lane({ id: "l2", name: "Review", evidenceRequirements: [{ typeId: "et_test_run", count: 1 }] });
    render(
      <GateList
        lane={reviewLane}
        missing={[{ typeId: "et_test_run", name: "Test run", need: 1, have: 0, description: "Show that the issue reproduces" }]}
        types={types}
      />,
    );
    expect(screen.getByText("Test run, 0 of 1")).toBeTruthy();
    expect(screen.getByText("Show that the issue reproduces")).toBeTruthy();
  });

  it("falls back to the lane requirement's own description when the gate entry carries none", () => {
    const reviewLane = lane({ id: "l2", name: "Review", evidenceRequirements: [{ typeId: "et_test_run", count: 1, description: "A markdown file explaining what needs to be done" }] });
    render(<GateList lane={reviewLane} missing={[{ typeId: "et_test_run", name: "Test run", need: 1, have: 0 }]} types={types} />);
    expect(screen.getByText("A markdown file explaining what needs to be done")).toBeTruthy();
  });

  it("says no evidence required when the lane has no requirements", () => {
    render(<GateList lane={lane({ evidenceRequirements: [] })} missing={[]} types={types} />);
    expect(screen.getByText("No evidence required.")).toBeTruthy();
  });

  it("shows a blocked_by entry as its own name, with an unmet circle, even though it names no evidence requirement", () => {
    // blocked_by is a dependency gate reason, not an evidence type: it never appears in
    // lane.evidenceRequirements, so it must be rendered from `missing` directly rather than
    // looked up against the requirements list (which is how a real evidence miss is rendered).
    render(
      <GateList
        lane={lane({ evidenceRequirements: [] })}
        missing={[{ typeId: "blocked_by", name: "Blocked by PAN-2", need: 1, have: 0 }]}
        types={types}
      />,
    );
    expect(screen.getByText("Blocked by PAN-2")).toBeTruthy();
    expect(screen.queryByText("No evidence required.")).toBeNull();
  });

  it("shows a blocked_by entry alongside real evidence requirements", () => {
    const reviewLane = lane({ id: "l2", name: "Review", evidenceRequirements: [{ typeId: "et_eval_score", count: 1 }] });
    render(
      <GateList
        lane={reviewLane}
        missing={[
          { typeId: "et_eval_score", name: "Eval score", need: 1, have: 0 },
          { typeId: "blocked_by", name: "Blocked by PAN-3", need: 1, have: 0 },
        ]}
        types={types}
      />,
    );
    expect(screen.getByText("Eval score, 0 of 1")).toBeTruthy();
    expect(screen.getByText("Blocked by PAN-3")).toBeTruthy();
  });

  it("says this is the last lane when there is no next lane", () => {
    render(<GateList lane={null} missing={[]} types={types} />);
    expect(screen.getByText("This is the last lane.")).toBeTruthy();
  });
});

describe("laneOptionLabel", () => {
  const reviewLane = lane({ id: "l2", name: "Review" });

  it("is just the lane name when nothing is missing", () => {
    expect(laneOptionLabel(reviewLane, [])).toBe("Review");
  });

  it("uses each miss's own name when present, without needing types", () => {
    expect(laneOptionLabel(reviewLane, [{ typeId: "et_eval_score", name: "Eval score", need: 1, have: 0 }])).toBe("Review (needs Eval score)");
  });

  it("falls back to a types lookup when a miss carries no name", () => {
    expect(
      laneOptionLabel(reviewLane, [{ typeId: "et_test_run", need: 1, have: 0 } as any], types)
    ).toBe("Review (needs Test run)");
  });
});
