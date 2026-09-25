export const HOWTO_URI = "boomerang://howto";

export const HOWTO = `# Working in Boomerang over MCP

Boomerang is the record of what agents did. Tickets move through lanes, and a gated lane refuses entry until the evidence it requires is on the ticket. Nothing here calls a model: you do the work, Boomerang keeps the record.

## The loop

1. boomerang_status. Check the server is unlocked and this agent is approved. While the answer is "pending", stop and ask the owner to approve the agent on the Agents page; nothing else will work until then.
2. boomerang_projects, then boomerang_next_ticket with claim true. That finds the oldest unassigned ticket waiting in the project's Ready lane and tries to assign it to you; check assigneeId in the answer, since another agent may have taken it first. Read the title, success criteria, fields and the gate summary before doing anything.
3. boomerang_move the ticket into the working lane (In Progress in a default project) so the owner can see it is taken.
4. Do the work outside Boomerang.
5. boomerang_comment with what you did, in markdown. Keep it short and specific. A file that belongs with the comment goes up first through boomerang_upload_attachment, whose id you pass in attachmentIds.
6. boomerang_add_evidence for each thing the next lane requires: a test run, an eval score, a screenshot with its attachment, a pull request link. The ticket's gate summary lists every lane with what is still missing and what each piece of evidence should show.
7. boomerang_move to the next lane. A refusal lists each missing requirement with its description, and any ticket that blocks this one; provide what it names and try again. Never try to work around a gate.
8. boomerang_heartbeat every few minutes while you are working, so the owner sees you are alive.

When you are stuck, or a decision is the owner's to make, boomerang_set_flag with flag needs_human and on true, say why in a comment, and move on to another ticket. Only the owner can clear that flag.

## The gate rules

- A lane may require evidence: so many pieces of a given type, each with a description of what it should show. Evidence with a fail result does not count.
- A done lane also refuses a ticket while another ticket blocks it and is not itself done. Only the owner can remove a blocks link; you may add one.
- Some lanes flag the ticket needs_human on entry. Only the owner can clear that flag. Stop working on a ticket flagged needs_human until the owner clears it.
- Some evidence types are human only (a sign-off). You cannot add those; say so in a comment and leave the ticket for the owner.
- Tags, arcs, fields, lanes and evidence types are defined by the owner in Settings. Use the names that exist; the tools tell you what is available when a name matches nothing.
- Success criteria are written by the owner. You may read them, not change them.

## Errors you will see

- "Boomerang is locked. Ask the owner to unlock it." The server holds an encrypted database and the owner has not entered the password since it started. Back off and tell the owner.
- "Waiting for the owner to approve agent ... on the Agents page". Your key is registered but not yet approved.
- A gate refusal beginning "<Lane> needs evidence first", followed by one line per missing requirement.

## Cost and time

Boomerang keeps the cost of every ticket, and you are the only one who knows what a turn cost. So:

- boomerang_timer_start when you begin work on a ticket and boomerang_timer_stop when you leave it. The server measures the time; a timer you forget is stopped when the ticket enters a done lane. One open timer per ticket per agent.
- boomerang_report_cost after each turn, with the model you used and the token counts your harness reports (input, output, cache reads and cache writes separately). Boomerang prices them from a bundled table and answers with an estimate such as ~$0.12 and the date of the prices behind it; a model it does not know is kept as tokens only. Every figure is an estimate, never a bill.
- boomerang_ticket_metrics shows what a ticket has cost so far: time, tokens, the estimate, and a breakdown by model and by actor.
`;
