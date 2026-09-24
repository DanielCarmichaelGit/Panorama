# Panorama: BRAND.md

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

Panorama is an application shell with views. It is carried by structure.

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

## Signature element: the isometric block scene

- **What:** lanes drawn as stone platforms with tickets as pastel blocks stacked on them, one block coral. All isometric art in the product comes from one `isoBox(x, y, z, w, d, h, family)` helper using the three face tones above, 30 degree projection, flat fills, no gradients, no outlines, no glow.
- **Where:** lock screen, empty states (Queue, Board, Epics, Automations, Agents), first-run onboarding, epic cover thumbnails. Never inside working views that have data.
- **What it does:** on the lock screen and onboarding, blocks settle from 12px above their resting place, 500ms each on the entrance curve, staggered 40ms, once. Everywhere else it is static.
- **At 375px:** scales to container width, capped at 240px tall.
- **Reduced motion:** the resting frame, which is the finished illustration.

## Icons

Phosphor, regular weight, 18px in the sidebar and 16px inline, imported per glyph. One family, no emoji. Every icon that carries meaning sits next to a label, except in the collapsed sidebar where a tooltip and `aria-label` carry it.

## Known compromises

- Light theme only in v1. A dark theme is on the traction list.
- The motion-noise recovery display cannot honour reduced motion, because motion is how it works. It offers an explicit "show as plain text" button instead.
- The sidebar width snaps when it collapses or expands; only its contents animate. Animating the shell's `grid-template-columns` relaid out the whole page on every frame, which is the layout thrash BRAND rules out, so the track changes in one step and the nav items and labels carry the motion.
