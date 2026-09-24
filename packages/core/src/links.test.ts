import { describe, expect, it } from "vitest";
import { checkDependencies, LinkInput, type TicketLink } from "./index";

const link = (over: Partial<TicketLink> = {}): TicketLink => ({
  id: "l1",
  projectId: "p1",
  fromId: "t_blocker",
  toId: "t_target",
  kind: "blocks",
  createdAt: "2026-09-24T00:00:00.000Z",
  ...over,
});

describe("LinkInput", () => {
  it("accepts a blocks or relates link and rejects an unknown kind", () => {
    expect(LinkInput.safeParse({ toId: "t1", kind: "blocks" }).success).toBe(true);
    expect(LinkInput.safeParse({ toId: "t1", kind: "relates" }).success).toBe(true);
    expect(LinkInput.safeParse({ toId: "t1", kind: "duplicates" }).success).toBe(false);
  });
});

describe("checkDependencies", () => {
  const ticketsById = new Map([
    ["t_blocker", { key: "PAN-1", laneId: "lane_progress" }],
    ["t_done_blocker", { key: "PAN-2", laneId: "lane_done" }],
  ]);
  const lanesById = new Map([
    ["lane_progress", { isDone: false }],
    ["lane_done", { isDone: true }],
  ]);

  it("returns no blockers when the target lane is not done", () => {
    expect(checkDependencies("t_target", [link()], ticketsById, lanesById, { isDone: false })).toEqual([]);
  });
  it("returns the blocking ticket when the target lane is done and the blocker is not done", () => {
    expect(checkDependencies("t_target", [link()], ticketsById, lanesById, { isDone: true })).toEqual([{ key: "PAN-1", id: "t_blocker" }]);
  });
  it("excludes a blocker that is already in a done lane", () => {
    const doneLink = link({ fromId: "t_done_blocker" });
    expect(checkDependencies("t_target", [doneLink], ticketsById, lanesById, { isDone: true })).toEqual([]);
  });
  it("ignores relates links and links pointing at a different ticket", () => {
    const relates = link({ kind: "relates" });
    const other = link({ toId: "t_other" });
    expect(checkDependencies("t_target", [relates, other], ticketsById, lanesById, { isDone: true })).toEqual([]);
  });
});
