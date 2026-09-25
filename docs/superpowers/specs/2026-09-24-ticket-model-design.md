# Milestone 2b: Ticket model and creation

Date: 2026-09-24. Status: approved by the owner. Amends `docs/superpowers/specs/2026-09-21-panorama-design.md` section 3 and pulls epics and dependencies forward from milestone 4.

## Why

Creating a ticket in Boomerang should feel like Jira's create dialog, not a name box, and the owner must be able to decide what a ticket carries. Automations (milestone 3) need epics, tags, and fields to match on, so the model comes first.

## Vocabulary additions

Epic, Tag, Dependency, Success criteria, Field.

## Data model

- `epics`: id, project, name, description, family, position, created. A ticket belongs to at most one epic (`tickets.epic_id` nullable).
- `tags`: id, project, name (unique per project, case-insensitive), family, created. `ticket_tags`: ticket, tag. Tags replace the "user defined flags" idea for classification; flags stay for state (`needs_human`, `blocked`).
- `ticket_links`: from, to, kind (`blocks`, `relates`), created. `A blocks B` means B cannot enter a lane with `is_done` while A is not in a done lane; the gate reports it the same way it reports missing evidence, with reason `blocked_by`. `relates` is informational.
- `tickets.success_criteria`: markdown, human-editable, empty by default. Rendered at the top of the ticket panel through the same markdown pipeline; task-list items (`- [ ]`) in it render as checkboxes only the human can tick, and ticking writes the updated markdown back (human-signed `ticket.updated`).
- `field_definitions`: id, project, name, key (slug, unique per project), kind (`text`, `number`, `date`, `select`, `checkbox`), options (for select, list of `{value, label}`), required, position, created. `ticket_field_values`: ticket, field, value (JSON). Required fields are enforced at create for the human's dialog and at `PATCH` for everyone; agents may set values.
- Events: `epic.created`, `epic.updated`, `tag.created`, `ticket.linked`, `ticket.unlinked` (tag changes are not their own events: they travel in `ticket.updated` with `changed` including `tagIds`), `field.created`, `field.updated`, `field.archived`, and `ticket.updated` payloads now list which of `epicId`, `successCriteria`, `fields` changed.

## Permissions

Agents: `read`, `ticket.create`, `ticket.update` (including tags, epic, field values, but not `successCriteria`; agents may add links, and remove a `relates` link, but only the owner removes a `blocks` link, since that link is a gate), `ticket.move`, `flag.set`, `comment.add`, `evidence.add`, `attachment.add`. Human-only additions: `epic.edit`, `tag.edit`, `field.edit`, `criteria.edit`, `link.remove`.

## Views

- **Create ticket**: a full-screen dialog, 90vw by 90vh, rendered through a portal. Left: Title, Description, Success criteria, Attachments. Right: Board, Lane, Epic, Tags, Assignee, Start date, Due date, Dependencies (blocks, blocked by; search by key or title), Needs human, then custom fields in their configured order with required ones marked. Footer: an automations preview line (milestone 3 fills it; until then it says which lanes gate this ticket, from the lane requirements), Cancel, Create. Ctrl or Cmd plus Enter creates. The create sequence and its failure handling stay as built in milestone 2 Task 13.
- **Picker**: one component for every choice: a button showing the current value (with a swatch for boards, epics, tags), opening a popover listbox with a search input, arrow keys, Enter, Escape, type-ahead, `aria-activedescendant`, single or multi select, and an optional "Create new" row (tags, epics). No native `<select>` remains in the app after this milestone except inside the Playwright tests' own helpers.
- **Ticket panel**: success criteria at the top, then properties (epic, tags, dependencies with links, fields) editable in place through Pickers, then the existing checklist, thread, and composer.
- **Settings** (new sidebar item, human only): Fields (add, edit, reorder, archive), Tags, Epics, Lanes (rename, reorder, needs-human-on-entry, evidence requirements), Evidence types (custom types with pass condition), and the existing encryption toggle placeholder for milestone 5. Every save is human-signed and logged.
- **Board and Queue**: cards and rows show the epic chip and tag chips; the Board can group by board (existing) and filter by epic or tag through Pickers in the header.

## Out of scope

Automation editing (milestone 3), timers and cost (milestone 3 with MCP), Timeline (milestone 4), a dark theme.
