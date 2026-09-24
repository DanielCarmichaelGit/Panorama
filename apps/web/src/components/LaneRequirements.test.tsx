import { describe, expect, it } from "vitest";
import type { LaneRequirement } from "@panorama/core";
import { merge } from "./LaneRequirements";

// The dialog this file used to export (with its native `<select>`) is gone: Settings' LanesTab
// edits lane requirements inline through the Picker-based RequirementRows instead. `merge` is
// still exported from here because LanesTab still imports it from this path; these are its tests.
describe("merge", () => {
  it("merges two rows of the same evidence type into one, keeping the larger count", () => {
    const rows: LaneRequirement[] = [{ typeId: "et_test_run", count: 1 }, { typeId: "et_test_run", count: 3 }];
    expect(merge(rows)).toEqual([{ typeId: "et_test_run", count: 3 }]);
  });

  it("leaves distinct rows untouched", () => {
    const rows: LaneRequirement[] = [{ typeId: "et_test_run", count: 1 }, { typeId: "et_eval_score", count: 3 }];
    expect(merge(rows)).toEqual([{ typeId: "et_test_run", count: 1 }, { typeId: "et_eval_score", count: 3 }]);
  });
});
