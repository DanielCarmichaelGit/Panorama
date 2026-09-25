# Panorama

A free, MIT licensed, self-hosted project manager for one developer supervising several AI agents. Agents connect from outside through REST or MCP. Work moves only by deterministic rules. A ticket enters a gated lane only with the evidence that lane requires. Panorama contains no agents and makes no LLM calls.

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

Panorama stores its SQLite database and file attachments in `PANORAMA_DATA_DIR`, or `~/.panorama/` if that variable is not set.

At setup you choose whether to encrypt the database. With encryption on, the browser derives an Ed25519 signing seed and a database key from your password with Argon2id and a stored salt. Only the public key and salt are kept on disk; the password and seed are never written anywhere, and the private key lives only in browser memory for the session. Restarting the server leaves Panorama locked: every API call other than `/api/v1/health`, `/api/v1/status`, `/api/v1/setup`, and `/api/v1/unlock` answers `423 Locked` until you enter the password again. With encryption off, there is no lock step and the database is stored in plaintext.

## Tamper evidence

Every state change is appended to a hash chained event log, signed by the actor who made it, in the same transaction as the change itself. When you unlock, the server verifies every entry from the beginning of the log and then checks that the log still contains the point you last signed, with the same hash. Your browser signs the new head as the text `<seq>:<headHash>`, and keeps that pair in `localStorage` under `pan.anchor` so that the next unlock can cross check the server's answer against what this browser last saw. A failure shows a banner naming the first bad entry and what went wrong. The password and the signing seed are never stored anywhere.

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

`scripts/demo-agent.ts` is a full working example. It generates a key, registers, waits for approval, creates a ticket, and moves it into In Progress. It then applies the project's `demo` tag if a human has made one in Settings (tags are human-defined, so it says so and carries on when there is none), creates a second ticket that blocks the first, tries to move the first into Done and prints the refusal, which names the blocker, then removes the link. After that it tries to move the ticket straight to Ready for Production, which the server refuses because the lane requires an eval score; the script prints that refusal too, posts a comment, attaches a test run and an eval score as evidence, and moves the ticket into Ready for Production again, this time successfully. Run it with:

```
pnpm demo:agent
```

## Comments and threads

Every ticket has a thread: comments, evidence, and attachments, ordered by when they happened. A comment is written as markdown in the ticket panel's composer, which supports the usual shorthand (`#`/`##`/`###` headings, `-` and `1.` lists, `>` quotes, `---` rules, backtick code, and `**bold**`) as you type, plus dropping or pasting an image or file straight into the editor, which uploads it and inserts an `attachment:id` reference at the cursor. Ctrl/Cmd+Enter posts the comment.

```
POST /api/v1/comments {"ticketId":"...","body":"...","attachmentIds":["..."]}
```

A comment's body is stored verbatim: there is no server side sanitisation, because a lossy rewrite would mangle plain markdown punctuation and an escaping one can be undone by the very engine that later decodes it. Rendering is where untrusted markup is made safe. The web client parses the body with `marked` and sanitises the result with DOMPurify before it ever reaches the DOM; a raw HTML block or a fenced ```` ```html ```` block is sanitised the same way and then rendered inside a sandboxed iframe with its own restrictive Content-Security-Policy, isolated from the rest of the page. Attachments are never served with a `text/html` content type, so an uploaded `.html` file cannot execute as a page of its own; it only ever renders inside that same sandboxed frame.

## Evidence and gates

An evidence type describes one kind of proof (a test run, an eval score, a linked pull request, a screenshot, a file, a human sign-off, or a free form custom result) and how it is scored pass, fail, or info. A lane can require a count of one or more evidence types before a ticket may enter it; the ticket panel and the Board both show the lanes a ticket cannot yet enter, and why.

```
POST /api/v1/evidence {"ticketId":"...","typeId":"et_eval_score","payload":{"score":0.94}}
```

Moving a ticket into a lane it does not yet qualify for is refused with `422`:

```json
{"error":{"code":"gate","message":"Ready for Production needs evidence first","details":{"laneId":"...","missing":[{"typeId":"et_eval_score","name":"Eval score","need":1,"have":0}]}}}
```

This refusal is enforced on the server, so it holds no matter how the move is attempted: a signed REST call from an agent, a drag on the Board, or the lane select in the ticket panel's keyboard shortcut. Some evidence types are human only, most notably a sign-off: an agent that tries to attach one gets `403`, even with every other scope granted.

## The ticket model

A ticket carries a title, a lane, a board, and the properties below. Every one of them is set from the create dialog (New ticket on the Queue or the Board, Ctrl or Cmd plus Enter to create) and edited in place from the ticket panel; agents set the same properties through the API with their `ticket.update` scope, except success criteria, which stay human-only.

- **Epics** group tickets. A ticket belongs to at most one epic. Epics have a name, a description, and a colour family, and the Board filters by epic through `?epic=<id>`.
- **Tags** classify tickets. A tag has a name, unique per project ignoring case, and a colour family; a ticket carries any number of them. Tags are defined in Settings or created inline from the Tags picker, and the Board filters by one or more tags through `?tag=<id>`. Flags (`needs_human`, `blocked`) stay separate: they describe state, tags describe what a ticket is about.
- **Dependencies** are links between two tickets of the same project. `A blocks B` means B cannot enter a lane marked done while A is not in one, and `relates` is informational. The blocked-by gate reports itself the same way a missing-evidence gate does: the `422` names the blocker (`Blocked by KEY`) in `details.missing`, the panel's checklist lists it, and the panel's Lane picker and the Board's drop targets refuse Done with the same words. Removing the link lifts the gate. Links refuse a self-link, a duplicate, and a cycle.
- **Custom fields** are defined per project in Settings: text, number, date, select (with its own options), or checkbox, in a configured order, each optionally required. A required field is enforced when a human creates a ticket (the dialog's Create button stays disabled and names what is missing) and on every `PATCH` for everyone; an agent may create a ticket without it, and the panel then shows a "Needs fields" chip until someone fills it in. Values travel as `fields: {key: value}`; `null` clears one.
- **Success criteria** are markdown at the top of the panel. Task-list items (`- [ ]`) render as checkboxes only a human can tick, and ticking one writes the updated markdown back as a signed `ticket.updated`.

The routes:

```
GET    /api/v1/epics?projectId=            list epics
POST   /api/v1/epics                       {"projectId","name","description?","family?"}
PATCH  /api/v1/epics/:id                   {"name?","description?","family?","position?","archived?"}
GET    /api/v1/tags?projectId=             list tags
POST   /api/v1/tags                        {"projectId","name","family?"}
POST   /api/v1/tags/:id/archive
GET    /api/v1/tickets/:id/links           {"links":[...],"tickets":[...]} for the linked tickets
POST   /api/v1/tickets/:id/links           {"toId","kind":"blocks"|"relates"}, :id is the blocking side
DELETE /api/v1/tickets/:id/links/:linkId
GET    /api/v1/fields?projectId=           list field definitions
POST   /api/v1/fields                      {"projectId","name","key","kind","required?","options?"}
PATCH  /api/v1/fields/:id                  {"name?","required?","options?","position?"}
POST   /api/v1/fields/:id/archive
```

`POST /api/v1/tickets` accepts `epicId`, `tagIds`, `successCriteria`, and `fields` alongside the title, and `PATCH /api/v1/tickets/:id` accepts the same. Epics, tags, and fields are edited by humans only (`epic.edit`, `tag.edit`, `field.edit`); agents read them and apply them to tickets. The event log records `epic.created`, `epic.updated`, `tag.created`, `tag.archived`, `ticket.linked`, `ticket.unlinked`, `field.created`, `field.updated`, and `field.archived`, and a `ticket.updated` carries `changed`, the list of properties that changed (`tagIds` among them).

## Settings

Settings is a sidebar item for the human (`g s` from anywhere). Every save there is signed and logged like any other change. Its tabs:

- **Fields**: add a custom field (name, key, kind, required, and options for a select), edit one, reorder them, and archive one. Archiving keeps the values already stored on tickets but drops the field from forms and lists.
- **Tags**: add a tag with a colour family, and archive one.
- **Epics**: add an epic with a description and a colour family, edit, reorder, and archive.
- **Lanes**: the project's lanes in order, which ones flag a ticket for a human on entry, and each lane's evidence requirements, edited as rows of evidence type and count.
- **Evidence types**: the built-in types with their kind and whether they are human-only or need an attachment. Custom types arrive with automations.

## Attachments

A file is uploaded as a signed multipart `POST` to `/api/v1/attachments`, with the `ticketId` field first and the `file` field second. On an encrypted install, the bytes are written to disk as ciphertext, keyed the same way the database is. An attachment is served back only under its own content type, never as `text/html`, so an uploaded page cannot run as one; see Comments and threads above for how an `.html` attachment or a raw HTML block in a comment is rendered instead.

## Live updates

Once unlocked, the browser holds one signed `GET /api/v1/stream` connection open (Server-Sent Events) and reconnects with backoff if it drops. Every ticket, comment, evidence, attachment, agent, lane, and project change is published there as it happens, so two browser tabs, or a human's browser and a script polling nothing at all, see each other's changes within about a second, with no polling.

## Tests

```
pnpm test
```

runs the unit and integration test suite with Vitest.

```
pnpm e2e
```

runs the Playwright end to end suite: three specs, each against its own server on its own port and its own temporary data directory, so they run without sharing state. The first drives a full first run: setup, first project, agent registration and approval, the demo agent's dependency refusal and gated move into Ready for Production, a ticket flagged for a human, clearing that flag and seeing the demo agent's comment and evidence in the thread, and a locked reload that rejects the wrong password and accepts the right one. The second drives the gate flow directly in the browser: a lane picker refusing a move with the missing evidence named, adding that evidence through the dialog, the move succeeding, the ticket showing up under the right column on the Board, and a markdown heading posted through the composer rendering in the thread. The third drives the ticket model: a required field and an epic added in Settings, the create dialog refusing to create until the field is filled, an epic, two inline-created tags, and a dependency chosen by keyboard alone, the panel showing all of it, Done refused with the blocker named, and the Board filtering by epic and by tag.

## Contributing

Read `.claude/skills/contribute/SKILL.md` before changing anything: the
working contract, vocabulary, and test and commit rules. Every commit
carries a hash bound record of the session that produced it; see
`docs/provenance.md` for how that is captured and verified, and
`AGENTS.md` if you are working from a tool other than Claude Code.

## Milestone status

Panorama is at milestone 2b of 5: the ticket model and creation (epics, tags, dependencies with the blocked-by gate, custom fields, success criteria, Settings, the full-screen create dialog, and a keyboard-first Picker in place of every native select) on top of milestone 2's evidence and conversation (evidence types and gated lanes, comments and threads, attachments, the live SSE stream, the Board, the demo agent, end to end coverage of the gate flow) and milestone 1's foundation (monorepo, database, setup and unlock, human key, agent registration and approval, signing, hash chain, projects, lanes, tickets, REST, app shell with sidebar, Queue, ticket panel, lock screen). See `docs/superpowers/specs` for the full design and `todo/` for what is planned next.

Board virtualisation for very long lanes is planned for milestone 4; today every card in a lane renders at once.

## Licences

Every dependency Panorama ships is under a permissive licence: MIT, ISC, BSD, Apache 2.0, MPL 2.0, Blue Oak 1.0.0, or OFL. The one further exception is `argparse`, a transitive dependency of the markdown editor, which is under the Python Software Foundation licence; that licence is also permissive and imposes no obligation beyond keeping its own notice. `pnpm licenses list` shows the full set.

## License

MIT
