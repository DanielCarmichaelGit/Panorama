# Panorama system design

Date: 2026-09-21. Status: approved and frozen by the owner on 2026-09-21. Amend through the owner. UI brief: `BRIEF.md`. Visual system: `BRAND.md`.

## 1. Purpose

A free, MIT licensed, self-hosted project manager for one developer supervising several AI agents. Agents connect from outside through REST or MCP. Work moves only by deterministic rules. A ticket enters a gated lane only with the evidence that lane requires. Panorama contains no agents and makes no LLM calls.

## 2. Architecture

TypeScript monorepo, pnpm workspaces.

| Package | Responsibility | Depends on |
|---|---|---|
| `packages/core` | Domain types, zod schemas, rule evaluation, evidence checks, hash chain, signing and verification. Pure, no I/O. | nothing |
| `packages/db` | SQL migrations and typed repositories over prepared statements. SQLite via `better-sqlite3-multiple-ciphers` (SQLCipher compatible). A plaintext `config.json` beside the database holds the salt, the human public key, and the encryption setting, because they are needed before unlock. | core |
| `apps/server` | Fastify REST API, SSE stream, scheduler, outbox worker, file storage, unlock lifecycle. | core, db |
| `apps/mcp` | MCP server (official SDK, stdio and streamable HTTP). A thin client of the REST API that signs with the agent key. | core |
| `apps/web` | React and Vite single page app. Served as static files by the server in production. | core |

All open source libraries: Fastify, zod, croner (cron), `@noble/ed25519`, `hash-wasm` (Argon2id), TipTap (editor, markdown input rules), dnd-kit (board), DOMPurify, Phosphor icons, Vitest, Playwright. The Timeline is a custom SVG component.

Run: `pnpm start` or `docker compose up`. Default bind `127.0.0.1:4400`. Data directory `~/.panorama/` holds `panorama.db` and `files/`.

## 3. Vocabulary and data model

Project, Board, Epic, Ticket, Lane, Flag, Evidence, Rule, Trigger, Agent.

- `projects`: id, key (ticket prefix), name.
- `boards`: id, project, name, description, colour family, position. A board groups tickets inside a project the way an epic categorises them, and a ticket belongs to exactly one board; every project gets a default board named after the project. Lanes stay per project, so every board shares the same lanes. Rules are project-scoped and may match on board, so an automation can move a ticket between boards or react to work on any board. (Added by the owner on 2026-09-24; its wider role arrives with the rule engine.)
- `epics`: id, project, name, colour family, description.
- `lanes`: id, project, name, position, colour family, `sets_needs_human` (bool), `evidence_requirements` (list of `{typeId, count, description?}`; the description says what the evidence should show, "A markdown file explaining what needs to be done", trimmed, at most 2000 characters, absent when empty, and it travels with the gate: each missing entry in the gates report and in the 422 refusal carries it so an agent knows what to provide), `is_done` (bool).
- `tickets`: id, project, board, number, title, epic, lane, position, flags (set: `needs_human`, `blocked`, plus user defined), assignee actor, start date, due date, `metadata` (free JSON for agents), created and updated.
- `ticket_links`: from, to, kind (`blocks`, `relates`). Drives Timeline dependencies.
- `comments`: id, ticket, actor, body markdown, created. Append-only.
- `attachments`: id, ticket, comment (optional), filename, mime, size, sha256, path.
- `evidence_types`: id, name, kind (`test_run`, `pr_link`, `eval_score`, `screenshot`, `human_signoff`, `file`, `custom`), JSON schema for the payload, pass condition (for example `score >= 0.9`, `failed == 0`).
- `evidence`: id, ticket, type, payload JSON, attachment (optional), actor, result (`pass`, `fail`, `info`), created. Append-only. `human_signoff` is valid only with a human signature.
- `timers`: id, ticket, actor, started, stopped. One open timer per actor per ticket.
- `cost_entries`: id, ticket, actor, model, input tokens, output tokens, cost, note, created. Ticket and epic totals are sums.
- `actors`: id, kind (`human`, `agent`), name, public key, scopes, status (`pending`, `active`, `revoked`), last seen.
- `rules`: id, project, name, enabled, event, conditions, actions, human signature.
- `triggers`: id, project, name, cron, timezone, target (ticket, ticket template, or event name), missed policy (`fire_once`, `fire_all`, `skip`), last fired.
- `destinations`: id, name, kind (`webhook`), url, HMAC secret.
- `outbox`: id, destination, event payload, attempts, next attempt, acknowledged.
- `events`: seq, prev hash, hash, actor, type, payload, signature, created. The hash chain.
- `checkpoints`: seq, chain head hash, human signature, created.

## 4. Identity, signing, permissions

- **Human key.** At setup the browser derives an Ed25519 seed from the password with Argon2id and a stored salt. Only the public key is stored. The password and seed are never written anywhere. The private key lives in browser memory for the session.
- **Agent keys.** An agent calls MCP tool `register_agent` (or `POST /agents/register`) with a name and a public key it generated itself. The actor is `pending` and can do nothing until the human approves it in the Agents view with a signed request. The human sets scopes at approval.
- **Every request is signed**: method, path, body hash, timestamp, nonce. The server rejects stale timestamps and reused nonces.
- **Scopes for agents**: projects and lanes they may touch, and a fixed action list: read, create ticket, comment, attach evidence, move ticket (subject to gates), toggle own timers, add cost entries, set flags. Agents can never delete, edit rules, triggers, lanes, evidence types, destinations, actors, or settings, and can never produce `human_signoff`.
- **Human-only actions**: everything agents cannot do, plus clearing `needs_human` when a lane or rule set it. Deletes are soft (archived) and logged.

## 5. Tamper evidence

Every state change appends to `events` with `hash = sha256(prev_hash, canonical payload)`, inside the same SQLite transaction as the change. Human actions carry the human signature; agent actions carry the agent signature. On unlock the server verifies the whole chain, checks it against the last signed checkpoint, and the browser signs a new checkpoint. A break shows a blocking banner with the first bad sequence number. Settings offers full verification and JSONL export.

A checkpoint is the owner's signature over the text `"<seq>:<headHash>"`, so it is bound to one point in the chain and cannot be moved to another; verification walks every entry from GENESIS and then requires the entry at the checkpoint's seq to carry the checkpoint's hash, which is what a rewritten or truncated chain cannot produce. The browser keeps the seq and hash it last signed in `localStorage` under `pan.anchor` and asks the server for the hash at that seq on the next unlock, so a rollback of the `checkpoints` table itself is caught by the one party the attacker does not hold.

This is tamper evident, not tamper proof. It exists for the case where a local agent reads the database credentials from disk and edits SQLite directly.

## 6. Encryption and lock

- Setting, default on. A database key is derived from the password with Argon2id and a second salt, sent once to the server over localhost at unlock, and held only in server memory. SQLCipher encrypts the file. Attachments are encrypted with the same key (AES-256-GCM per file).
- Locked state: every endpoint except `/unlock` and `/health` returns `423 Locked` with `Retry-After`. Schedules do not fire. MCP tools return a clear locked error so agents can back off.
- Encryption off: no unlock step, schedules fire unattended after restart. The human key is still required for human-only actions.
- **Recovery code**: 128 random bits shown once at setup. It wraps a copy of the seed and database key (stored as an encrypted blob). Displayed on the motion-noise canvas (section 7). Changing the password re-wraps; it does not re-encrypt the database.

## 7. Motion-noise display

A canvas of 2px dots at 50 percent density. Glyph pixels form a mask. Each frame (30fps) dots inside the mask shift 1px right and wrap within the mask; dots outside shift 1px left and wrap. Both regions have identical density and are seeded randomly, so any single frame is uniform noise and the text is visible only through motion. The canvas hides on window blur and after 60 seconds. It defeats single screenshots, not screen recording or frame differencing, and the UI says so. An explicit "show as plain text" button exists for accessibility.

## 8. Rule engine

Rules are data: `{event, conditions[], actions[]}`. Deterministic, no scripting in v1.

- **Events**: `ticket.created`, `ticket.updated` (carries `changed[]`, the names of the fields whose value actually differs from the row, not the keys the client sent; `tagIds` included when tags were added or removed, compared as a set; `fields` compared per key), `ticket.moved` (from, to), `ticket.flag_set`, `ticket.flag_cleared`, `ticket.linked`, `ticket.unlinked` (from, to, kind), `evidence.added` (type, result), `comment.added`, `epic.created`, `epic.updated` (changed[]), `tag.created`, `tag.archived`, `field.created`, `field.updated` (changed[]), `field.archived` (milestone 2b), `tag.updated` (changed[]), `lane.requirements_set` (requirements), `lane.created`, `lane.updated` (changed[]), `lane.reordered` (ids), `lane.deleted`, `evidence_type.created`, `evidence_type.deleted` (milestone 2c; evidence types are global, so those two carry no projectId; every `changed[]` is computed by comparing the patch against the row, so a no-op save appends the event with an empty list), `timer.started`, `timer.stopped`, `cost.added`, `trigger.fired`, `ticket.due_passed`.
- **Conditions**: all must hold. Fields: project, epic, lane, flag, actor, evidence type and result, metadata path, with operators `is`, `is_not`, `in`, `gte`, `lte`, `exists`.
- **Actions**: `move_to_lane`, `set_flag`, `clear_flag` (not `needs_human` when human set), `assign`, `add_comment` (system actor), `emit_webhook` (destination, payload template), `create_ticket` (from template), `start_timer`, `stop_timer`.
- The owner's example: event `ticket.moved` to Ready for Production, condition epic is X, action `set_flag needs_human`.
- The owner's pipeline: `ticket.moved` to Done lane of build work, action `move_to_lane Eval`; `evidence.added` eval_score pass in Eval, action `move_to_lane Ready for Production`; fail, action `move_to_lane In Progress` and `set_flag needs_human` after the second fail (condition on metadata counter).
- **Gate**: `move_to_lane`, from any source, runs the target lane's evidence check. Missing evidence returns `422` listing what is missing; when a rule hits the gate, the ticket stays put, gets `blocked`, and a system comment names the missing evidence.
- **Loop guard**: each causal chain carries a depth counter, maximum 8, and a rule cannot fire twice on the same ticket within one chain. Violations are logged to the rule's run log and flagged `needs_human`.
- Rule edits are human-signed. Each rule keeps a run log.

## 9. Triggers, outbox, webhooks

- Scheduler evaluates cron triggers in process. On start or unlock it compares each trigger's schedule with `last_fired` and applies the missed policy, so downtime leaves no blind spot.
- `trigger.fired` is an ordinary event: rules can react, and the usual use is `emit_webhook` to another AI or service with the ticket payload.
- All outbound delivery goes through `outbox`: written in the same transaction as the event, delivered by a worker, retried with exponential backoff up to 24 hours, HMAC-SHA256 signed, marked acknowledged on any 2xx. Failures after the final attempt flag the ticket `needs_human`.
- Inbound: agents act through REST or MCP. MCP tools: `register_agent`, `list_tickets`, `get_ticket`, `create_ticket`, `move_ticket`, `add_comment`, `attach_evidence`, `start_timer`, `stop_timer`, `report_cost`, `set_flag`, `next_ticket` (oldest Ready ticket in scope).

## 10. API surface

REST under `/api/v1`, JSON, zod validated, OpenAPI document generated from the schemas. `GET /api/v1/stream` is server-sent events for live UI updates. Files upload as multipart, 50 MB cap per file (configurable). Errors use one shape: `{error: {code, message, details}}`.

## 11. Comment rendering safety

Markdown renders through a strict pipeline. Comment bodies are stored verbatim; the web client sanitises at render time with DOMPurify after marked. Raw HTML blocks and `.html` attachments render only inside a sandboxed frame with a restrictive CSP, using an `iframe` with `sandbox` (no `allow-scripts`, no `allow-same-origin`); attachments are never served as `text/html`. No remote resources load: images must be attachments.

## 12. Error handling

Validation errors 400, signature failures 401, scope failures 403, gate failures 422, locked 423. SQLite runs in WAL mode; every mutation plus its event plus its outbox rows is one transaction. The server refuses to start on a failed migration and says why. The web app shows per-view error states with retry.

## 13. Testing

- `core`: unit tests for rule evaluation, gates, loop guard, chain hashing, signature verification, missed-run calculation. Test driven.
- `server`: integration tests against a temporary encrypted database covering every endpoint, scope enforcement (an agent key attempting each forbidden action), lock behaviour, outbox retries with a fake destination.
- `mcp`: tool contract tests against a running server.
- `web`: component tests for the composer shorthand and the rule builder; Playwright flows for first run, unlock, clearing the Queue, a gated drag being refused, building the owner's example rule.
- Tamper test: edit the database file directly, confirm the next unlock reports the broken sequence.

## 14. Milestones

Each milestone is its own implementation plan and ends in something usable.

1. **Foundation**: monorepo, database, setup and unlock, human key, agent registration and approval, signing, hash chain, projects, lanes, tickets, REST, app shell with sidebar, Queue, ticket panel, lock screen.
2. **Evidence and conversation**: comments and composer, attachments, evidence types, lane gates, flags, Board with gated drag, SSE, presence-first home, boards.
2b. **Ticket model and creation** (added by the owner on 2026-09-24): epics and dependencies pulled forward from milestone 4, tags, success criteria, per-project custom fields, a Settings view (fields, tags, epics, lanes and requirements, evidence types), a full-screen create dialog, and a shared Picker replacing every native select.
3. **Automation**: rule engine, the Automations canvas, triggers, missed-run catch-up, outbox, webhooks, run logs, MCP server, timers and cost reporting (pulled forward from milestone 4 at the owner's request). The Automations view (sidebar item after Board) is a visual flow canvas, not a form: a rule is drawn as nodes on a canvas, When (event), If (conditions), Then (actions), connected left to right, with no code anywhere. Built on `@xyflow/react` (MIT) with every node, edge, handle, and control drawn in Panorama's own tokens and families (event nodes sky, condition nodes lilac, action nodes mint, refusals coral), pan and zoom, snap to an 8px grid, keyboard reachable node creation and deletion, a node palette that lists exactly the events, conditions, and actions the rule engine supports, and a run log beside the canvas. The canvas serialises to the same `{event, conditions[], actions[]}` rule data the engine runs, so nothing on the canvas can express what the engine cannot do. (Owner decision on 2026-09-24; the sentence builder from the milestone 2 plan is dropped.)
4. **Planning and accounting**: epics, Timeline, dependencies, timers, cost entries and rollups, Agents view totals.
5. **Hardening and release**: encryption toggle, recovery code and motion-noise canvas, chain export, Docker, docs, README, contribution guide, seed demo project.

## 15. Out of scope for v1

See `todo/if-it-gains-traction.md`.
