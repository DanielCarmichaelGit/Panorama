// Browser storage keys. The pan.* names predate the rename to Boomerang and are cleared once.
export const ANCHOR_KEY = "bm.anchor";
export const SIDEBAR_KEY = "bm.sidebar";
export const INTRO_KEY = "bm.settingsIntro";

const OLD_ANCHOR_KEY = "pan.anchor";
const OLD_KEYS = [OLD_ANCHOR_KEY, "pan.sidebar", "pan.settingsIntro"];

/** Runs once at load. The anchor is carried over so the chain cross-check survives the rename. */
export function migrateStorageKeys(): void {
  try {
    const oldAnchor = localStorage.getItem(OLD_ANCHOR_KEY);
    if (oldAnchor !== null && localStorage.getItem(ANCHOR_KEY) === null) localStorage.setItem(ANCHOR_KEY, oldAnchor);
    for (const k of OLD_KEYS) localStorage.removeItem(k);
  } catch {
    // storage unavailable; nothing to migrate
  }
}
