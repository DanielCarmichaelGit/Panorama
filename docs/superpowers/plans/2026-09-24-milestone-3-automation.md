# Milestone 3: Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner draws rules on a canvas and they run; agents plug in over MCP; every ticket knows what it cost.

**Architecture:** `packages/core` holds the rule schema, the canvas-to-rule serialiser and validator, the evaluator (pure), the loop guard, and the price table. `packages/db` adds rules, triggers, destinations, outbox, timers, cost entries, run logs. `apps/server` runs the engine after each committed transaction (same place events are published), the scheduler, and the outbox worker. `apps/mcp` is a thin signed client. `apps/web` adds the Automations view on `@xyflow/react` and the metrics surfaces.

**Tech Stack:** As before plus `@xyflow/react` (MIT), `croner` (MIT), `@modelcontextprotocol/sdk` (MIT). Branch `m3-automation` from `main` after milestone 2b merges.

**Spec:** `docs/superpowers/specs/2026-09-24-automation-design.md` and base spec sections 8 and 9.

## Global Constraints

Same as milestone 2b, plus: the engine never acts outside a gate; rule fires are chain events; no rule can express what the engine cannot run; the canvas is keyboard operable; prices are bundled, never fetched; every cost figure is marked as an estimate.

## Tasks

1. **Core: rule schema, evaluator, loop guard, canvas serialiser.** `Rule`, `RuleEvent`, `Condition`, `Action`, `CanvasDoc` (nodes, edges, positions) types and zod; `evaluateRule(rule, event, ctx) -> Action[]`; `canvasToRule(doc)` with named validation errors (`disconnected:<nodeId>`, `two_events`, `missing_target:<nodeId>`); `ruleToCanvas(rule)` for legacy or API-created rules (auto layout left to right); loop guard state. Tests on every condition operator and every validation error.
2. **Core: prices and cost estimate.** `prices.json` snapshot with date and a `scripts/prices-update.mjs` that rewrites it from models.dev when run by hand; `estimateCost({model, inputTokens, outputTokens, cachedTokens}) -> { usd: number | null, priceDate }`; `formatEstimate(usd)` giving `~$9.40` at two significant figures. Tests.
3. **DB: migration M7** (rules with canvas JSON, triggers, destinations, outbox, timers, cost_entries, rule_runs) and repositories, including rollup queries (by ticket, agent, epic, board, project, period). Tests.
4. **Server: engine.** After every committed transaction the recorded events are handed to `runRules(ctx, events)` which evaluates enabled rules for the project, applies actions through the same code paths as the routes (gate included), records `rule.fired` chain events and run-log rows, and enforces the loop guard. Routes: rules CRUD (human, canvas validated server-side too), `POST /rules/:id/test {ticketId}` (dry run returning matched nodes), `GET /rules/:id/runs`. Tests: the owner's pipeline (Done of build work to Eval to Ready for Production on eval pass, back with a flag on the second fail), loop guard, gate refusal writes a system comment.
5. **Server: triggers, outbox, webhooks.** Scheduler on croner with missed-run policies at start and unlock; outbox worker with backoff and HMAC signing; destinations CRUD (human). Tests with a fake destination and a controllable clock.
6. **Server: timers and cost.** Routes `POST /tickets/:id/timer/start|stop` (agents own their timers), `POST /tickets/:id/cost`, `GET /metrics?projectId&period=week` (rollups); events `timer.started`, `timer.stopped`, `cost.added`. Tests.
7. **MCP server.** `apps/mcp` with the tool list from the spec, key generation and storage in the agent's config path, signed calls, locked and gate errors surfaced as tool errors with the missing evidence named; `scripts/demo-agent.ts` rewritten to use it; contract tests against a running server on a test port.
8. **Web: Automations view, canvas.** Sidebar item after Board (`Lightning` icon), `g m`; rule list; canvas with the four node kinds, palette, edges, undo, grid, zoom, keyboard; Picker for every choice inside nodes; save with server validation errors highlighted on the offending node; Test mode lighting nodes; run log live. Tests for the serialiser round trip through the canvas store and keyboard node creation.
9. **Web: Schedule node and destinations.** Schedule node with the cron builder; Settings gains a Destinations tab (webhook URL, secret shown once).
10. **Web: metrics surfaces.** Queue header figures (time, tokens, `~$` this week), agent card totals, ticket panel cost block with a per-model breakdown, epic totals on the Board filter chip; the `report-usage` skill in `.claude/skills/`.
11. **Demo agent, e2e, README.** Demo agent reports cost and starts a timer; e2e draws the owner's pipeline rule on the canvas by keyboard, runs the demo agent, and asserts the ticket ends in Ready for Production flagged, with a `~$` figure on the Queue header; README section on automations, MCP, and cost.

## Acceptance
1. The owner's pipeline runs end to end from a rule drawn on the canvas, with every step in the chain log.
2. A rule cannot be saved that the engine cannot run, and no action bypasses a gate.
3. An agent using only MCP can register, take the next ticket, comment, attach evidence, report cost, and move within the rules.
4. Cost figures never appear without `~` and a price date.
