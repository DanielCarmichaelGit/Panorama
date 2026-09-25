# Milestone 2c: Settings refresh

Spec: `docs/superpowers/specs/2026-09-24-settings-refresh-design.md`. Branch: `m2b-ticket-model` (ships with milestone 2b in one merge). Every task: TDD, no new dependencies, tokens only, no native select (a native colour input is allowed), no em or en dashes, sentence case, stage by path, commit with the Co-Authored-By trailer.

### Task 1: Server model: lane lifecycle, evidence type lifecycle, colour
Core: `color` on Epic and Tag (`/^#[0-9a-f]{6}$/i`, stored lower-case) in the create and update inputs (nullable on update); `CreateLaneInput`, `UpdateLaneInput`, `LaneOrderInput`; `CreateEvidenceTypeInput` (kind from EVIDENCE_KINDS, `params.threshold` 0 to 1 only for eval_score); `UpdateTagInput` (name, family, color); new human action `evidence.edit`. DB: migration M7 (`alter table epics add column color text`, same for tags); `createLane`, `updateLane`, `reorderLanes`, `deleteLane` (counts tickets first, archived included), `createEvidenceType`, `deleteEvidenceType` (refuses when any lane requirement or evidence row references it), `updateTag`, repositories returning `color`. Server routes per spec sections 2 to 4 with events `lane.created`, `lane.updated` (changed[]), `lane.reordered`, `lane.deleted`, `evidence_type.created`, `evidence_type.deleted`, `tag.updated`, and `color` in `epic.*` and `tag.*` payloads. Tests in packages/core, packages/db, apps/server (including the 409 cases and that agents are refused).

### Task 2: Colour rendering and the ColorField
`apps/web/src/lib/color.ts`: `chipTokens({family, color})` returning `{top, ink}` CSS values (family tokens when no colour; derived pair otherwise with luminance and contrast rules from the spec), unit-tested for contrast on every preset and on black, white, and mid-grey. `ColorField` component (spec section 2) with tests: swatch selection semantics, custom input, keyboard. Chip, Picker swatches, and the Board filter Pickers read tokens through `chipTokens`. Rename "Epic" strings to "Arc" everywhere in the web app (Board filter, dialog, panel, Settings tab, hooks' user-facing errors), tests updated.

### Task 3: Settings page rebuild
Spec section 5: the list-with-dividers layout and CSS, the row and expandable form pattern (`SettingsList`, `SettingsRow`, `RowForm` primitives in `components/settings/`), then each tab: Fields, Tags (editable), Arcs, Lanes (add, reorder, toggles, requirements, delete with the in-use rule), Evidence types (add, delete with the in-use rule). Hooks for the new routes. Tests per tab, at least: add lane, delete refused message shown, add evidence type with threshold, tag rename, arc custom colour saved.

### Task 4: E2E, README, demo agent copy
E2E: add a lane and an evidence type, require it on the lane, create a ticket and see it gated; delete refused. README: the Settings section updated (arcs, colours, lanes, evidence types). Demo agent log copy says arc where it says epic. Dash grep 0.

### Task 5: File field kind
Owner asked how images, files and video fit fields. Add a `file` field kind: the value is `{attachmentId}` referencing an attachment uploaded to the ticket (any type the attachment route accepts). Core: FIELD_KINDS gains `file`; FieldValueSchema accepts `{attachmentId: string}` for it; validateFieldValues checks the kind. Server: PATCH validates that the attachment belongs to the ticket. Web: FieldControl renders an upload control (reuses the attachment upload from NewTicket and TicketPanel) with an image preview for images and a filename link otherwise, Remove clears; NewTicket uploads after create like its attachments do and then PATCHes the field; Settings Fields tab offers the kind with the label "File". Tests at each layer. README field kinds list.

## Milestone 2d: Boomerang (owner decision 2026-09-25)
Spec: `docs/superpowers/specs/2026-09-25-boomerang-rename-design.md`. Runs after every 2c task has landed, on the same branch, before the final review.

### Task 6: The rename
Package names, imports, filters, root name, lockfile; env names with the old names read as a fallback; data dir move; storage keys; every user-facing string; docs (README, BRIEF, BRAND, specs' titles, skill copy); demo agent; e2e; launch.json. Acceptance 1 to 3 of the spec.

### Task 7: The boomerang illustration
`BoomerangScene` per spec section 2 replacing `LaneScene` everywhere, with tests and a screenshot pass at the lock screen, first project and an empty state. Acceptance 4.
