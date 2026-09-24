# Milestone 3: Automation

Date: 2026-09-24. Status: approved in outline by the owner (canvas, MCP, timers and cost). Amends `docs/superpowers/specs/2026-09-21-panorama-design.md` sections 8, 9, and 14.

## Purpose

Work moves only by explicit rules. This milestone gives the owner a way to draw those rules, gives agents a first-class way to plug in (MCP), and starts measuring what the work costs.

## Rules

A rule is data: `{ id, projectId, name, enabled, event, conditions[], actions[], canvas }`. `event`, `conditions`, and `actions` are exactly what the engine runs (base spec section 8). `canvas` is the drawing: node positions and edges, which the engine ignores. Saving a rule serialises the canvas into the three fields and refuses to save a drawing the engine cannot run (a disconnected node, two event nodes, an action with a missing target), naming the node.

Events: `ticket.created`, `ticket.moved`, `ticket.flag_set`, `ticket.flag_cleared`, `evidence.added`, `comment.added`, `timer.started`, `timer.stopped`, `cost.added`, `trigger.fired`, `ticket.due_passed`. Conditions on board, epic, lane, tag, flag, actor, evidence type and result, field value (`is`, `is_not`, `in`, `gte`, `lte`, `exists`). Actions: `move_to_lane`, `set_flag`, `clear_flag` (never `needs_human` set by the human), `assign`, `add_tag`, `remove_tag`, `set_field`, `add_comment` (system actor), `emit_webhook`, `create_ticket` (from a template), `start_timer`, `stop_timer`, `move_to_board`.

Loop guard: depth 8 per causal chain, one fire per rule per ticket per chain; a violation flags `needs_human` and writes to the rule's run log. Gates apply to every action (`move_to_lane` through the same gate as a human drag). Every rule fire is a chain event `rule.fired {ruleId, ticketId, actions, outcome}`.

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

## Triggers, outbox, webhooks

As base spec section 9. The trigger editor lives on the canvas as a **Schedule** node that can stand in for the When node: cron through a small builder (every N minutes or hours, daily at, weekly on), timezone, missed policy.

## MCP server

`apps/mcp`, on the official SDK, stdio and streamable HTTP, signing every REST call with the agent's own key stored in the agent's own config file (never in Panorama's data directory). Tools: `register_agent`, `list_projects`, `list_tickets`, `get_ticket`, `create_ticket`, `move_ticket`, `add_comment`, `attach_evidence`, `add_attachment`, `set_flag`, `set_fields`, `add_tag`, `link_tickets`, `start_timer`, `stop_timer`, `report_cost`, `next_ticket`. A `report-usage` skill ships in `.claude/skills/` telling an agent to call `report_cost` after every turn on a ticket.

## Timers and cost

`timers`: id, ticket, actor, started, stopped. One open timer per actor per ticket; the server measures. `cost_entries`: id, ticket, actor, model, inputTokens, outputTokens, cachedTokens, cost (estimated at write time from the bundled price list, null when the model is unknown), note, created. A bundled snapshot of models.dev prices (`packages/core/src/prices.json`, refreshed by `pnpm prices:update`, with its date) is the only price source; Panorama makes no network calls. Rollups per ticket, agent, epic, board, and project over a period. Every estimate renders as `~$9.40` (two significant figures) with the price date and the words "estimate; actual can be lower" on hover; unknown models show tokens only. The Queue header shows time, tokens, and `~$` for this week; agent cards and the ticket panel show their own.
