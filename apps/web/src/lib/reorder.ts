export interface Positioned {
  id: string;
  position: number;
}

/**
 * The {id, position} pair needed to swap the item at `index` with its neighbour one step in
 * `direction` (-1 up, 1 down): each keeps its own id and takes the other's position. Null past
 * either end of the list, since there is no neighbour there to swap with. Used by the Fields and
 * Epics settings tabs for their Move up and Move down buttons.
 */
export function swapNeighbour<T extends Positioned>(items: T[], index: number, direction: -1 | 1): [Positioned, Positioned] | null {
  const neighbour = index + direction;
  if (index < 0 || index >= items.length || neighbour < 0 || neighbour >= items.length) return null;
  const a = items[index];
  const b = items[neighbour];
  return [{ id: a.id, position: b.position }, { id: b.id, position: a.position }];
}
