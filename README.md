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

`scripts/demo-agent.ts` is a full working example: it generates a key, registers, waits for approval, creates a ticket, and moves it through lanes. Run it with:

```
pnpm demo:agent
```

## Tests

```
pnpm test
```

runs the unit and integration test suite with Vitest.

```
pnpm e2e
```

runs the Playwright end to end test, which builds the app, starts a server on a temporary data directory, and drives a full first run: setup, first project, agent registration and approval, a ticket flagged for a human, clearing that flag, and a locked reload that rejects the wrong password and accepts the right one.

## Milestone status

Panorama is at milestone 1 of 5: the foundation (monorepo, database, setup and unlock, human key, agent registration and approval, signing, hash chain, projects, lanes, tickets, REST, app shell with sidebar, Queue, ticket panel, lock screen). See `docs/superpowers/specs` for the full design and `todo/` for what is planned next.

## License

MIT
