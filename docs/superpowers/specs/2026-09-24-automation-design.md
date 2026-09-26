# Milestone 3: Automation

Date: 2026-09-24. Status: approved in outline by the owner (canvas, MCP, timers and cost). Amends `docs/superpowers/specs/2026-09-21-panorama-design.md` sections 8, 9, and 14.

## Purpose

Work moves only by explicit rules. This milestone gives the owner a way to draw those rules, gives agents a first-class way to plug in (MCP), and starts measuring what the work costs.

## Rules

A rule is data: `{ id, projectId, name, enabled, event, conditions[], actions[], canvas }`. `event`, `conditions`, and `actions` are exactly what the engine runs (base spec section 8). `canvas` is the drawing: node positions and edges, which the engine ignores. Saving a rule serialises the canvas into the three fields and refuses to save a drawing the engine cannot run (a disconnected node, two event nodes, an action with a missing target), naming the node.

Events (`RuleEvent` in `packages/core`, exactly this list): `ticket.created`, `ticket.moved` (from and to lanes), `ticket.updated` (a changed key), `ticket.flag_set`, `ticket.flag_cleared`, `evidence.added` (type and result), `comment.added`, `timer.started`, `timer.stopped`, `cost.added`, `ticket.due_passed` (emitted by the scheduler when a due date passes, `{ticketId, dueDate}`), and `schedule` (cron, timezone, and a missed policy `skip`, `run_once` or `run_all`, default `run_once`, applied to runs that fell in downtime or a lock; the scheduler fires it as the chain event `trigger.fired {ruleId, triggerId, projectId, scheduledFor, missed}`). Conditions on board, epic, lane, tag, flag, actor, title, assignee, due date, evidence type and result with a count, field value by kind (`is`, `is_not`, `in`, `contains`, `gte`, `lte`, `exists`, `not_exists`), composed with `all`, `any`, `not` to a depth of 8. Actions (`Action`, exactly this list): `move_to_lane`, `set_flag`, `clear_flag` (never `needs_human`, which only a human clears), `assign`, `add_tag`, `remove_tag`, `set_field`, `set_epic`, `add_comment` (system actor, body a template), `emit_webhook` (destination), `create_ticket` (title template, lane, optional board, epic and tags), `start_timer`, `stop_timer` (the engine actor's timer on the ticket, through the timer routes), `move_to_board`. Templates take `{{ticket.key}}`, `{{ticket.title}}`, `{{lane.name}}` and `{{event.type}}`, with markdown specials in the values backslash-escaped.

Loop guard: depth 8 per causal chain, one fire per rule per ticket per chain; a violation flags `needs_human` and writes to the rule's run log. Gates apply to every action (`move_to_lane` through the same gate as a human drag). Every rule fire is a chain event `rule.fired {ruleId, ticketId, actions, outcome}`. The comment and the flag a refused or failed fire leaves are chain events too, and can start rules like any other; the chain and depth checks bound what follows. Other requests may commit between a route's commit and the engine's run on its events, so every action re-checks its gate at the moment it runs, never from the event's snapshot. Each root event the engine is handed also has a budget of 50 fires and 20 created tickets, shared by the chain it starts and by nothing else, so one exhausted event in a scheduler tick does not silence the others; a guard or budget skip is recorded as a `skipped` run with its reason in the rule's run log (`rule_runs`, read by `GET /rules/:id/runs`) and as a `rule.fired` event with outcome `skipped`, and flags the ticket `needs_human`.

## The Automations canvas

Sidebar item after Board, route `/automations`. Left: the rule list (name, enabled toggle, last fired, fires today). Centre: the canvas for the selected rule, on `@xyflow/react` with custom nodes only:

- **When** node (one per rule): the event, drawn in sky. Its body shows the event's parameters when it has any (for `ticket.moved`, from and to lanes through the Picker).
- **If** node (any number, chained or fanned): a condition, drawn in lilac. Fields chosen through the Picker; values typed or picked.
- **Then** node (any number): an action, drawn in mint. Targets through the Picker.
- **Else** is drawn as a second edge out of an If node, labelled.
- Edges are 2px lines in `--line`, turning to the source node's family when selected; handles are 10px circles.
- A palette on the right lists the nodes that can be added; dragging one onto the canvas or pressing `n` with a node selected adds and connects it. `Delete` removes the selection with an undo (Ctrl or Cmd plus Z, ten steps).
- Snap to an 8px grid, pan with space plus drag or the wheel, zoom 50 to 200 percent, fit on open. Minimap off (nothing on it would be worth the pixels). Every node is keyboard reachable and announces its type and summary.
- A **Test** button runs the rule against a chosen ticket without acting, showing which nodes matched (lilac lit) and which actions would fire (mint lit) and why the rest did not.
- Below the canvas: the run log for the rule (time, ticket, outcome, error), live over the stream.

The canvas uses only tokens: node cards are `--surface` with `--line` borders and a 4px family bar on the left (an exception to the side-tab rule, ruled by the owner's request for coloured node types), 12px radius, the two easing curves, and no shadows except on the dragged node.

How a drawing becomes a rule (`canvasToRule` in `packages/core`): conditions on the path from the When node to a Then node chain as `all`; two paths into the same Then node branch as `any`. The conditions every Then node shares (the common prefix of all paths) become the rule's `conditions`; whatever remains on a Then node's own paths becomes that action's `when`, so one rule holds the branches the canvas draws and the engine applies `when` on top of `conditions`. When every action ends with the same `when` it is lifted into `conditions`, so a rule has one canonical form and the round trip canvas, rule, canvas, rule is stable. `ruleToCanvas` draws a rule left to right on a 240 by 120 grid: the When node, the shared conditions in a row, then one row per action. Validation names the offending node: `no_event`, `two_events`, `cycle`, `unknown_kind:<nodeId>`, `disconnected:<nodeId>` (no path from the When node), `missing_target:<nodeId>` (an action whose Picker value is empty), `invalid:<nodeId>` (data the engine cannot run for any other reason, such as `clear_flag needs_human`), and `bad_edge:<edgeId>`.

## Triggers, outbox, webhooks

As base spec section 9. The trigger editor lives on the canvas as a **Schedule** node that can stand in for the When node: cron through a small builder (every N minutes or hours, daily at, weekly on), timezone, missed policy.

## MCP server

`apps/mcp`, on the official SDK, stdio and streamable HTTP, signing every REST call with the agent's own key stored in the agent's own config file (never in Boomerang's data directory). Tools: `register_agent`, `list_projects`, `list_tickets`, `get_ticket`, `create_ticket`, `move_ticket`, `add_comment`, `attach_evidence`, `add_attachment`, `set_flag`, `set_fields`, `add_tag`, `link_tickets`, `start_timer`, `stop_timer`, `report_cost`, `next_ticket`. A `report-usage` skill ships in `.claude/skills/` telling an agent to call `report_cost` after every turn on a ticket.

## Timers and cost

`timers`: id, ticket, actor, started, stopped. One open timer per actor per ticket; the server measures. `cost_entries`: id, ticket, actor, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost (estimated at write time from the bundled price list, null when the model is unknown), priceDate, note, created. Cache reads and cache writes are counted separately because models.dev prices them separately (a read is a fraction of the input rate, a write above it); a model with no cache price charges both at the input rate. A bundled snapshot of models.dev prices (`packages/core/src/prices.json`, refreshed by `pnpm prices:update`, with its date) is the only price source; Boomerang makes no network calls. Only the server imports the table (`cost.ts`); the browser renders figures through `cost-format.ts`, which never loads it. Rollups per ticket, agent, epic, board, and project over a period. Every estimate renders as `~$9.40` (two significant figures) with the price date and the words "estimate; actual can be lower" on hover; unknown models show tokens only. The Queue header shows time, tokens, and `~$` for this week; agent cards and the ticket panel show their own.
