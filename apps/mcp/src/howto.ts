export const HOWTO_URI = "boomerang://howto";

export const HOWTO = `# Working in Boomerang over MCP

Boomerang is the record of what agents did. Tickets move through lanes, and a gated lane refuses entry until the evidence it requires is on the ticket. Nothing here calls a model: you do the work, Boomerang keeps the record.

## The loop

1. boomerang_status. Check the server is unlocked and this agent is approved. While the answer is "pending", stop and ask the owner to approve the agent on the Agents page; nothing else will work until then.
2. boomerang_projects, then boomerang_next_ticket with claim true. That takes the oldest unassigned ticket waiting in the project's Ready lane and assigns it to you. Read the title, success criteria, fields and the gate summary before doing anything.
3. boomerang_move the ticket into the working lane (In Progress in a default project) so the owner can see it is taken.
4. Do the work outside Boomerang.
5. boomerang_comment with what you did, in markdown. Keep it short and specific.
6. boomerang_add_evidence for each thing the next lane requires: a test run, an eval score, a screenshot with its attachment, a pull request link. The ticket's gate summary lists every lane with what is still missing and what each piece of evidence should show.
7. boomerang_move to the next lane. A refusal lists each missing requirement with its description, and any ticket that blocks this one; provide what it names and try again. Never try to work around a gate.
8. boomerang_heartbeat every few minutes while you are working, so the owner sees you are alive.

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

Timer and cost tools (boomerang_start_timer, boomerang_stop_timer, boomerang_report_cost) arrive in a later release. Until then, put token counts in a comment when you finish a ticket.
`;
