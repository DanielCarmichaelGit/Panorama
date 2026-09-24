import type { LaneRequirement } from "@panorama/core";

/**
 * One row per evidence type, in the order the rows were first given. Two rows can end up on the
 * same type once a row's type is changed, and the server refuses that outright, so the larger of
 * the two counts wins: it is the one that satisfies both rows.
 *
 * The dialog this file used to export is gone (Settings' `LanesTab` edits requirements inline
 * through `RequirementRows`, entirely through Pickers, so a second native-select dialog for the
 * same job was dead code); `merge` stays here because `LanesTab` still imports it from this path.
 */
export function merge(rows: LaneRequirement[]): LaneRequirement[] {
  const out: LaneRequirement[] = [];
  for (const row of rows) {
    const seen = out.find((r) => r.typeId === row.typeId);
    if (seen) seen.count = Math.max(seen.count, row.count);
    else out.push({ ...row });
  }
  return out;
}
