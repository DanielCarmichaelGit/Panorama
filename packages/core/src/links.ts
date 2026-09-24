import { z } from "zod";

export const LINK_KINDS = ["blocks", "relates"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface TicketLink {
  id: string;
  projectId: string;
  fromId: string;
  toId: string;
  kind: LinkKind;
  createdAt: string;
}

export const LinkInput = z.object({ toId: z.string().min(1), kind: z.enum(LINK_KINDS) }).strict();
export type LinkInput = z.infer<typeof LinkInput>;

/**
 * A ticket may not enter a lane with `isDone` while something that blocks it is not itself
 * in a done lane. Returns the blocking tickets to report (empty when the target lane is not
 * done, since only entering a done lane is gated).
 */
export function checkDependencies(
  ticketId: string,
  links: TicketLink[],
  ticketsById: Map<string, { key: string; laneId: string }>,
  lanesById: Map<string, { isDone: boolean }>,
  targetLane: { isDone: boolean }
): { key: string; id: string }[] {
  if (!targetLane.isDone) return [];

  const blockers: { key: string; id: string }[] = [];
  for (const link of links) {
    if (link.kind !== "blocks" || link.toId !== ticketId) continue;
    const blocker = ticketsById.get(link.fromId);
    if (!blocker) continue;
    const blockerLane = lanesById.get(blocker.laneId);
    if (blockerLane?.isDone) continue;
    blockers.push({ key: blocker.key, id: link.fromId });
  }
  return blockers;
}
