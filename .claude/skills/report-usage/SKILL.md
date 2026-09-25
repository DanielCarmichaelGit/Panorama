---
name: report-usage
description: Use while working a Boomerang ticket over MCP: when to start and stop the ticket's timer and how to report each turn's model and token usage so the ticket knows what it cost.
---

# Reporting time and cost to Boomerang

Boomerang keeps the time and cost of every ticket, and you are the only one who knows what a turn cost. Boomerang makes no LLM calls and never sees your usage unless you report it. It prices what you report from a bundled models.dev table and shows every figure as an estimate with a tilde and the price date; nothing you send is a bill.

Three MCP tools carry it, all on the Boomerang server: `boomerang_timer_start`, `boomerang_timer_stop`, `boomerang_report_cost`.

## When

- Call `boomerang_timer_start` with the ticket as soon as you begin work on it, before the first turn that touches it. One open timer per ticket per agent: a second start is refused until you stop. The server measures the time; you never send a duration.
- Call `boomerang_report_cost` after every turn you spend on the ticket, including the turn that only reads. Report each turn on its own rather than a total at the end, so a ticket you leave half way still carries what it cost.
- Call `boomerang_timer_stop` when you leave the ticket: done, blocked, handing over, or moving to another ticket. A timer you forget stops on its own when the ticket enters a done lane, but do not rely on that.
- If you work two tickets in turn, stop the first timer before starting the second, and report each turn against the ticket it served.

## What to send

`boomerang_report_cost` takes the ticket, the model, and the token counts from the usage block your harness returns for the turn:

- `model`: the id as the API names it, for example `claude-fable-5-1`, not a display name or an alias. Boomerang matches it against the price table by that id; a name it does not know is kept as tokens only, with no figure.
- `inputTokens` and `outputTokens`: the plain input and output counts.
- `cacheReadTokens` and `cacheWriteTokens`: cache reads and cache writes as their own counts, never folded into the input. models.dev prices them differently (a read below the input rate, a write above it), so folding them in would misprice the turn. Send zero when the harness reports none.
- `note` (optional): one short line on what the turn did, for example `read the failing test`.

Send exactly what the usage block says. Do not round, do not sum across turns, do not estimate tokens you were not given.

## Example

A turn on ticket PAN-12 whose usage block reads input 1,240, output 388, cache read 9,800, cache write 0, on `claude-fable-5-1`:

```json
{
  "ticketId": "PAN-12",
  "model": "claude-fable-5-1",
  "inputTokens": 1240,
  "outputTokens": 388,
  "cacheReadTokens": 9800,
  "cacheWriteTokens": 0,
  "note": "read the failing test"
}
```

Boomerang answers with the entry, an `estimate` such as `~$0.12`, and the `priceDate` behind it, or says the model has no price and that the tokens were recorded without a figure. Either way the report succeeded; carry on.

A full session on one ticket, in order:

1. `boomerang_timer_start` with `ticketId: "PAN-12"`.
2. Work a turn, then `boomerang_report_cost` with that turn's usage as above.
3. Repeat step 2 for every turn.
4. `boomerang_timer_stop` with `ticketId: "PAN-12"` when you leave it.

## What not to do

- Do not report a turn twice. If the call failed with a network error and you cannot tell whether it landed, ask `boomerang_ticket_metrics` for the ticket before sending it again.
- Do not report usage for turns spent on something other than the ticket.
- Do not send a dollar figure. Boomerang prices the tokens itself so every ticket is priced the same way.
