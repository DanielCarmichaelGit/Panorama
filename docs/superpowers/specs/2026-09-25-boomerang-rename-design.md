# Boomerang (milestone 2d: the rename)

Owner decision: the product is called **Boomerang**, not Panorama. Same colours, same type, same motion, no new stylistic choices. The isometric illustration becomes a boomerang mid-swoop with a tail of wind behind it.

## 1. Name

- Every user-facing string says Boomerang: the app title and `<title>`, the lock screen mark, the first-project screen, the sidebar mark, the README and BRIEF and BRAND headings, the demo agent log, the provenance skill copy where it names the product, the server's startup line.
- Package names: `boomerang` (root), `@boomerang/core`, `@boomerang/db`, `@boomerang/web`, `@boomerang/server`. Every import and every `pnpm --filter` follows. The lockfile is regenerated with `pnpm install`.
- Environment: `BOOMERANG_DATA_DIR` and `BOOMERANG_ALLOW_FAST_KDF`. The old `PANORAMA_*` names are read as a fallback for one release and logged as deprecated once at startup.
- Data directory: `~/.boomerang`. On startup, when `~/.boomerang` does not exist and `~/.panorama` does, the server moves it (rename, same filesystem) and logs one line saying so. Nothing else about the data changes: the config, the key, the chain, the database are untouched, so the owner's password still unlocks it.
- Browser storage keys: `bm.sidebar`, `bm.anchor`, `bm.settingsIntro`. The anchor key change means the first unlock after the rename has no anchor to compare against (the server still verifies the whole chain); the next checkpoint writes the new key. `pan.*` keys are removed on first load.
- Ticket keys, project keys, event names, routes, table names: unchanged (they never said Panorama).
- The git remote and the repository name are the owner's and stay as they are. The `.provenance` manifests already committed are history and are not rewritten.
- The word Panorama may remain only in: git history, the committed provenance manifests, and one line in the README ("Boomerang was called Panorama until 2026-09-25").

## 2. The illustration

`apps/web/src/lib/iso.tsx` exports `BoomerangScene` (the `LaneScene` name and its `settle` prop are removed; every usage updated: lock screen, first project, Queue empty state, Agents empty state, Settings empty rows).

- Isometric, crisp, the Stripe and Linear marketing register already locked in BRAND.md. The boomerang is a V of two blades meeting at an obtuse angle, drawn as an extruded isometric solid: top face in one family top, the two visible sides in that family's left and right tones, a 1px ink outline in the family ink. Families used: the boomerang in `sky`, the wind in `stone` at low opacity, one accent detail (a small `coral` cap or band on one blade tip) so it belongs to the same set as the lane blocks did.
- It sits mid-swoop: tilted along the isometric axis as if banking, slightly above a small isometric ground shadow (an ellipse in `stone-top` at 60 percent opacity).
- The wind tail: three to five tapered streaks trailing from the inner elbow and the trailing blade tip, following the arc of flight, drawn as paths in `stone-left` and `sky-top` at 30 to 60 percent opacity, longest in the middle, none crossing the boomerang.
- Motion: on mount the boomerang eases in along the arc from 24px behind its resting point with the entrance curve, and the tail streaks fade in staggered by 40ms; transform and opacity only; respects `prefers-reduced-motion` (no motion). No looping animation.
- Sizes: the component scales to its container width (viewBox), used at up to 420px on the lock screen and 96px in empty rows; at 96px the tail keeps two streaks and the shadow drops (a `compact` prop).
- Tokens only: fills reference the CSS variables through `var(--sky-top)` and so on; no hex in the SVG.
- Tests: renders an `svg` with `role="img"` and an `aria-label` "A boomerang mid-swoop with a tail of wind"; `compact` renders fewer streaks; with reduced motion no animation class is applied.

## 3. Acceptance

1. `grep -rni panorama` over the repository, excluding node_modules, dist, .git, .provenance, .superpowers, .claude and the one README history line, returns nothing.
2. Fresh install (`pnpm install`, `pnpm -r build`, `pnpm vitest run`, `pnpm e2e`) is green.
3. Starting the server against an existing `~/.panorama` moves it to `~/.boomerang` and the owner's password unlocks it.
4. The lock screen, first-project screen and every empty state show the boomerang; no lane scene remains.
