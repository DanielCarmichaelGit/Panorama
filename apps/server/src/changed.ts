/**
 * `changed[]` on an `*.updated` event names the fields whose value actually differs from the
 * row, not the keys the client happened to send: a form that saves {name, family, color} on
 * every click must not report three changes when only the colour moved, because milestone 3's
 * rule engine matches on `changed`. The event is still appended when nothing differs (an empty
 * `changed`), so the chain records that a save happened.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

type Comparator = (before: unknown, after: unknown) => boolean;

/** Patch keys whose value differs from `current`, in patch order. An undefined patch value is
 *  "not sent". `compare` overrides equality per key (a set-like array, a merged record). */
export function changedKeys(current: object, patch: object, compare: Record<string, Comparator> = {}): string[] {
  const before = current as Record<string, unknown>;
  const after = patch as Record<string, unknown>;
  return Object.keys(after).filter((k) => {
    if (after[k] === undefined) return false;
    const same = compare[k] ?? deepEqual;
    return !same(before[k], after[k]);
  });
}

/** Order does not matter for a tag set: [a, b] and [b, a] are the same tags. */
export const sameSet: Comparator = (before, after) => deepEqual([...(before as string[])].sort(), [...(after as string[])].sort());

/** A fields patch merges into the ticket's values, so only the keys it carries are compared;
 *  null and absent both mean "no value". */
export const sameMergedRecord: Comparator = (before, after) => {
  const b = (before ?? {}) as Record<string, unknown>;
  return Object.entries(after as Record<string, unknown>).every(([k, v]) => deepEqual(b[k] ?? null, v ?? null));
};
