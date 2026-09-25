import { checkDependencies } from "@boomerang/core";
import { listLanes, listLinks, listTicketRefs, type DB } from "@boomerang/db";

/**
 * The `blocked_by` entries a ticket's move into a done lane picks up from `blocks` links,
 *
 * This check runs before the move is written, outside the write's transaction, and that is
 * safe only because better-sqlite3 is synchronous in this one process: no other request can
 * change a link or move a blocker between the check and the write. A second process or an
 * async driver would need the check inside the same transaction.
 * reported in the same shape as a missing-evidence gate entry so the two can sit in one list.
 * Shared by the move/create gate in routes/tickets.ts and the GET .../gates report in
 * routes/thread.ts, so both stay in sync about what "entering a done lane" means.
 */
export function blockedByReasons(
  db: DB,
  projectId: string,
  ticketId: string,
  lane: { isDone: boolean }
): { typeId: string; name: string; need: number; have: number }[] {
  if (!lane.isDone) return [];
  const ticketsById = new Map(listTicketRefs(db, projectId).map((t) => [t.id, { key: t.key, laneId: t.laneId }]));
  const lanesById = new Map(listLanes(db, projectId).map((l) => [l.id, { isDone: l.isDone }]));
  const links = listLinks(db, ticketId);
  return checkDependencies(ticketId, links, ticketsById, lanesById, lane).map((b) => ({
    typeId: "blocked_by",
    name: `Blocked by ${b.key}`,
    need: 1,
    have: 0,
  }));
}
