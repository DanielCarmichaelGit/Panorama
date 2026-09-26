# Boomerang

A free, MIT licensed, self-hosted project manager for one developer supervising several AI agents. Agents connect from outside through REST or MCP. Work moves only by deterministic rules. A ticket enters a gated lane only with the evidence that lane requires. Boomerang contains no agents and makes no LLM calls.

## Requirements

- Node 20 or newer
- pnpm 9

## Install and start

```
pnpm install
pnpm start
```

`pnpm start` builds the web app and serves it together with the API on one port. It binds to `127.0.0.1:4400` by default. Set `PORT` to use a different port.

Open `http://127.0.0.1:4400` and set a password on first run.

## Data and encryption

Boomerang stores its SQLite database and file attachments in `BOOMERANG_DATA_DIR`, or `~/.boomerang/` if that variable is not set.

Boomerang was called Panorama until 2026-09-25; the `PANORAMA_*` environment variables are still read for one release and logged as deprecated, an existing `~/.panorama` is moved to `~/.boomerang` on first start, and the database file inside it keeps its `panorama.db` name.

At setup you choose whether to encrypt the database. With encryption on, the browser derives an Ed25519 signing seed and a database key from your password with Argon2id and a stored salt. Only the public key and salt are kept on disk; the password and seed are never written anywhere, and the private key lives only in browser memory for the session. Restarting the server leaves Boomerang locked: every API call other than `/api/v1/health`, `/api/v1/status`, `/api/v1/setup`, and `/api/v1/unlock` answers `423 Locked` until you enter the password again. With encryption off, there is no lock step and the database is stored in plaintext.

## Tamper evidence

Every state change is appended to a hash chained event log, signed by the actor who made it, in the same transaction as the change itself. When you unlock, the server verifies every entry from the beginning of the log and then checks that the log still contains the point you last signed, with the same hash. Your browser signs the new head as the text `<seq>:<headHash>`, and keeps that pair in `localStorage` under `bm.anchor` so that the next unlock can cross check the server's answer against what this browser last saw. A failure shows a banner naming the first bad entry and what went wrong. The password and the signing seed are never stored anywhere.

What this detects:

- an entry edited in place
- an entry removed from the middle of the log
- entries removed from the end of the log after you signed a checkpoint
- a log rewritten from scratch with recomputed hashes after you signed a checkpoint
- a checkpoint carrying a signature that is not yours
- a removed or rolled back `checkpoints` table, as long as you unlock in the browser profile that signed the last checkpoint

What it does not detect:

- a change made after your last checkpoint and removed again before your next unlock, which leaves no trace
- a rollback of the database, the checkpoints, and the browser profile together to one older consistent snapshot
- anything done by someone who knows your password, because they can sign checkpoints too

This is tamper evident, not tamper proof. It exists for the case where an agent with access to the file edits SQLite directly.

## Agents

An agent registers itself with a name and an Ed25519 public key it generates:

```
POST /api/v1/agents/register {"name":"my-agent","publicKey":"<ed25519 public key hex>"}
```

The agent starts in a `pending` state and can do nothing until a human approves it in the Agents view and sets its scopes.

Every request an agent makes must be signed. The signed headers are:

- `x-pan-actor`: the agent's id
- `x-pan-ts`: the request timestamp
- `x-pan-nonce`: a random nonce
- `x-pan-sig`: an Ed25519 signature over the request

The signed message is:

```
METHOD
path
sha256(body)
timestamp
nonce
```

`sha256(body)` is the hash of the exact bytes sent as the request body. A `GET` request and every multipart upload (see Attachments below) carry no JSON body, so they are signed the same way: over the hash of the empty string, not over the multipart form. For an attachment upload, the `ticketId` field must be the first field in the form, before the file: the server reads it off the stream before it starts buffering the file's bytes, so a `ticketId` sent after the file is never seen.

`scripts/demo-agent.ts` is a full working example over MCP. It runs the MCP server from `apps/mcp` inside its own process and drives it through an MCP client, so every step is a tool call an agent such as Claude Code would make, except two signed REST calls the script makes on purpose: setting a token count in the ticket metadata, which no tool offers, and deleting a blocks link to show that an agent is refused. It generates a key, registers, waits for approval, asks for the next ticket waiting in Ready, creates a ticket of its own and moves it into In Progress. It then applies the project's `demo` tag if a human has made one in Settings (tags are human-defined, so it says so and carries on when there is none), creates a second ticket that blocks the first, tries to move the first into Done and prints the refusal, which names the blocker, and shows that an agent cannot remove that link. After that it tries to move the ticket straight to Ready for Production, which the server refuses because the lane requires an eval score; the script prints that refusal too, with each missing requirement's description when the lane carries one. Then the turn that does the work: it starts its timer on the ticket, posts a comment, attaches a test run and an eval score as evidence, reports the turn's cost (a few thousand tokens on `claude-sonnet-5`) and prints the `~$` estimate with its price date, and stops the timer. Finally it moves the ticket into Eval; an owner's rule may take it on from there (see Automations below), and when none does the agent moves it into Ready for Production itself, this time successfully. Run it with:

```
pnpm demo:agent
```

`BOOMERANG_URL` points it at a server, `AGENT_NAME` names the key it registers (default `demo-agent`), and `BOOMERANG_MCP_KEY_FILE` says where the key is kept; with no key file named, a fresh key goes to a temporary directory, so every run registers anew.

## Connect Claude Code over MCP

`apps/mcp` is an MCP server (stdio, on the official SDK) that gives an agent such as Claude Code the same footing as the demo agent: its own Ed25519 key, registration, and signed calls, behind a set of tools. Build it once, then register it with Claude Code from this repository:

```
pnpm --filter @boomerang/mcp build
claude mcp add boomerang -- node "$(pwd)/apps/mcp/dist/main.js"
```

`pnpm --filter @boomerang/mcp start` runs the same server from source through tsx, and `claude mcp add boomerang -- pnpm --dir "$(pwd)" --filter @boomerang/mcp start` registers it that way instead. Either form works from any project once Claude Code can find the path. Claude Code records that absolute path, so the repository and its `node_modules` must stay where they are, and after pulling changes run the build again so `dist/main.js` matches the server.

On its first start the server generates a key for the agent, stores it in `~/.boomerang-mcp/<name>.json` with owner-only permissions (the file holds only that seed and the id the server assigns, never your password), and registers the agent as `pending`. Then the approval step: open the Agents view, approve the new agent and set its scopes. Until you do, every tool answers "Waiting for the owner to approve agent <name> on the Agents page"; `boomerang_status` shows the scopes the agent asked for. While Boomerang is locked the tools answer "Boomerang is locked. Ask the owner to unlock it."

The environment sets where it connects and who it is:

- `BOOMERANG_URL`: the server, default `http://127.0.0.1:4400`.
- `BOOMERANG_AGENT_NAME`: the name shown on the Agents page, default the hostname plus `claude`.
- `BOOMERANG_MCP_KEY_FILE`: the key file, default `~/.boomerang-mcp/<name>.json`.
- `BOOMERANG_PROJECTS`: a comma separated list of project ids to ask scope for; default every project.

Pass them with `-e`, as in `claude mcp add boomerang -e BOOMERANG_AGENT_NAME=reviewer -- node "$(pwd)/apps/mcp/dist/main.js"`.

The tools are `boomerang_status`, `boomerang_projects`, `boomerang_lanes`, `boomerang_evidence_types`, `boomerang_next_ticket`, `boomerang_ticket`, `boomerang_search_tickets`, `boomerang_create_ticket`, `boomerang_update_ticket`, `boomerang_set_flag`, `boomerang_comment`, `boomerang_upload_attachment`, `boomerang_add_evidence`, `boomerang_move`, `boomerang_link`, `boomerang_heartbeat`, `boomerang_timer_start`, `boomerang_timer_stop`, `boomerang_report_cost`, and `boomerang_ticket_metrics`. Lanes, arcs, tags and evidence types may be named by id or by name, and a ticket by id or key. A gated move that the server refuses comes back as a tool error that lists each missing requirement with its description and any ticket that blocks this one, so the agent knows what to provide next. The timer tools start and stop the agent's own timer on a ticket (the server measures the time), `boomerang_report_cost` records a turn's model and token counts and answers with the `~$` estimate and its price date, and `boomerang_ticket_metrics` says what a ticket has cost so far; see Time and cost below. The resource `boomerang://howto` explains the loop (status, next ticket, do the work, comment, evidence, move, heartbeat, timer and cost) and the gate rules; point the agent at it first.

## Comments and threads

Every ticket has a thread: comments, evidence, and attachments, ordered by when they happened. A comment is written as markdown in the ticket panel's composer, which supports the usual shorthand (`#`/`##`/`###` headings, `-` and `1.` lists, `>` quotes, `---` rules, backtick code, and `**bold**`) as you type, plus dropping or pasting an image or file straight into the editor, which uploads it and inserts an `attachment:id` reference at the cursor. Ctrl/Cmd+Enter posts the comment.

```
POST /api/v1/comments {"ticketId":"...","body":"...","attachmentIds":["..."]}
```

A comment's body is stored verbatim: there is no server side sanitisation, because a lossy rewrite would mangle plain markdown punctuation and an escaping one can be undone by the very engine that later decodes it. Rendering is where untrusted markup is made safe. The web client parses the body with `marked` and sanitises the result with DOMPurify before it ever reaches the DOM; a raw HTML block or a fenced ```` ```html ```` block is sanitised the same way and then rendered inside a sandboxed iframe with its own restrictive Content-Security-Policy, isolated from the rest of the page. Attachments are never served with a `text/html` content type, so an uploaded `.html` file cannot execute as a page of its own; it only ever renders inside that same sandboxed frame.

## Evidence and gates

An evidence type describes one kind of proof (a test run, an eval score, a linked pull request, a screenshot, a file, a human sign-off, or a free form custom result) and how it is scored pass, fail, or info. A lane can require a count of one or more evidence types before a ticket may enter it, and each requirement can carry a description of what the evidence should show ("A signed note from the designer"). The ticket panel and the Board both show the lanes a ticket cannot yet enter, and why; the panel's checklist for the next lane prints each requirement's description under its name.

```
POST /api/v1/evidence {"ticketId":"...","typeId":"et_eval_score","payload":{"score":0.94}}
```

Moving a ticket into a lane it does not yet qualify for is refused with `422`:

```json
{"error":{"code":"gate","message":"Ready for Production needs evidence first","details":{"laneId":"...","missing":[{"typeId":"et_eval_score","name":"Eval score","need":1,"have":0,"description":"A run of the eval suite at or above the threshold"}]}}}
```

Each entry in `details.missing` is one unmet requirement: the type, its name, how many are needed and how many the ticket already has, and the requirement's `description` when the lane's owner wrote one, so an agent refused at a lane knows what to provide next. The same list, keyed by lane, comes back from `GET /api/v1/tickets/:id/gates` for every lane of the project.

This refusal is enforced on the server, so it holds no matter how the move is attempted: a signed REST call from an agent, a drag on the Board, or the lane select in the ticket panel's keyboard shortcut. Some evidence types are human only, most notably a sign-off: an agent that tries to attach one gets `403`, even with every other scope granted.

## The ticket model

A ticket carries a title, a lane, a board, and the properties below. Every one of them is set from the create dialog (New ticket on the Queue or the Board, Ctrl or Cmd plus Enter to create) and edited in place from the ticket panel; agents set the same properties through the API with their `ticket.update` scope, except success criteria, which stay human-only.

- **Arcs (epics in the API)** group tickets. A ticket belongs to at most one arc. Arcs have a name, a description, and a colour, and the Board filters by arc through `?epic=<id>`.
- **Tags** classify tickets. A tag has a name, unique per project ignoring case, and a colour; a ticket carries any number of them. Tags are defined in Settings or created inline from the Tags picker, and the Board filters by one or more tags through `?tag=<id>`. Flags (`needs_human`, `blocked`) stay separate: they describe state, tags describe what a ticket is about.
- **Dependencies** are links between two tickets of the same project. `A blocks B` means B cannot enter a lane marked done while A is not in one, and `relates` is informational. The blocked-by gate reports itself the same way a missing-evidence gate does: the `422` names the blocker (`Blocked by KEY`) in `details.missing`, the panel's checklist lists it, and the panel's Lane picker and the Board's drop targets refuse Done with the same words. Removing the link lifts the gate. Links refuse a self-link, a duplicate, and a cycle.
- **Custom fields** are defined per project in Settings: text, number, date, select (with its own options), checkbox, or file, in a configured order, each optionally required. A file field holds one of the ticket's own attachments as `{"attachmentId":"..."}`; the server refuses an attachment that belongs to another ticket, and `GET /api/v1/attachments/:id/meta` gives the panel what it needs to show it (the filename, the mime type, the size, and whether it is an image it can preview). A required field is enforced when a human creates a ticket (the dialog's Create button stays disabled and names what is missing) and on every `PATCH` for everyone; an agent may create a ticket without it, and the panel then shows a "Needs fields" chip until someone fills it in. Values travel as `fields: {key: value}`; `null` clears one.
- **Success criteria** are markdown at the top of the panel. Task-list items (`- [ ]`) render as checkboxes only a human can tick, and ticking one writes the updated markdown back as a signed `ticket.updated`.

The routes:

```
GET    /api/v1/epics?projectId=            list epics
POST   /api/v1/epics                       {"projectId","name","description?","family?","color?"}
PATCH  /api/v1/epics/:id                   {"name?","description?","family?","color?","position?","archived?"}
GET    /api/v1/tags?projectId=             list tags
POST   /api/v1/tags                        {"projectId","name","family?","color?"}
PATCH  /api/v1/tags/:id                    {"name?","family?","color?"}
POST   /api/v1/tags/:id/archive
GET    /api/v1/tickets/:id/links           {"links":[...],"tickets":[...]} for the linked tickets
POST   /api/v1/tickets/:id/links           {"toId","kind":"blocks"|"relates"}, :id is the blocking side
DELETE /api/v1/tickets/:id/links/:linkId
GET    /api/v1/fields?projectId=           list field definitions
POST   /api/v1/fields                      {"projectId","name","key","kind","required?","options?"}
PATCH  /api/v1/fields/:id                  {"name?","required?","options?","position?"}
POST   /api/v1/fields/:id/archive
GET    /api/v1/projects/:id/lanes          list lanes in position order, each with its evidence requirements
POST   /api/v1/projects/:id/lanes          {"name","family?","setsNeedsHuman?","isDone?"}, placed before the first done lane
PATCH  /api/v1/lanes/:id                   {"family?","setsNeedsHuman?","isDone?"}, never the name
PUT    /api/v1/projects/:id/lanes/order    {"ids":[...]}, the full ordered list of the project's lane ids
DELETE /api/v1/lanes/:id                   refused with 409 while the lane holds tickets or is the only done lane
PUT    /api/v1/lanes/:id/requirements      {"requirements":[{"typeId","count","description?"}]}
GET    /api/v1/evidence-types              list evidence types (global, shared by every project)
POST   /api/v1/evidence-types              {"name","kind","params?","humanOnly?","needsAttachment?"}
DELETE /api/v1/evidence-types/:id          refused with 409 while a lane requires it or evidence of it is recorded
GET    /api/v1/tickets/:id/gates           {laneId: [missing requirements]} for every lane of the project
GET    /api/v1/attachments/:id/meta        {"id","ticketId","filename","mime","size","isImage"}
GET    /api/v1/rules?projectId=            list rules, each with its run count and last fire
POST   /api/v1/rules                       {"projectId","name","enabled?","canvas"}, the canvas compiled and refused with 400 canvas_invalid when it cannot run
PATCH  /api/v1/rules/:id                   {"name?","enabled?","canvas?"}
DELETE /api/v1/rules/:id
POST   /api/v1/rules/:id/test              {"ticketId"}, a dry run: matched nodes, the actions that would run, what a gate would refuse; writes nothing
GET    /api/v1/rules/:id/runs              the run log, newest first, ?limit= and ?before=
GET    /api/v1/destinations?projectId=     list webhook destinations, never their secrets
POST   /api/v1/destinations                {"projectId","name","url"}, answers with the secret once
PATCH  /api/v1/destinations/:id            {"name?","url?","archived?"}
POST   /api/v1/destinations/:id/rotate     a new secret, shown once
POST   /api/v1/destinations/:id/test       queues a test delivery through the outbox
POST   /api/v1/tickets/:id/timer/start     opens the caller's timer on the ticket; one open timer per actor per ticket
POST   /api/v1/tickets/:id/timer/stop      closes it and answers with the seconds it ran
POST   /api/v1/tickets/:id/cost            {"model","inputTokens","outputTokens","cacheReadTokens?","cacheWriteTokens?","note?"}, priced at write time
GET    /api/v1/tickets/:id/metrics         time, tokens and the estimate for one ticket, by model and by actor, with the open timers
GET    /api/v1/metrics?projectId=          the same for a project, ?period=week|month|all and ?groupBy=project|agent|epic|board
```

Rules and destinations are edited by humans only (`rule.edit`, `destination.edit`); a rule's dry run and run log are readable by anyone with `read` on the project. Timers and cost reports need `timer.use` and `cost.report`, which an agent asks for at registration. Schedules have no route of their own: a rule whose start is a Schedule node carries its cron, timezone and missed policy, and saving the rule reconciles the scheduler at once.

`POST /api/v1/tickets` accepts `epicId`, `tagIds`, `successCriteria`, and `fields` alongside the title, and `PATCH /api/v1/tickets/:id` accepts the same. Arcs, tags, fields, lanes, and evidence types are edited by humans only (`epic.edit`, `tag.edit`, `field.edit`, `lane.edit`, `evidence.edit`); agents read them and apply them to tickets. A `color` is `#rrggbb` in any case and is stored lower-case; `null` on a PATCH clears it so the family shows again.

The event log records `epic.created`, `epic.updated`, `tag.created`, `tag.updated`, `tag.archived`, `ticket.linked`, `ticket.unlinked`, `field.created`, `field.updated`, `field.archived`, `lane.created`, `lane.updated`, `lane.reordered`, `lane.deleted`, `lane.requirements_set`, `evidence_type.created`, and `evidence_type.deleted`. Milestone 3 adds `rule.created`, `rule.updated`, `rule.deleted`, and `rule.fired` (the rule, the ticket, the run id, the outcome, and what it did or why it did not), `trigger.fired` when a schedule comes due, `ticket.due_passed` when a due date has passed, `destination.created`, `destination.updated`, `destination.rotated`, and `destination.test`, `webhook.failed` when a delivery has used up its retries, `timer.started`, `timer.stopped`, and `cost.added`. Every event the engine appends carries `causedBy`, the rule, run and event that led to it, so a move made by a rule reads differently from one made by a hand. Every `*.updated` event carries `changed`, the list of fields whose value actually changed, not the keys the client happened to send: a form that saves name, family, and colour on every click reports one change when only the colour moved, and an empty `changed` when nothing did. Rules match on that list.

## Settings

Settings is a sidebar item for the human (`g s` from anywhere). Every save there is signed and logged like any other change. Each tab is one list: rows show what a thing is and its facts as small chips, and a row expands in place into a compact form when you edit it. Adding opens the same form at the top of the list.

### Concepts

Six things fit together, and the strip at the top of Settings says how. Lanes are the stages a ticket moves through, like Backlog, In progress, and Done; a ticket is always in exactly one lane. Evidence types are the kinds of proof an agent can attach to a ticket: a test run, a pull request, a screenshot, a file, an eval score, a human sign-off. A lane can require some of them before a ticket may enter it; that is the gate. Arcs are bodies of work that a group of tickets carries forward, what other tools call an epic; one arc per ticket. Tags are quick labels for finding and filtering tickets, as many per ticket as you like. Fields are extra properties every ticket in the project carries, such as a customer name or a priority, and a field can be required when a ticket is created. Destinations are where a rule can send a signed webhook when it says notify.

### The tabs

- **Fields**: add a custom field (name, key, kind, required, and options for a select), edit one, reorder them, and archive one. The kinds are text, number, date, select, checkbox, and file. Archiving keeps the values already stored on tickets but drops the field from forms and lists.
- **Tags**: add a tag with a colour, edit its name and colour, and archive one.
- **Arcs (epics in the API)**: add an arc with a description and a colour, edit it, and archive it. Every route, event, and payload keeps the word `epic`, so nothing an agent already does changes.
- **Lanes**: the project's lanes in position order. Add a lane (it lands just before the first done lane), move one up or down, set whether it flags a ticket for a human on entry and whether it counts as done, and edit its evidence requirements as rows of evidence type, count, and a description of what the evidence should show. Names are fixed once created: agents match on them and the event history records them. Delete is refused, with the reason shown on the button, while the lane holds tickets ("Move its 3 tickets first"), when it is the project's only lane, or when it is the only done lane. A project always keeps one done lane, so clearing the done flag on the last one is refused too.
- **Evidence types**: the built-in types and your own, shared by every project. Add one with a name, a kind (one of the seven built-in kinds), a threshold for an eval score, and whether it is human only or needs an attachment. Delete is refused, with the reason shown on the button, while any lane requires the type or any evidence of it is recorded; the server's message names the lanes. There is no editing of an existing type, since its name and kind are what evidence rows were recorded against.
- **Destinations**: where a rule's notify action posts a webhook. Add one with a name and an http or https url; the signing secret is shown once, in the row, with a Copy button, and never listed again. Edit the name or url, rotate the secret (the new one is shown once too), send a test delivery, and archive or restore. Names are unique among a project's live destinations, and a url carrying a username or password is refused. The delivery format, how to verify the signature, and the retry schedule are in `docs/webhooks.md`.

### Colour

Every coloured thing carries a family (coral, sky, lilac, mint, stone). Arcs and tags can also carry a colour of their own: one of the seven presets, or any `#rrggbb` you type or pick. The colour wins over the family wherever the thing is drawn, and the chip's background and text are derived from it so the text stays readable on every colour. Choosing a family swatch clears the colour. Lanes and boards are family only.

## Attachments

A file is uploaded as a signed multipart `POST` to `/api/v1/attachments`, with the `ticketId` field first and the `file` field second. On an encrypted install, the bytes are written to disk as ciphertext, keyed the same way the database is. An attachment is served back only under its own content type, never as `text/html`, so an uploaded page cannot run as one; see Comments and threads above for how an `.html` attachment or a raw HTML block in a comment is rendered instead.

## Live updates

Once unlocked, the browser holds one signed `GET /api/v1/stream` connection open (Server-Sent Events) and reconnects with backoff if it drops. Every ticket, comment, evidence, attachment, agent, lane, and project change is published there as it happens, so two browser tabs, or a human's browser and a script polling nothing at all, see each other's changes within about a second, with no polling.

## Automations

Automations is a sidebar item for the human (`g m` from anywhere). Work moves only by explicit rules, and this is where the rules are drawn. The left column lists the project's rules with an enable switch, when each last fired and how many times; the canvas on the right holds the selected rule; the run log sits under it.

A rule is a drawing of four kinds of node, joined by edges from left to right:

- **When** (coral): the chain event that starts the rule, one per rule. A ticket is created, moves (from and to a lane), changes, gets or loses a flag, gains evidence of a type and result, gets a comment; a timer starts or stops; a cost is reported; a due date passes.
- **If** (sky): a condition on the ticket as it stands when the event arrives: its lane, board, arc, tag, flag, assignee, title, due date, a field's value, the evidence on it with a count, or who caused the event. Conditions chained one after another must all hold; two paths into the same action are either of them. A second edge out of an If node, labelled else, runs when the condition does not hold.
- **Then** (mint): an action. Move to a lane or a board, set or clear a flag, assign, add or remove a tag, set a field or the arc, add a comment, send a webhook to a destination, create a ticket, start or stop the engine's timer.
- **Every** (lilac): a schedule that stands in for the When node, built from presets (every hour, every weekday at 9:00, the first of the month) or a cron expression, with a timezone and a missed policy.

The palette on the right adds a node next to the selection: press `e`, `c`, `a` or `s`, or drag one on. `Delete` removes the selection and Ctrl or Cmd plus Z undoes ten steps. Every choice inside a node is a Picker, so a whole rule can be drawn without a mouse: Tab walks from a node into its Pickers and Enter opens one. Saving turns the drawing into the rule the engine runs and refuses one it cannot run, naming the node on the canvas and in the bar above it: a node not connected to the event, two event nodes, an action with no target chosen, an edge in a loop. The server compiles the drawing again on its side, so the same refusal holds for a rule written straight to the API.

Gates still apply. A rule's move goes through the same gate as a drag on the Board or an agent's call: a lane that needs evidence the ticket does not have refuses the rule too, the run is recorded as refused, a system comment on the ticket names the rule and what is missing, and the ticket is flagged `blocked`. No action clears `needs_human`; only a person does. Every fire is a chain event, `rule.fired`, and the events it causes carry `causedBy` back to it. A loop guard keeps rules from chasing their own tails: a causal chain no deeper than eight, one fire per rule per ticket per chain, five fires per rule per ticket per minute, and a budget of fifty fires and twenty created tickets per run; a rule stopped by the guard leaves a skipped run and flags the ticket `needs_human`.

**Test on ticket** runs the rule against a ticket of your choosing without acting: the event is synthesised from the When node, the conditions that hold and the actions that would run light up, and the bar says what a gate would refuse. Nothing is written, not even to the chain.

The **run log** under the canvas lists the last twenty runs of the rule (when, which ticket, applied, skipped, refused or error, with the detail on expand) and updates live over the stream.

Schedules fire as `trigger.fired` chain events. While the server is down or locked nothing fires; on start or unlock the runs that fell in the gap go by the rule's missed policy: `skip` drops them, `run_once` (the default) fires once for all of them, `run_all` fires each one. Webhooks are sent by an outbox worker with retries and a signature; the destinations are kept in Settings, and the delivery format, the signature check and the retry schedule are in `docs/webhooks.md`.

## Time and cost

Boomerang measures time and prices tokens; it never sees a model call. An agent starts a timer on a ticket when it begins work and stops it when it leaves; the server measures the time, one open timer per actor per ticket, and a timer left running stops when the ticket enters a done lane. After each turn the agent reports what the turn cost: the model id as the API names it and the token counts its harness gave it, input, output, cache reads and cache writes as separate counts, since they are priced differently. Boomerang prices the report at write time from a bundled snapshot of models.dev (`packages/core/src/prices.json`, with its date), never from the network, and keeps the tokens with no figure when the model is not in the table.

Every figure is an estimate. It renders as `~$9.40` (two significant figures), carries the price date and the words "this could be lower" on hover, and reads "at least ~$1.50" when an unpriced model sits beside priced ones. The figures appear on the Queue header (time, tokens and cost for this week, this month or all time, kept in the URL as `?period=`), on each agent's card on the Agents page, in the ticket panel's Cost block with a breakdown by model and by actor and the timers running now, and on the Board's arc chip.

`.claude/skills/report-usage/SKILL.md` tells an agent working over MCP when to start and stop the timer and how to report each turn's usage. To refresh the price table, run `pnpm prices:update` (`scripts/prices-update.mjs`), by hand, and commit the new `prices.json`; its `date` is what every estimate then reports.

## Webhooks and schedules

A rule can post to a webhook destination: a signed JSON delivery with retries, a per-attempt deadline, and a guard on where it may go. Schedules fire as chain events with a missed policy for downtime, and due dates are announced once they have passed. The delivery format, how to verify the signature (the hex secret string is the HMAC key), the retry schedule, and the end-of-day rule for due dates are in `docs/webhooks.md`.

## Tests

```
pnpm test
```

runs the unit and integration test suite with Vitest, including the MCP contract test, which starts a real server on a free port with a temporary data directory, registers and approves an agent, and drives every tool through an MCP client, the timer and cost tools among them.

```
pnpm e2e
```

runs the Playwright end to end suite: five specs, each against its own server on its own port and its own temporary data directory, so they run without sharing state. The first drives a full first run: setup, first project, agent registration and approval, the demo agent over MCP with its dependency refusal and gated move into Ready for Production, a ticket flagged for a human, clearing that flag and seeing the demo agent's comment and evidence in the thread, and a locked reload that rejects the wrong password and accepts the right one. The second drives the gate flow directly in the browser: a lane picker refusing a move with the missing evidence named, adding that evidence through the dialog, the move succeeding, the ticket showing up under the right column on the Board, and a markdown heading posted through the composer rendering in the thread. The third drives the ticket model: a required field and an arc added in Settings, the create dialog refusing to create until the field is filled, an arc, two inline-created tags, and a dependency chosen by keyboard alone, the panel showing all of it, Done refused with the blocker named, and the Board filtering by arc and by tag. The fourth drives the Settings lifecycle: a human-only evidence type added with its kind chosen by keyboard, a lane added, moved up, and edited to require that type with a description of what the evidence should show, a required field, a ticket whose panel checklist prints that description and whose lane picker refuses the lane naming the type, the type's delete refused while the lane requires it, the lane holding the ticket and the only done lane refusing deletion with their reasons, and an empty lane deleted. The fifth drives the automation: the owner's pipeline rule drawn on the canvas by keyboard alone (a ticket moves to Eval, if it has a passing eval score, move it to Ready for Production), a drawing with a disconnected action refused with the node named and undone, the rule saved and enabled, the demo agent run over MCP and approved, the rule firing on the agent's move into Eval so the ticket ends in Ready for Production flagged for a human, the fire and the move it caused read from the owner's own signed event stream with `causedBy` on them, the Queue header showing the week's `~$` figure as an estimate after the agent's cost report, the run log showing the applied run, and Test on ticket lighting every node while the chain head stays where it was.

## Contributing

Read `.claude/skills/contribute/SKILL.md` before changing anything: the
working contract, vocabulary, and test and commit rules. Every commit
carries a hash bound record of the session that produced it; see
`docs/provenance.md` for how that is captured and verified, and
`AGENTS.md` if you are working from a tool other than Claude Code.

## Milestone status

Boomerang is at milestone 3 of 5: automation (rules drawn on the Automations canvas and run by an engine that never steps around a gate, schedules with missed policies, signed webhooks through an outbox, the MCP server with the demo agent on it, timers and cost reports priced as estimates from a bundled table, and the time, tokens and cost figures on the Queue, the agent cards, the ticket panel and the Board) on top of milestone 2c's Settings refresh (lanes and evidence types added, reordered, and removed under the in-use rules, requirement descriptions that travel with the gate, preset and custom colours on arcs and tags, the file field kind) on top of milestone 2b's ticket model and creation (arcs, tags, dependencies with the blocked-by gate, custom fields, success criteria, Settings, the full-screen create dialog, and a keyboard-first Picker in place of every native select) on top of milestone 2's evidence and conversation (evidence types and gated lanes, comments and threads, attachments, the live SSE stream, the Board, the demo agent, end to end coverage of the gate flow) and milestone 1's foundation (monorepo, database, setup and unlock, human key, agent registration and approval, signing, hash chain, projects, lanes, tickets, REST, app shell with sidebar, Queue, ticket panel, lock screen). See `docs/superpowers/specs` for the full design and `todo/` for what is planned next.

Board virtualisation for very long lanes is planned for milestone 4; today every card in a lane renders at once.

## Licences

Every dependency Boomerang ships is under a permissive licence: MIT, ISC, BSD, Apache 2.0, MPL 2.0, Blue Oak 1.0.0, or OFL. The one further exception is `argparse`, a transitive dependency of the markdown editor, which is under the Python Software Foundation licence; that licence is also permissive and imposes no obligation beyond keeping its own notice. `pnpm licenses list` shows the full set.

## License

MIT
