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

`scripts/demo-agent.ts` is a full working example. It generates a key, registers, waits for approval, creates a ticket, and moves it into In Progress. It then tries to move the ticket straight to Ready for Production, which the server refuses because the lane requires an eval score; the script prints the refusal, posts a comment, attaches a test run and an eval score as evidence, and moves the ticket into Ready for Production again, this time successfully. Run it with:

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

runs the Playwright end to end suite: two specs, each against its own server on its own port and its own temporary data directory, so they run without sharing state. The first drives a full first run: setup, first project, agent registration and approval, the demo agent's gated move into Ready for Production, a ticket flagged for a human, clearing that flag and seeing the demo agent's comment and evidence in the thread, and a locked reload that rejects the wrong password and accepts the right one. The second drives the gate flow directly in the browser: a lane select refusing a move with the missing evidence named, adding that evidence through the dialog, the move succeeding, the ticket showing up under the right column on the Board, and a markdown heading posted through the composer rendering in the thread.

## Milestone status

Panorama is at milestone 2 of 5: evidence and conversation (evidence types and gated lanes, comments and threads, attachments, the live SSE stream, the Board, the demo agent, end to end coverage of the gate flow) on top of milestone 1's foundation (monorepo, database, setup and unlock, human key, agent registration and approval, signing, hash chain, projects, lanes, tickets, REST, app shell with sidebar, Queue, ticket panel, lock screen). See `docs/superpowers/specs` for the full design and `todo/` for what is planned next.

Board virtualisation for very long lanes is planned for milestone 4; today every card in a lane renders at once.

## Licences

Every dependency Panorama ships is under a permissive licence: MIT, ISC, BSD, Apache 2.0, MPL 2.0, or OFL. The one exception is `argparse`, a transitive dependency of the markdown editor, which is under the Python Software Foundation licence; that licence is also permissive and imposes no obligation beyond keeping its own notice.

## License

MIT
