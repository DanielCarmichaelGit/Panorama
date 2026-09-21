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

Every state change is appended to a hash chained event log signed by the actor who made it. On unlock, Panorama verifies the chain from the last checkpoint; a break shows a banner naming the first bad entry.

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
