# Panorama: BRIEF.md

UI build brief. The system design (data model, API, rule engine, security) lives in `docs/superpowers/specs/2026-09-21-panorama-design.md`. The visual system lives in `BRAND.md` and is locked.

## Project

Panorama is a free, open source, self-hosted project manager that any AI agent plugs into. Work moves only by explicit rules, and a ticket cannot close without evidence. Panorama ships no agents and makes no LLM calls.

- **User:** one developer supervising several AI agents on their own machine.
- **The one action:** open Panorama, see what needs a human, clear it.
- **Register:** technical, in the crisp pastel isometric sense of the chosen reference. Calm and precise, never cute.
- **License:** MIT. No paid dependencies, no telemetry, no network calls except webhooks the user configures.

## Stack

TypeScript monorepo. React with Vite for the web app, Fastify backend, SQLite through a SQLCipher-compatible driver, MCP server on the official SDK. Runs with one command or Docker. Fonts and icons bundled locally.

## Views

1. **Queue (home).** The state of the system first: a presence strip of connected agents (who is on what, who is idle, who is waiting for approval) under a header that reads as a mono count and the words "need you". Then tickets flagged Needs Human, newest first, then a collapsed section of what agents are doing now. With no agents connected the home says so and offers to connect one; creating a ticket is secondary. Each row: state mark, ID, title, epic chip, agent, timer, tokens, state chip. (Amended by the owner on 2026-09-24: agents, not tickets, are the fundamental thing on first login.)
2. **Board.** Kanban by lane. Drag to move. A lane with unmet evidence requirements refuses the drop and says what is missing. Lanes that set Needs Human on entry show it in their header.
3. **Timeline.** Gantt. Bars by ticket, grouped by epic, dependencies drawn as links, drag to move and resize, today line.
4. **Epics.** Epic list with progress, total time, total tokens and cost, and an isometric cover.
5. **Automations.** Rule list and the builder. A rule reads as a sentence: When [event], if [conditions], then [actions]. Built from dropdown tokens in a sentence, not a node canvas. Includes schedules (triggers) and their missed-run policy, and a run log per rule.
6. **Agents.** Pending approvals first, then one card per agent: an isometric mark in its own colour family, status (on a ticket, idle, waiting), last seen, scopes, and later totals. Approve and revoke are human-signed.
7. **Settings.** Encryption toggle, password change, recovery code, webhook destinations, evidence types, lanes, chain verification and export.
8. **Ticket panel.** Title, lane, flags, epic, dates, dependencies, timers, cost metadata, evidence checklist for the next lane, and the comment thread.
9. **Lock screen and first run.** Password creation, recovery code shown on the motion-noise canvas, unlock.

## The comment thread

Append-only. Comments are never edited or deleted; a correction is a new comment. Each shows author (human or agent name), time, and a signed mark.

The composer has no formatting toolbar. Markdown shorthand converts as you type: `#` heading, `-` list, `[]` checkbox, `>` quote, `---` rule, backticks for code, `**bold**`. Drag, drop, or paste files and images anywhere in the composer. Stored as markdown. HTML blocks and `.html` attachments render sanitised inside a sandboxed frame with scripts disabled.

Evidence attaches to a comment or directly to the ticket: typed artifacts (test run, PR link, eval score, screenshot, custom) render as chips with pass or fail, free-form files render as attachments.

## States every view must have

Empty (isometric scene plus one sentence and the primary action), loading (skeleton rows, never a spinner over a blank page), error (what failed and a retry), locked (API answers locked; the app shows the lock screen), and ragged content (long titles truncate with a tooltip, 0 and 500 tickets both work).

## Copy rules

Plain verbs, sentence case. Name things by the vocabulary: Project, Epic, Ticket, Lane, Flag, Evidence, Rule, Trigger, Agent. No em dashes and no en dashes anywhere, including generated strings, alt text, commit messages. No SaaS filler words. Nothing on screen explains why the design is the way it is.

## Quality floor

- Works at 375px. Keyboard reachable everywhere, tab order matches visual order, skip link, one `h1` per view, landmarks.
- WCAG AA contrast using the locked tokens. `prefers-reduced-motion` respected.
- Keyboard: `g q` Queue, `g b` Board, `g t` Timeline, `c` new ticket, `/` search, `j` `k` move, `Enter` open, `Esc` close, `?` shortcut list. Drag actions have keyboard equivalents.
- Queue renders in under 1 second with 5,000 tickets in the database. Board virtualises long lanes.
- Live updates over server-sent events. No polling.

## Non-negotiables

- The locked tokens and fonts ship as CSS custom properties. No framework palette names in the source.
- A gated lane can never be entered without its evidence, from any surface: drag, keyboard, API, MCP, or rule.
- Human-only actions always prompt for the signature when the session key is not in memory.
- Comments and the event log are append-only in the UI and the API.
- Isometric art only through the shared helper, only in the places `BRAND.md` lists.

## Every control works

Every button, link, tab, toggle, and input does what it looks like it does. If a feature is not built yet, its control is absent. No `href="#"`, no dead tabs, no status dot without live state behind it.

## Every element justifies itself

Anything added must answer what it does for the user. No decorative pills, eyebrow labels, numbered markers, or cards around things that need no box. If a view looks bare, make it shorter.

## Non-goals for v1

Multi-user and roles, cloud hosting, billing, telemetry, built-in LLM calls, mobile app, real-time co-editing, invoicing, plugin marketplace, dark theme, node-canvas automation editor. See `todo/if-it-gains-traction.md`.

## How to work

Product grade from the first pass. One concern per iteration, a commit per working step, feature branches. When handing back a view, show its hover and focus states, the view at 375px, its empty and error states, and every control clicked. Do not refactor what was not asked. Do not substitute tokens or fonts.
