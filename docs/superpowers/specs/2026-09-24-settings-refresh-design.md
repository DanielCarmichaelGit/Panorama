# Settings refresh (milestone 2c)

Owner feedback on the milestone 2b Settings page: the style is right but the components are too big and the page feels bland; lanes and evidence types cannot be added or removed; epics need a better name; colours should offer defaults and also let people pick their own. This document settles the model and the look. It amends the ticket model spec; everything not mentioned stays as built.

## 1. Names

- Epics are called **arcs** in every user-facing string: the Settings tab, the create dialog row, the panel row, the Board filter, chips, README. An arc is a body of work that a group of tickets carries forward. The API, the database, the event names, and the code keep `epic` (agents already use `/api/v1/projects/:id/epics`; renaming the surface would be churn for no gain). The README says "Arcs (epics in the API)" once.

## 2. Colour

Every coloured thing (arc, tag, lane, board) keeps its `family` (coral, sky, lilac, mint, stone). Arcs and tags gain an optional `color`, a hex string `#rrggbb`, which wins over the family when set. Lanes and boards stay family-only in this milestone.

- Migration M7 adds `color text` (nullable) to `epics` and `tags`. Core validates `color` with `/^#[0-9a-f]{6}$/i` and stores it lower-case. Create and update inputs accept `color` (nullable on update to clear it). `epic.updated` and `tag.updated` events carry it; tags gain `tag.updated` (name and colour edits) in addition to `tag.archived`.
- Rendering: `apps/web/src/lib/color.ts` derives two tokens from a hex colour in code, deterministically and testably: `top` (the chip background: the colour mixed toward white until its relative luminance is at least 0.78, roughly what the family tops are) and `ink` (the text: the colour darkened until contrast against `top` is at least 4.5:1). Chip, Picker swatches, and Board filters use `colorTokens(item)` which returns the family tokens when `color` is null.
- The colour control (`ColorField`): a row of round swatches, 20px, in this order: the five family swatches, then seven preset hexes, then a "Custom" swatch that shows the current custom colour (or a dashed ring when none). Selecting a family swatch sets `family` and clears `color`. Selecting a preset sets `color` (family stays as it was, it is the fallback). The Custom swatch opens a native `<input type="color">` (a colour input is not a select; it is the one native control the platform does well) with a hex text field beside it. The selected swatch shows a 2px accent ring; each swatch has an accessible name. Presets, recorded in BRAND.md under "Colour presets": `#F6C1B4`, `#F7D9A8`, `#F2E8A6`, `#BFE8CF`, `#B9DDF5`, `#D3C8F4`, `#F2C4E0` (pastel hues at family-top lightness, chosen so they read as siblings of the five families).

## 3. Lanes

Lanes can be added and removed, never renamed (names are part of the event history and agents match on them).

- `POST /api/v1/projects/:id/lanes` `{name, family, setsNeedsHuman, isDone}`: appends after the last lane that is not a done lane, or at the end if there is none. Name unique per project (case-insensitive ASCII), 1 to 40 characters. Human only (`lane.edit`). Event `lane.created`.
- `PATCH /api/v1/lanes/:id` `{family?, setsNeedsHuman?, isDone?}`: no name. Event `lane.updated` with `changed[]`.
- `PUT /api/v1/projects/:id/lanes/order` `{ids}`: the full ordered list of the project's lane ids. Event `lane.reordered`.
- `DELETE /api/v1/lanes/:id`: refused (409 `lane_in_use`) while any ticket, archived or not, is in the lane; the message says how many and to move them first. Refused (409 `last_lane`) when it is the project's only lane. Event `lane.deleted`. Requirements go with it.
- The gate on move and on create is unchanged.

## 4. Evidence types

Evidence types can be added and removed. They are global (shared by every project), as built.

- `POST /api/v1/evidence-types` `{name, kind, params?, humanOnly, needsAttachment}` with `kind` one of the seven built-in kinds; `params.threshold` (0 to 1) only for `eval_score`. Name unique (case-insensitive ASCII), 1 to 60 characters. New human action `evidence.edit`. Event `evidence_type.created`.
- `DELETE /api/v1/evidence-types/:id`: refused (409 `evidence_type_in_use`) while any lane requirement or any evidence row references it; the message names the lanes (or says how many evidence rows). Built-in types follow the same rule. Event `evidence_type.deleted`.
- No editing of an existing type in this milestone (name and kind are what evidence rows and requirements were recorded against).

## 5. The Settings page

The page keeps its tabs (Fields, Tags, Arcs, Lanes, Evidence types) and the locked tokens. What changes is density and character.

- **One list per tab, not one card per item.** A single bordered surface (`--r-card`) with 1px dividers between rows. Rows are 44px tall on desktop, more when they wrap. Every list has a header line: a muted one-sentence description on the left and the primary action ("Add field", "Add tag", "Add arc", "Add lane", "Add evidence type") as a normal-sized `btn` on the right. No full-width buttons anywhere on the page.
- **Rows show, controls appear on demand.** A row shows its identity (swatch or chip, name in 600 weight, key or kind in mono muted) and its facts as small chips or muted text ("Required", "3 options", "Needs human on entry", "Done lane", "Gated by Eval score, Human sign-off", "Human only"). The row's actions sit at the right as 32px icon buttons with tooltips (Phosphor: PencilSimple, ArrowUp, ArrowDown, Archive, Trash). Clicking Edit expands the row in place into a compact form (inputs 34px tall, labels 12px 600) with Save and Cancel as small buttons; only one row is expanded at a time; Escape cancels.
- **Adding** opens the same compact form as a new row at the top of the list, focused on the name.
- **Lanes tab.** Rows in position order with the family swatch, name, chips for Needs human on entry and Done lane, and the requirement summary. Expanding a lane shows: family swatches (ColorField without presets, lanes are family-only), two toggles (Needs human on entry, Done lane), and the requirement rows (RequirementRows: evidence type Picker, count, Remove) with an Add requirement link-button; Save writes requirements and the lane patch. Move up and move down reorder through the order route. Delete asks for confirmation inline ("Delete Eval? Its 0 tickets stay where they are." is wrong: the server refuses when tickets exist, so the row shows "Move its 3 tickets first" muted text and a disabled Delete when the count is non-zero; the count comes from the tickets already loaded for the project).
- **Evidence types tab.** Rows: name, kind in mono, chips Human only and Needs attachment, and "Used by Review, Done" muted when lanes require it. Add form: name, kind Picker, threshold (only when eval_score), two checkboxes. Delete is disabled with the reason when in use.
- **Arcs tab.** Rows: chip in the arc's colour, description muted (one line, truncated), ticket count in mono, Archive. Form: name, description, ColorField.
- **Tags tab.** Rows: chip, ticket count, Archive. Form: name, ColorField. Tags become editable (name and colour) through `PATCH /api/v1/tags/:id`.
- **Fields tab.** Rows: name, key in mono, kind, Required chip, "n options" for selects, Move up and down, Archive. The form stays as built but at the new density; select options are a compact list with a small "Add option" link-button.
- **Character.** Each tab's header sentence says what the thing is for in one line ("Tags are quick labels. Arcs are bodies of work. Lanes are the stages a ticket moves through."). Empty states are one line with a 96px `LaneScene`-style mark at most (the only isometric art on the page). Counts are in JetBrains Mono. Colour appears through swatches and chips, never through backgrounds on rows.
- **Responsive.** Under 720px, row facts wrap under the name and the icon buttons stay on the right; the tab strip scrolls horizontally as built.

## 6. Acceptance

1. The owner can add a lane, reorder it, toggle Needs human and Done on it, and delete it when empty; deletion of a lane with tickets is refused with a message naming the count.
2. The owner can add an evidence type and use it as a lane requirement; deleting one that a lane requires is refused naming the lane.
3. Arcs and tags can be given a preset or custom colour and chips everywhere render it with readable ink.
4. Every user-facing string says arc, not epic; the API is unchanged.
5. No full-width buttons on Settings; rows are 44px at rest; all existing Settings tests updated and passing; no native select; no em or en dashes.
