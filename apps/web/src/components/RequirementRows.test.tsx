import { describe, expect, it } from "vitest";
import type { LaneRequirement } from "@panorama/core";
import { merge } from "./RequirementRows";

describe("merge", () => {
  it("merges two rows of the same evidence type into one, keeping the larger count", () => {
    const rows: LaneRequirement[] = [{ typeId: "et_test_run", count: 1 }, { typeId: "et_test_run", count: 3 }];
    expect(merge(rows)).toEqual([{ typeId: "et_test_run", count: 3 }]);
  });

  it("leaves distinct rows untouched", () => {
    const rows: LaneRequirement[] = [{ typeId: "et_test_run", count: 1 }, { typeId: "et_eval_score", count: 3 }];
    expect(merge(rows)).toEqual([{ typeId: "et_test_run", count: 1 }, { typeId: "et_eval_score", count: 3 }]);
  });

  it("does not mutate the rows it is given", () => {
    const rows: LaneRequirement[] = [{ typeId: "et_test_run", count: 1 }, { typeId: "et_test_run", count: 3 }];
    merge(rows);
    expect(rows).toEqual([{ typeId: "et_test_run", count: 1 }, { typeId: "et_test_run", count: 3 }]);
  });
});
