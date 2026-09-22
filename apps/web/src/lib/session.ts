let seed: Uint8Array | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const session = {
  setSeed(s: Uint8Array) { seed = s; emit(); },
  getSeed: () => seed,
  clear() { seed?.fill(0); seed = null; emit(); },
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
};
