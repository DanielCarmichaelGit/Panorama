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

  it("says no evidence required when the lane has no requirements", () => {
    render(<GateList lane={lane({ evidenceRequirements: [] })} missing={[]} types={types} />);
    expect(screen.getByText("No evidence required.")).toBeTruthy();
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
