# Milestone 2b: Ticket Model and Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tickets carry an epic, tags, dependencies, success criteria, and per-project custom fields; the owner configures all of it in a Settings view; creating a ticket is a full-screen dialog with a proper picker for every choice.

**Architecture:** Same layering as before. `packages/core` gets the types, zod inputs, the dependency gate check, and the field value validator. `packages/db` gets one migration and repositories. `apps/server` gets routes for epics, tags, links, fields, and settings, and extends the ticket routes and the move gate. `apps/web` gets the `Picker`, the Settings view, the full-screen create dialog, and the panel's property editing.

**Tech Stack:** As milestone 2. No new dependencies; the Picker is hand-built on the existing focus trap.

**Spec:** `docs/superpowers/specs/2026-09-24-ticket-model-design.md` and the base spec. UI: `BRIEF.md`, `BRAND.md`.

## Global Constraints

Same as milestone 2 (licences, tokens only, no dashes, error shape, one transaction per mutation, append-only events, agents never delete, every control works), plus: after Task 5 no native `<select>` remains in `apps/web/src`; every Picker is keyboard operable and announces its options; required custom fields are enforced server-side. Branch `m2b-ticket-model` from `main` after milestone 2 merges.

## Tasks

### Task 1: Core types, inputs, and checks
`packages/core`: `Epic`, `Tag`, `TicketLink`, `FieldDefinition`, `FieldValue`; `Ticket` gains `epicId: string | null`, `tagIds: string[]`, `successCriteria: string`, `fields: Record<key, value>`; inputs `CreateEpicInput`, `UpdateEpicInput`, `CreateTagInput`, `LinkInput {from, to, kind}`, `FieldDefinitionInput`, `UpdateTicketInput` gains `epicId`, `tagIds`, `successCriteria`, `fields`; `validateFieldValues(defs, values, { requireAll })` returning `{ok} | {ok:false, issues:[{key, message}]}`; `checkDependencies(links, ticketsById, targetLane)` returning blocking ticket keys when the target lane is done; permissions additions. Tests for each validator (select value not in options, number as string, required missing on create but not on patch, date format) and for the dependency check.

### Task 2: Migration and repositories
M6: `epics`, `tags`, `ticket_tags`, `ticket_links`, `field_definitions`, `ticket_field_values`, `tickets.epic_id`, `tickets.success_criteria default ''`. Repositories: epics (list, create, update, archive), tags (list, create, archive), links (list for ticket, add, remove), fields (list, create, update, archive), values (get for ticket, set many), and `toTicket` joins tag ids, field values. Tests: unique tag name per project case-insensitive; link cycle `A blocks B blocks A` refused; archived field values retained but hidden.

### Task 3: Server routes and the extended gate
`/api/v1/epics` (GET list by project, POST human, PATCH human), `/api/v1/tags` (GET, POST human), `/api/v1/tickets/:id/links` (GET, POST, DELETE; agents allowed within scope; both tickets in the same project), `/api/v1/fields` (GET by project, POST, PATCH, POST archive; human), `PATCH /api/v1/tickets/:id` accepts the new fields with `criteria.edit` for `successCriteria` and `validateFieldValues` for `fields`; `POST /tickets` enforces required fields for the human only (agents may create with missing required fields and the ticket shows "Needs fields" in the panel); the move gate adds `blocked_by` reasons and `GET /tickets/:id/gates` includes them; events as the spec lists; stream invalidations. Tests for scope, permissions, the gate with dependencies, and required-field enforcement.

### Task 4: Picker component
`apps/web/src/components/Picker.tsx`: `<Picker label value|values options onChange multi? searchable? swatch? onCreate? placeholder />` with `Option = { id, label, family?, hint? }`; popover listbox, search, type-ahead, arrows, Enter, Escape, `aria-activedescendant`, focus return, outside click; "Create new" row when `onCreate`. Tests (jsdom): keyboard selection, multi toggle, search filtering, create row calls `onCreate`, focus return.

### Task 5: Replace every native select
Lane and board and assignee choices in NewTicket, TicketPanel, Board (Move to, board selector), Agents approval scopes, LaneRequirements, AddEvidence: all through Picker. Test: `grep -rn "<select" apps/web/src` is empty except Playwright helpers.

### Task 6: Settings view
Route `/settings`, sidebar item (Phosphor `GearSix`), `g s`. Tabs: Fields, Tags, Epics, Lanes, Evidence types. Each tab lists, creates, edits, reorders (up and down buttons, no drag), archives, with human-signed saves and inline errors. Lanes tab edits name, needs-human-on-entry, evidence requirements (moves out of the Board header; the Board's Requirements button navigates here). Tests for the fields form validation and the reorder helper.

### Task 7: Full-screen create dialog
Rebuild NewTicket to the spec: 90vw by 90vh, two columns, all fields through Picker, Success criteria composer, Dependencies picker with ticket search (`useTickets` filtered client-side by key or title), custom fields rendered by kind with required marks, automations preview line from lane requirements, Ctrl or Cmd plus Enter, the milestone 2 create sequence extended with epic, tags, links, fields, and success criteria (one PATCH after create). Tests: required custom field blocks Create; the request order.

### Task 8: Ticket panel properties and success criteria
Success criteria at the top with human-only checkbox ticking that writes markdown back; property rows (epic, tags, dependencies, fields) editable in place; "Needs fields" notice when required fields are empty. Tests for the checkbox round trip.

### Task 9: Chips and filters on Board and Queue
Epic chip and tag chips on rows and cards; Board header filters by epic and tag (Pickers, in the URL); Queue rows show the epic. Test: filtering.

### Task 10: Demo agent, e2e, README
Demo agent tags its ticket and links a dependency; a new e2e spec creates a ticket through the full dialog with a required custom field, an epic, two tags, and a dependency, then verifies the panel and the Board filter; README documents the model and Settings.

## Acceptance
1. The owner can define a required field in Settings and the create dialog refuses to create without it.
2. A ticket blocked by another cannot enter Done from any surface, and the refusal names the blocker.
3. No native select remains in the web app; every Picker works by keyboard alone.
4. All previous acceptance items hold; unit and e2e suites pass; dash grep is 0.
