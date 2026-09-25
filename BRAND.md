# Boomerang: BRAND.md

Locked visual system. Re-read before every visual change. Values marked **exact** were tuned and are not to be rounded or swapped for framework palette names.

Reference the owner chose: Stripe and Linear marketing illustration. Crisp isometric blocks, cool pastels, technical. We take the principles, never their values.

In one sentence: a white drafting table, pastel modelling blocks, and one deep teal pen.

## Tokens (exact)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FAFBFC` | app ground |
| `--surface` | `#FFFFFF` | cards, rows, sidebar, panels |
| `--line` | `#E3E7EE` | borders, dividers |
| `--text` | `#1B2230` | body and headings |
| `--muted` | `#5D6778` | secondary text, field labels |
| `--accent` | `#12706A` | the action colour |
| `--on-accent` | `#F3FFFC` | text on the action colour |

Contrast, checked: text on bg 15.4, muted on bg 5.5, muted on surface 5.7, accent on bg 5.7, on-accent on accent 5.8.

### Pastel families (exact)

Each family is `top / left / right / ink`. Top, left, right are the three faces of an isometric block. In flat UI, `top` is the chip or tint background and `ink` is the text on it (all ink on top pairs are above 6:1).

| Family | top | left | right | ink | Meaning |
|---|---|---|---|---|---|
| coral | `#FFD3C9` | `#F7A999` | `#E98672` | `#8A2A17` | needs human, failed, blocked |
| sky | `#CFE6FB` | `#A3CDF3` | `#7FB3E6` | `#124A7A` | in progress, agent working |
| lilac | `#E1DAFB` | `#C2B5F2` | `#A595E6` | `#43318F` | eval, review |
| mint | `#CDF0E2` | `#9FDDC5` | `#78C7A9` | `#0E5A43` | done, passing evidence |
| stone | `#EEF1F5` | `#D9DEE6` | `#C3CAD6` | `#3A4352` | neutral: backlog, epic labels, platforms |

Colour always encodes something the user can name: a state, a lane category, or an epic. Never decoration. Users may assign a family to a custom lane or epic; they pick from these five plus three reserved extensions (sand, rose, aqua) to be derived the same way when needed.

### Accent budget

The teal appears on: the primary button, the active sidebar item, the focus ring, inline links, and the mono count numeral in a view header. Nowhere else.

## Type

- Sans: **Figtree**. Mono: **JetBrains Mono**. Both OFL, self-hosted as woff2 inside the repo so the app works offline. No CDN requests at runtime.
- Weights: 400 body, 600 titles and emphasis, 700 for the view H1 only. Mono 400 and 500.
- Scale: view H1 2.4rem / 1.0 line height / -0.035em. Section heading 1.125rem / -0.01em. Body 0.9375rem (15px) / 1.55. Small 0.8125rem. Mono meta 0.75rem, tabular numerals.
- Mono is for machine facts only: ticket IDs, timers, token counts, costs, agent names, hashes, timestamps.

## Shape

- Radius: 12px cards, rows, panels. 8px inputs and menus. 999px chips and buttons. Exact.
- Borders 1px `--line`. Shadows only on hover lift and on overlays: `0 6px 16px -8px rgba(20,30,60,.25)`. One light source, from above.
- Chips are pills because they are small, one of several, and filterable on click. Headings never get a pill.

## Composition

Boomerang is an application shell with views. It is carried by structure.

One sentence: sidebar on the left, view header top left with a mono count beside the title, content rows running the full width, the open ticket as a right-hand panel, and nothing centred except empty states.

- Sidebar: 232px, collapses to 56px (icons with tooltips). Holds project switcher, Queue, Board, Timeline, Epics, Automations, Agents, Settings, and the chain and lock status at the bottom.
- Ticket detail: right panel, 60vw (never under 520px or over 1100px), pushes content at widths above 1600px and overlays below. Full page route also exists for deep links. (Widened by the owner on 2026-09-24.)
- Gutter: 16px below 860px, 28px above, on everything that touches the content edge. Exact.
- Below 860px the sidebar becomes a bottom sheet behind a menu button and rows drop agent and token fields.

Layer stack, back to front: ground 0, content 10, sticky view header 20, sidebar 30, ticket panel 40, menus and popovers 50, modal and lock screen 60, toasts 70.

## Motion

Two curves, no others. Entrance: `cubic-bezier(.16,1,.3,1)`. Interaction: `cubic-bezier(.2,.7,.3,1)`. Interaction duration 150ms. Transform and opacity only.

Choreography, once, after unlock or first load:

| Element | Motion | Duration | Delay |
|---|---|---|---|
| Sidebar | fade | 300ms | 0 |
| View header | fade, rise 8px | 400ms | 80ms |
| Rows 1 to 8 | fade, rise 6px | 350ms | 140ms + 30ms each |
| First needs-human row | receives focus | | at 600ms |

Total under 1 second because this is a tool opened many times a day. View switches get a 120ms content fade and nothing else. Nothing animates on scroll. The resting state is the finished state; build it first. Under `prefers-reduced-motion` everything arrives at once.

Live changes (an agent moves a ticket while you watch): the row or card slides to its new position over 250ms on the entrance curve and its state chip cross-fades. No flash, no toast for routine moves. A new needs-human ticket enters the Queue at the top with the same rise.

## Interaction inventory

| What | Trigger | Behaviour |
|---|---|---|
| Primary button | hover | lift 1px, brightness 1.08 |
| Primary button | active | returns to 0 |
| Ghost button | hover | border to `--text` |
| Any control | focus-visible | 2px `--accent` ring, 3px offset |
| Sidebar item | hover | background `--line`, text to `--text` |
| Sidebar item | current | `--accent` background, `--on-accent` text |
| Ticket row, board card | hover | lift 1px, shadow, border to `--muted` |
| Ticket row, board card | click or Enter | opens ticket panel |
| Board card | drag | lifts 2px with shadow, origin slot shows dashed `--line`; illegal drop lanes dim to 50% and show the missing evidence on hover |
| Chip (state, epic) | | chips on rows and cards are read-only; filtering lives in the Board header's Pickers (chip-click filtering deferred) |
| Timeline bar | drag ends, drag body | resize or move dates, snaps to day |
| Timer control | click | toggles, mono time ticks each second |
| Text selection | | `--accent` background, `--on-accent` text |

If a behaviour is not here it does not exist. If a control has no behaviour it does not ship.

## Signature element: the boomerang

- **What:** a boomerang mid-swoop with a tail of wind, drawn as an extruded isometric solid in the sky family (top face `sky-top`, the visible sides `sky-left` and `sky-right`, a 1px `sky-ink` silhouette), a coral band on the leading tip, a ground shadow (`stone-top` at 60 percent) and three to five tapered wind streaks in `stone-left` and `sky-top` at 30 to 60 percent following its arc. All of it comes from one component, `BoomerangScene` in `apps/web/src/lib/iso.tsx`, built from a few plan points through the same 30 degree projection as the block helpers, so faces share their edges exactly. Flat fills, no gradients, no glow.
- **Where:** lock screen, first-run onboarding, empty states (Queue, Agents, the Settings lists) and the sidebar mark. Never inside working views that have data.
- **What it does:** on mount it eases in along its arc from 24px behind its resting point, 500ms on the entrance curve, and the streaks fade in staggered 40ms, once. Transform and opacity only. No loop.
- **Sizes:** scales to its container: up to 420px on the lock screen, 96px in Settings empty rows and 20px in the sidebar mark, where `compact` keeps two streaks and drops the shadow.
- **Reduced motion:** the resting frame, which is the finished illustration; no animation class is applied.

## Icons

Phosphor, regular weight, 18px in the sidebar and 16px inline, imported per glyph. One family, no emoji. Every icon that carries meaning sits next to a label, except in the collapsed sidebar where a tooltip and `aria-label` carry it.

## Known compromises

- Light theme only in v1. A dark theme is on the traction list.
- The motion-noise recovery display cannot honour reduced motion, because motion is how it works. It offers an explicit "show as plain text" button instead.
- The sidebar width snaps when it collapses or expands; only its contents animate. Animating the shell's `grid-template-columns` relaid out the whole page on every frame, which is the layout thrash BRAND rules out, so the track changes in one step and the nav items and labels carry the motion.

## Colour presets

Arcs and tags may carry a custom colour beside their family. The colour control offers, in this order: the five family swatches, then these seven presets, then Custom (a native colour input with a hex field).

| Preset | Hex |
|---|---|
| 1 | `#F6C1B4` |
| 2 | `#F7D9A8` |
| 3 | `#F2E8A6` |
| 4 | `#BFE8CF` |
| 5 | `#B9DDF5` |
| 6 | `#D3C8F4` |
| 7 | `#F2C4E0` |

Pastel hues at family-top lightness, chosen so they read as siblings of the five families. A family swatch sets the family and clears the colour; a preset or custom colour sets the colour and keeps the family as the fallback. Any custom colour is rendered through two derived tokens, computed in code (`apps/web/src/lib/color.ts`): `top`, the colour mixed toward white until its relative luminance is at least 0.78, and `ink`, the colour darkened until it reads at 4.5:1 or better against that top. The selected swatch shows a 2px `--accent` ring.
