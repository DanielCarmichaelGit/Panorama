# Boomerang Milestone 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Boomerang where the owner sets a password, unlocks an encrypted database, approves an agent key, and clears a Needs Human ticket from the Queue, with every change signed and hash chained.

**Architecture:** pnpm TypeScript monorepo. `packages/core` is pure logic (canonical JSON, hash chain, key derivation, request signing, permissions, zod schemas). `packages/db` wraps SQLite (SQLCipher compatible) with SQL migrations and repositories. `apps/server` is a Fastify REST API that verifies a signature on every request and appends a chained event inside the same transaction as each change. `apps/web` is a React and Vite app that derives the human key from the password in the browser and signs its own requests.

**Tech Stack:** Node 20+, pnpm 9+, TypeScript 5, Vitest, Fastify 5, better-sqlite3-multiple-ciphers, zod, @noble/ed25519, @noble/hashes, hash-wasm, React 18, Vite 5, react-router 6, @tanstack/react-query 5, @phosphor-icons/react, @fontsource/figtree, @fontsource/jetbrains-mono, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-panorama-design.md` (sections 2 to 6, 10, 12, 13, milestone 1 of 14). UI: `BRIEF.md` and `BRAND.md`. Executors read all three.

## Global Constraints

- License MIT. Every dependency must be MIT, ISC, BSD, Apache 2.0, or OFL. No paid services, no telemetry, no runtime network requests except to the local server.
- Node `>=20`. All packages `"type": "module"`, TypeScript `moduleResolution: "Bundler"`, workspace packages export `src/index.ts` directly (no build step for libraries).
- Every package and app has a `tsconfig.json` containing `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`.
- Server binds `127.0.0.1:4400`. Data directory is `process.env.BOOMERANG_DATA_DIR` or `~/.boomerang`.
- No em dashes and no en dashes in any string, comment, commit message, or document.
- UI uses only the tokens in `BRAND.md` as CSS custom properties. No framework palette names, no CSS framework. Fonts come from the `@fontsource` packages, bundled locally.
- M1 sidebar shows only views that exist: Queue and Agents. Controls for unbuilt features are absent.
- The password and the Ed25519 seed are never sent to the server and never written to disk or browser storage.
- Every mutation, its event row, and nothing else happen in one SQLite transaction.
- Error body shape everywhere: `{"error":{"code":string,"message":string,"details"?:unknown}}`. Status codes: 400 validation, 401 bad signature, 403 scope, 404, 409 conflict, 423 locked.
- Commit after every task with a conventional commit message. Work on branch `m1-foundation`.

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.workspace.ts, .gitignore, LICENSE, README.md
packages/core/src/
  canonical.ts     deterministic JSON
  hash.ts          sha256Hex, randomHex
  chain.ts         hashEvent, verifyChain, GENESIS
  keys.ts          deriveKeys (Argon2id to seed, dbKey, publicKey)
  signing.ts       requestMessage, signRequest, verifyRequest, signText, verifyText
  permissions.ts   actions, Scopes, can()
  schemas.ts       zod schemas and types for Project, Lane, Ticket, Actor, inputs, DEFAULT_LANES
  index.ts
packages/db/src/
  open.ts          openDatabase(file, keyHex)
  migrations.ts    SQL strings, migrate(db)
  config.ts        readConfig, writeConfig (config.json)
  events.ts        appendEvent, listEvents, latestCheckpoint, addCheckpoint
  actors.ts        actor repository
  projects.ts      project and lane repository
  tickets.ts       ticket repository and queue
  index.ts
apps/server/src/
  errors.ts        HttpError, error handler
  context.ts       Ctx type (dataDir, db, config, now, nonces)
  auth.ts          signature verification hook, requireCan
  routes/lifecycle.ts  status, setup, unlock, lock, health
  routes/agents.ts
  routes/projects.ts
  routes/tickets.ts
  routes/chain.ts
  app.ts           buildApp
  main.ts          start
  test/helpers.ts  temp dir, fast keys, signed inject client
apps/web/
  index.html, vite.config.ts
  src/main.tsx, src/App.tsx
  src/styles/tokens.css, src/styles/app.css
  src/lib/session.ts   in-memory seed
  src/lib/api.ts       signed fetch
  src/lib/iso.tsx      isoBox, LaneScene
  src/lib/families.ts  pastel families
  src/views/LockScreen.tsx, FirstProject.tsx, Shell.tsx, Queue.tsx, TicketPanel.tsx, Agents.tsx
  src/components/Chip.tsx, TicketRow.tsx, NewTicket.tsx, ChainBanner.tsx
scripts/demo-agent.ts   registers a key, waits for approval, creates and moves a ticket
e2e/first-run.spec.ts, playwright.config.ts
```

---

### Task 1: Workspace and hash chain

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`, `LICENSE`, `README.md`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/canonical.ts`, `hash.ts`, `chain.ts`, `index.ts`
- Test: `packages/core/src/chain.test.ts`

**Interfaces:**
- Produces: `canonical(value: unknown): string`, `sha256Hex(s: string): string`, `randomHex(bytes: number): string`, `GENESIS: string`, `interface ChainEvent { seq: number; prevHash: string; hash: string; actorId: string; type: string; payload: unknown; createdAt: string }`, `hashEvent(e: Omit<ChainEvent,"hash">): string`, `verifyChain(events: ChainEvent[], startPrev?: string): { ok: true; head: string } | { ok: false; brokenAt: number }`

- [ ] **Step 1: Scaffold the workspace**

```bash
cd /Users/danielcarmichael/panorama && git init -b main && git checkout -b m1-foundation
```

`package.json`:
```json
{
  "name": "boomerang",
  "private": true,
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "dev:server": "pnpm --filter @boomerang/server dev",
    "dev:web": "pnpm --filter @boomerang/web dev",
    "build:web": "pnpm --filter @boomerang/web build",
    "start": "pnpm build:web && pnpm --filter @boomerang/server start",
    "e2e": "playwright test"
  },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.1.0", "tsx": "^4.19.0", "@types/node": "^20.14.0" },
  "pnpm": { "onlyBuiltDependencies": ["better-sqlite3-multiple-ciphers", "esbuild"] }
}
```
`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```
`tsconfig.base.json`:
```json
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "skipLibCheck": true, "noEmit": true, "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["node"] } }
```
`vitest.workspace.ts`:
```ts
export default ["packages/*", "apps/server"];
```
`.gitignore`:
```
node_modules
dist
.DS_Store
test-results
playwright-report
```
`LICENSE`: the standard MIT text, `Copyright (c) 2026 Boomerang contributors`.
`README.md`: title `# Boomerang`, the one-sentence purpose from spec section 1, and `pnpm install && pnpm start`.

`packages/core/package.json`:
```json
{ "name": "@boomerang/core", "version": "0.1.0", "private": true, "type": "module", "main": "src/index.ts", "types": "src/index.ts",
  "dependencies": { "@noble/ed25519": "^2.1.0", "@noble/hashes": "^1.5.0", "hash-wasm": "^4.11.0", "zod": "^3.23.0" } }
```
`packages/core/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`

Run: `pnpm install`

- [ ] **Step 2: Write the failing test** `packages/core/src/chain.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { canonical, GENESIS, hashEvent, verifyChain, type ChainEvent } from "./index";

const mk = (seq: number, prevHash: string, payload: unknown): ChainEvent => {
  const base = { seq, prevHash, actorId: "human", type: "t", payload, createdAt: "2026-09-21T00:00:00.000Z" };
  return { ...base, hash: hashEvent(base) };
};

describe("canonical", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(canonical({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});

describe("chain", () => {
  it("verifies an intact chain and returns the head", () => {
    const e1 = mk(1, GENESIS, { a: 1 });
    const e2 = mk(2, e1.hash, { a: 2 });
    expect(verifyChain([e1, e2])).toEqual({ ok: true, head: e2.hash });
  });
  it("returns GENESIS as head of an empty chain", () => {
    expect(verifyChain([])).toEqual({ ok: true, head: GENESIS });
  });
  it("reports the first edited event", () => {
    const e1 = mk(1, GENESIS, { a: 1 });
    const e2 = mk(2, e1.hash, { a: 2 });
    const e3 = mk(3, e2.hash, { a: 3 });
    expect(verifyChain([e1, { ...e2, payload: { a: 99 } }, e3])).toEqual({ ok: false, brokenAt: 2 });
  });
  it("reports a deleted event as a break at the next seq", () => {
    const e1 = mk(1, GENESIS, {});
    const e2 = mk(2, e1.hash, {});
    const e3 = mk(3, e2.hash, {});
    expect(verifyChain([e1, e3])).toEqual({ ok: false, brokenAt: 3 });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm vitest run packages/core` Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 4: Implement**

`canonical.ts`:
```ts
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
```
`hash.ts`:
```ts
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
export const sha256Hex = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));
export const randomHex = (bytes: number): string => bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
```
`chain.ts`:
```ts
import { canonical } from "./canonical";
import { sha256Hex } from "./hash";

export const GENESIS = "0".repeat(64);
export interface ChainEvent { seq: number; prevHash: string; hash: string; actorId: string; type: string; payload: unknown; createdAt: string }

export function hashEvent(e: Omit<ChainEvent, "hash">): string {
  return sha256Hex(e.prevHash + canonical({ seq: e.seq, actorId: e.actorId, type: e.type, payload: e.payload, createdAt: e.createdAt }));
}

export function verifyChain(events: ChainEvent[], startPrev: string = GENESIS): { ok: true; head: string } | { ok: false; brokenAt: number } {
  let prev = startPrev;
  let expectedSeq = events.length ? events[0].seq : 1;
  for (const e of events) {
    if (e.seq !== expectedSeq || e.prevHash !== prev || hashEvent(e) !== e.hash) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
    expectedSeq += 1;
  }
  return { ok: true, head: prev };
}
```
`index.ts`:
```ts
export * from "./canonical";
export * from "./hash";
export * from "./chain";
```

- [ ] **Step 5: Run tests** `pnpm vitest run packages/core` Expected: 5 passed.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(core): workspace scaffold, canonical json, hash chain"`

---

### Task 2: Key derivation and request signing

**Files:**
- Create: `packages/core/src/keys.ts`, `packages/core/src/signing.ts`; Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/signing.test.ts`

**Interfaces:**
- Consumes: `sha256Hex`, `randomHex`
- Produces:
  - `interface ArgonParams { iterations: number; memorySize: number; parallelism: number }`, `ARGON: ArgonParams` (3, 65536, 1), `ARGON_FAST: ArgonParams` (1, 1024, 1, tests only)
  - `deriveKeys(password: string, saltHex: string, params?: ArgonParams): Promise<{ seed: Uint8Array; dbKeyHex: string; publicKeyHex: string }>`
  - `publicKeyFromSeed(seed: Uint8Array): Promise<string>`
  - `type SignedHeaders = { "x-pan-actor": string; "x-pan-ts": string; "x-pan-nonce": string; "x-pan-sig": string }`
  - `signRequest(seed: Uint8Array, actorId: string, method: string, path: string, body: string, nowMs?: number): Promise<SignedHeaders>`
  - `verifyRequest(publicKeyHex: string, h: Partial<SignedHeaders>, method: string, path: string, body: string, nowMs: number, skewMs?: number): Promise<boolean>`
  - `signText(seed: Uint8Array, text: string): Promise<string>`, `verifyText(publicKeyHex: string, text: string, sigHex: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test** `signing.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, signRequest, signText, verifyRequest, verifyText } from "./index";

const salt = "00112233445566778899aabbccddeeff";

describe("deriveKeys", () => {
  it("is deterministic and separates the db key from the seed", async () => {
    const a = await deriveKeys("correct horse battery", salt, ARGON_FAST);
    const b = await deriveKeys("correct horse battery", salt, ARGON_FAST);
    expect(a.publicKeyHex).toBe(b.publicKeyHex);
    expect(a.dbKeyHex).toHaveLength(64);
    expect(a.publicKeyHex).toHaveLength(64);
    expect(Buffer.from(a.seed).toString("hex")).not.toBe(a.dbKeyHex);
    const c = await deriveKeys("another password", salt, ARGON_FAST);
    expect(c.publicKeyHex).not.toBe(a.publicKeyHex);
  });
});

describe("request signing", () => {
  it("round trips and rejects tampering, staleness, and the wrong key", async () => {
    const k = await deriveKeys("pw-one-two-three", salt, ARGON_FAST);
    const other = await deriveKeys("pw-four-five-six", salt, ARGON_FAST);
    const now = 1_800_000_000_000;
    const h = await signRequest(k.seed, "human", "post", "/api/v1/tickets?x=1", '{"a":1}', now);
    expect(h["x-pan-actor"]).toBe("human");
    expect(await verifyRequest(k.publicKeyHex, h, "POST", "/api/v1/tickets?x=1", '{"a":1}', now + 5_000)).toBe(true);
    expect(await verifyRequest(k.publicKeyHex, h, "POST", "/api/v1/tickets?x=1", '{"a":2}', now)).toBe(false);
    expect(await verifyRequest(k.publicKeyHex, h, "POST", "/api/v1/other", '{"a":1}', now)).toBe(false);
    expect(await verifyRequest(k.publicKeyHex, h, "POST", "/api/v1/tickets?x=1", '{"a":1}', now + 61_000)).toBe(false);
    expect(await verifyRequest(other.publicKeyHex, h, "POST", "/api/v1/tickets?x=1", '{"a":1}', now)).toBe(false);
    expect(await verifyRequest(k.publicKeyHex, { ...h, "x-pan-sig": "zz" }, "POST", "/api/v1/tickets?x=1", '{"a":1}', now)).toBe(false);
    expect(await verifyRequest(k.publicKeyHex, {}, "POST", "/api/v1/tickets?x=1", '{"a":1}', now)).toBe(false);
  });
  it("signs and verifies plain text", async () => {
    const k = await deriveKeys("pw-one-two-three", salt, ARGON_FAST);
    const sig = await signText(k.seed, "abc");
    expect(await verifyText(k.publicKeyHex, "abc", sig)).toBe(true);
    expect(await verifyText(k.publicKeyHex, "abd", sig)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** (`deriveKeys` is not exported).

- [ ] **Step 3: Implement**

`keys.ts`:
```ts
import { argon2id } from "hash-wasm";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export interface ArgonParams { iterations: number; memorySize: number; parallelism: number }
export const ARGON: ArgonParams = { iterations: 3, memorySize: 65536, parallelism: 1 };
export const ARGON_FAST: ArgonParams = { iterations: 1, memorySize: 1024, parallelism: 1 };

export const publicKeyFromSeed = async (seed: Uint8Array): Promise<string> => bytesToHex(await ed.getPublicKeyAsync(seed));

// One Argon2id run, 64 bytes out: first half is the Ed25519 seed (never leaves the browser),
// second half is the database key (sent to the local server at unlock).
export async function deriveKeys(password: string, saltHex: string, params: ArgonParams = ARGON) {
  const out = await argon2id({ password, salt: hexToBytes(saltHex), ...params, hashLength: 64, outputType: "binary" });
  const seed = out.slice(0, 32);
  return { seed, dbKeyHex: bytesToHex(out.slice(32)), publicKeyHex: await publicKeyFromSeed(seed) };
}
```
`signing.ts`:
```ts
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { randomHex, sha256Hex } from "./hash";

export type SignedHeaders = { "x-pan-actor": string; "x-pan-ts": string; "x-pan-nonce": string; "x-pan-sig": string };

export const requestMessage = (method: string, path: string, body: string, ts: string, nonce: string): string =>
  [method.toUpperCase(), path, sha256Hex(body), ts, nonce].join("\n");

export const signText = async (seed: Uint8Array, text: string): Promise<string> =>
  bytesToHex(await ed.signAsync(utf8ToBytes(text), seed));

export async function verifyText(publicKeyHex: string, text: string, sigHex: string): Promise<boolean> {
  try { return await ed.verifyAsync(hexToBytes(sigHex), utf8ToBytes(text), hexToBytes(publicKeyHex)); } catch { return false; }
}

export async function signRequest(seed: Uint8Array, actorId: string, method: string, path: string, body: string, nowMs: number = Date.now()): Promise<SignedHeaders> {
  const ts = String(nowMs), nonce = randomHex(16);
  return { "x-pan-actor": actorId, "x-pan-ts": ts, "x-pan-nonce": nonce, "x-pan-sig": await signText(seed, requestMessage(method, path, body, ts, nonce)) };
}

export async function verifyRequest(publicKeyHex: string, h: Partial<SignedHeaders>, method: string, path: string, body: string, nowMs: number, skewMs = 60_000): Promise<boolean> {
  const ts = h["x-pan-ts"], nonce = h["x-pan-nonce"], sig = h["x-pan-sig"];
  if (!ts || !nonce || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(nowMs - Number(ts)) > skewMs) return false;
  return verifyText(publicKeyHex, requestMessage(method, path, body, ts, nonce), sig);
}
```
Add to `index.ts`: `export * from "./keys"; export * from "./signing";`

- [ ] **Step 4: Run tests.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(core): argon2id key derivation and ed25519 request signing`

---

### Task 3: Schemas and permissions

**Files:**
- Create: `packages/core/src/schemas.ts`, `packages/core/src/permissions.ts`; Modify: `index.ts`
- Test: `packages/core/src/permissions.test.ts`

**Interfaces:**
- Produces:
  - `FAMILIES = ["coral","sky","lilac","mint","stone"] as const`, `type Family`
  - `DEFAULT_LANES: { name: string; family: Family; setsNeedsHuman: boolean; isDone: boolean }[]` = Backlog stone, Ready stone, In Progress sky, Eval lilac, Ready for Production mint (setsNeedsHuman true), Done mint (isDone true)
  - `AGENT_ACTIONS = ["read","ticket.create","ticket.update","ticket.move","flag.set"] as const`, `HUMAN_ACTIONS = ["project.create","agent.approve","agent.revoke","ticket.archive","flag.clear_needs_human","checkpoint.create","lock"] as const`, `type Action`
  - `interface Scopes { projects: string[] | "*"; actions: AgentAction[] }`, `ScopesSchema`
  - `interface Actor { id: string; kind: "human"|"agent"; name: string; publicKey: string; scopes: Scopes|null; status: "pending"|"active"|"revoked"; lastSeen: string|null; createdAt: string }`
  - `interface Project { id; key; name; createdAt }`, `interface Lane { id; projectId; name; position: number; family: Family; setsNeedsHuman: boolean; isDone: boolean }`
  - `interface Ticket { id: string; projectId: string; number: number; key: string; title: string; laneId: string; position: number; flags: string[]; assigneeId: string|null; startDate: string|null; dueDate: string|null; metadata: Record<string, unknown>; archived: boolean; createdAt: string; updatedAt: string }`
  - zod inputs: `SetupInput { publicKey: hex64; kdfSalt: hex32; argon: ArgonParams; encryption: boolean; dbKey: hex64 | null }`, `UnlockInput { dbKey: hex64 }`, `RegisterAgentInput { name: 1..60 chars; publicKey: hex64 }`, `ApproveAgentInput { scopes: Scopes }`, `CreateProjectInput { name: 1..80; key: /^[A-Z][A-Z0-9]{1,7}$/ }`, `CreateTicketInput { projectId; title: 1..200; laneId?: string; metadata?: record }`, `UpdateTicketInput { title?; startDate?: string|null; dueDate?: string|null; assigneeId?: string|null; metadata?: record }` (strict, at least one key), `MoveTicketInput { laneId }`, `FlagInput { flag: /^[a-z][a-z0-9_]{0,31}$/; on: boolean }`, `CheckpointInput { headHash: hex64; signature: hex128 }`
  - `can(actor: Pick<Actor,"kind"|"status"|"scopes">, action: Action, projectId?: string): boolean`

- [ ] **Step 1: Write the failing test** `permissions.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { can, type Actor } from "./index";

const human = { kind: "human", status: "active", scopes: null } as Pick<Actor, "kind" | "status" | "scopes">;
const agent = (over: Partial<Actor> = {}) => ({ kind: "agent", status: "active", scopes: { projects: ["p1"], actions: ["read", "ticket.move"] }, ...over }) as Pick<Actor, "kind" | "status" | "scopes">;

describe("can", () => {
  it("lets the human do everything", () => {
    expect(can(human, "agent.approve")).toBe(true);
    expect(can(human, "ticket.move", "p9")).toBe(true);
  });
  it("limits agents to granted actions inside granted projects", () => {
    expect(can(agent(), "ticket.move", "p1")).toBe(true);
    expect(can(agent(), "ticket.create", "p1")).toBe(false);
    expect(can(agent(), "ticket.move", "p2")).toBe(false);
    expect(can(agent({ scopes: { projects: "*", actions: ["read"] } }), "read", "p2")).toBe(true);
  });
  it("never lets an agent perform a human action, whatever its scopes say", () => {
    const forged = agent({ scopes: { projects: "*", actions: ["agent.approve", "ticket.archive", "flag.clear_needs_human"] as never } });
    expect(can(forged, "agent.approve")).toBe(false);
    expect(can(forged, "ticket.archive", "p1")).toBe(false);
    expect(can(forged, "flag.clear_needs_human", "p1")).toBe(false);
  });
  it("denies pending and revoked actors", () => {
    expect(can(agent({ status: "pending" }), "read", "p1")).toBe(false);
    expect(can(agent({ status: "revoked" }), "read", "p1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement** `permissions.ts`

```ts
import { z } from "zod";
export const AGENT_ACTIONS = ["read", "ticket.create", "ticket.update", "ticket.move", "flag.set"] as const;
export const HUMAN_ACTIONS = ["project.create", "agent.approve", "agent.revoke", "ticket.archive", "flag.clear_needs_human", "checkpoint.create", "lock"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];
export type Action = AgentAction | (typeof HUMAN_ACTIONS)[number];
export const ScopesSchema = z.object({ projects: z.union([z.literal("*"), z.array(z.string().min(1))]), actions: z.array(z.enum(AGENT_ACTIONS)) }).strict();
export type Scopes = z.infer<typeof ScopesSchema>;

export function can(actor: { kind: "human" | "agent"; status: string; scopes: Scopes | null }, action: Action, projectId?: string): boolean {
  if (actor.status !== "active") return false;
  if (actor.kind === "human") return true;
  if (!(AGENT_ACTIONS as readonly string[]).includes(action) || !actor.scopes) return false;
  if (!actor.scopes.actions.includes(action as AgentAction)) return false;
  if (projectId === undefined) return true;
  return actor.scopes.projects === "*" || actor.scopes.projects.includes(projectId);
}
```
`schemas.ts`: define every interface and zod schema listed under Produces, exactly as named. Helpers: `const hex = (n: number) => z.string().regex(new RegExp(\`^[0-9a-f]{${n}}$\`))`. `UpdateTicketInput` uses `.strict().refine((o) => Object.keys(o).length > 0, "empty patch")`. Dates are `z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()`. Export `type X = z.infer<typeof X>` for each input under the same name. Export from `index.ts`.

- [ ] **Step 4: Run tests, expect pass. Step 5: Commit** `feat(core): domain schemas and permission check`

---

### Task 4: Database package

**Files:**
- Create: `packages/db/package.json`, `tsconfig.json`, `src/types.d.ts`, `src/open.ts`, `src/migrations.ts`, `src/config.ts`, `src/events.ts`, `src/actors.ts`, `src/projects.ts`, `src/tickets.ts`, `src/index.ts`
- Test: `packages/db/src/db.test.ts`

**Interfaces:**
- Consumes: core types, `hashEvent`, `GENESIS`, `DEFAULT_LANES`
- Produces:
  - `type DB = import("better-sqlite3").Database`
  - `openDatabase(file: string, keyHex: string | null): DB` (throws `Error("bad_key")` when the key is wrong), `migrate(db: DB): void`
  - `interface Config { kdfSalt: string; argon: ArgonParams; humanPublicKey: string; encryption: boolean }`, `readConfig(dir: string): Config | null`, `writeConfig(dir: string, c: Config): void`
  - `appendEvent(db, e: { actorId: string; type: string; payload: unknown; signature: string; now: string }): ChainEvent`, `listEvents(db, afterSeq?: number): ChainEvent[]`, `latestCheckpoint(db): { seq: number; headHash: string } | null`, `addCheckpoint(db, c: { seq: number; headHash: string; signature: string; now: string }): void`
  - `insertActor(db, a: Actor): void`, `getActor(db, id): Actor | undefined`, `listActors(db): Actor[]`, `setActorStatus(db, id, status, scopes: Scopes | null): void`, `touchActor(db, id, now): void`, `countPending(db): number`
  - `createProject(db, input: { name: string; key: string }, now: string): { project: Project; lanes: Lane[] }`, `listProjects(db): Project[]`, `getProject(db, id)`, `listLanes(db, projectId): Lane[]`, `getLane(db, id): Lane | undefined`
  - `createTicket(db, input: { projectId: string; title: string; laneId?: string; assigneeId?: string | null; metadata?: Record<string, unknown> }, now): Ticket`, `getTicket(db, id)`, `listTickets(db, f: { projectId?: string; laneId?: string; flag?: string }): Ticket[]`, `updateTicket(db, id, patch, now): Ticket`, `moveTicket(db, id, laneId, now): { ticket: Ticket; flagged: boolean }`, `setFlag(db, id, flag, on, now): Ticket`, `archiveTicket(db, id, now): Ticket`, `queue(db, projectId): { needsHuman: Ticket[]; active: Ticket[] }`

- [ ] **Step 1: Package files**

`package.json`:
```json
{ "name": "@boomerang/db", "version": "0.1.0", "private": true, "type": "module", "main": "src/index.ts", "types": "src/index.ts",
  "dependencies": { "@boomerang/core": "workspace:*", "better-sqlite3-multiple-ciphers": "^11.5.0" },
  "devDependencies": { "@types/better-sqlite3": "^7.6.11" } }
```
`src/types.d.ts`:
```ts
declare module "better-sqlite3-multiple-ciphers" { import D from "better-sqlite3"; export = D; }
```

- [ ] **Step 2: Write the failing test** `db.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyChain } from "@boomerang/core";
import * as d from "./index";

const NOW = "2026-09-21T10:00:00.000Z";
const KEY = "ab".repeat(32);
const fresh = (key: string | null = null) => { const dir = mkdtempSync(join(tmpdir(), "pan-")); const db = d.openDatabase(join(dir, "p.db"), key); d.migrate(db); return { dir, db }; };

describe("open", () => {
  it("refuses the wrong key and accepts the right one", () => {
    const { dir, db } = fresh(KEY); db.close();
    expect(() => d.openDatabase(join(dir, "p.db"), "cd".repeat(32))).toThrow("bad_key");
    expect(() => d.openDatabase(join(dir, "p.db"), null)).toThrow("bad_key");
    d.openDatabase(join(dir, "p.db"), KEY).close();
  });
  it("round trips config", () => {
    const { dir } = fresh();
    expect(d.readConfig(dir)).toBeNull();
    const c = { kdfSalt: "00".repeat(16), argon: { iterations: 1, memorySize: 1024, parallelism: 1 }, humanPublicKey: "11".repeat(32), encryption: true };
    d.writeConfig(dir, c);
    expect(d.readConfig(dir)).toEqual(c);
  });
});

describe("events", () => {
  it("chains appended events and refuses edits and deletes", () => {
    const { db } = fresh();
    d.appendEvent(db, { actorId: "human", type: "a", payload: { n: 1 }, signature: "s", now: NOW });
    d.appendEvent(db, { actorId: "human", type: "b", payload: { n: 2 }, signature: "s", now: NOW });
    expect(verifyChain(d.listEvents(db)).ok).toBe(true);
    expect(() => db.prepare("update events set type='x' where seq=1").run()).toThrow(/append-only/);
    expect(() => db.prepare("delete from events where seq=1").run()).toThrow(/append-only/);
  });
});

describe("projects and tickets", () => {
  it("creates a project with the six default lanes", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Boomerang", key: "PAN" }, NOW);
    expect(lanes.map((l) => l.name)).toEqual(["Backlog", "Ready", "In Progress", "Eval", "Ready for Production", "Done"]);
    expect(lanes[4].setsNeedsHuman).toBe(true);
    expect(d.listLanes(db, project.id)).toHaveLength(6);
  });
  it("numbers tickets per project, defaults to the first lane, and flags on entry to a needs-human lane", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Boomerang", key: "PAN" }, NOW);
    const t1 = d.createTicket(db, { projectId: project.id, title: "One" }, NOW);
    const t2 = d.createTicket(db, { projectId: project.id, title: "Two" }, NOW);
    expect([t1.key, t2.key, t1.laneId]).toEqual(["PAN-1", "PAN-2", lanes[0].id]);
    expect(d.moveTicket(db, t1.id, lanes[2].id, NOW).flagged).toBe(false);
    const moved = d.moveTicket(db, t1.id, lanes[4].id, NOW);
    expect(moved.flagged).toBe(true);
    expect(moved.ticket.flags).toContain("needs_human");
    expect(d.listTickets(db, { flag: "needs_human" }).map((t) => t.id)).toEqual([t1.id]);
  });
  it("builds the queue: needs-human first, then assigned work outside done lanes", () => {
    const { db } = fresh();
    d.insertActor(db, { id: "ag1", kind: "agent", name: "a", publicKey: "22".repeat(32), scopes: null, status: "active", lastSeen: null, createdAt: NOW });
    const { project, lanes } = d.createProject(db, { name: "P", key: "P" + "A" }, NOW);
    const a = d.createTicket(db, { projectId: project.id, title: "flagged" }, NOW);
    const b = d.createTicket(db, { projectId: project.id, title: "working", assigneeId: "ag1" }, NOW);
    const c = d.createTicket(db, { projectId: project.id, title: "finished", assigneeId: "ag1" }, NOW);
    d.createTicket(db, { projectId: project.id, title: "idle" }, NOW);
    d.setFlag(db, a.id, "needs_human", true, NOW);
    d.moveTicket(db, c.id, lanes[5].id, NOW);
    const q = d.queue(db, project.id);
    expect(q.needsHuman.map((t) => t.id)).toEqual([a.id]);
    expect(q.active.map((t) => t.id)).toEqual([b.id]);
  });
  it("patches, flags idempotently, and archives", () => {
    const { db } = fresh();
    const { project } = d.createProject(db, { name: "P", key: "PB" }, NOW);
    const t = d.createTicket(db, { projectId: project.id, title: "x" }, NOW);
    expect(d.updateTicket(db, t.id, { title: "y", metadata: { tokens: 5 } }, NOW)).toMatchObject({ title: "y", metadata: { tokens: 5 } });
    d.setFlag(db, t.id, "blocked", true, NOW);
    expect(d.setFlag(db, t.id, "blocked", true, NOW).flags).toEqual(["blocked"]);
    expect(d.setFlag(db, t.id, "blocked", false, NOW).flags).toEqual([]);
    d.archiveTicket(db, t.id, NOW);
    expect(d.listTickets(db, { projectId: project.id })).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run, confirm FAIL.**

- [ ] **Step 4: Implement**

`open.ts`:
```ts
import Database from "better-sqlite3-multiple-ciphers";
export type DB = import("better-sqlite3").Database;

export function openDatabase(file: string, keyHex: string | null): DB {
  const db = new Database(file) as DB;
  try {
    if (keyHex) {
      if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error("bad_key");
      db.pragma("cipher='sqlcipher'");
      db.pragma("legacy=4");
      db.pragma(`key="x'${keyHex}'"`);
    }
    db.prepare("select count(*) from sqlite_master").get();
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return db;
  } catch {
    db.close();
    throw new Error("bad_key");
  }
}
```
`migrations.ts`:
```ts
import type { DB } from "./open";
const M1 = `
create table actors(id text primary key, kind text not null check(kind in('human','agent')), name text not null, public_key text not null unique,
  scopes text, status text not null check(status in('pending','active','revoked')), last_seen text, created_at text not null);
create table projects(id text primary key, key text not null unique, name text not null, next_number integer not null default 1, created_at text not null);
create table lanes(id text primary key, project_id text not null references projects(id), name text not null, position integer not null, family text not null,
  sets_needs_human integer not null default 0, is_done integer not null default 0, evidence_requirements text not null default '[]');
create table tickets(id text primary key, project_id text not null references projects(id), number integer not null, title text not null,
  lane_id text not null references lanes(id), position real not null, flags text not null default '[]', assignee_id text references actors(id),
  start_date text, due_date text, metadata text not null default '{}', archived integer not null default 0, created_at text not null, updated_at text not null,
  unique(project_id, number));
create index tickets_lane on tickets(lane_id, position);
create table events(seq integer primary key, prev_hash text not null, hash text not null, actor_id text not null, type text not null,
  payload text not null, signature text not null, created_at text not null);
create trigger events_no_update before update on events begin select raise(abort, 'events are append-only'); end;
create trigger events_no_delete before delete on events begin select raise(abort, 'events are append-only'); end;
create table checkpoints(seq integer primary key, head_hash text not null, signature text not null, created_at text not null);
`;
const MIGRATIONS = [M1];
export function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) db.transaction(() => { db.exec(MIGRATIONS[i]); db.pragma(`user_version = ${i + 1}`); })();
}
```
`config.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArgonParams } from "@boomerang/core";
export interface Config { kdfSalt: string; argon: ArgonParams; humanPublicKey: string; encryption: boolean }
export function readConfig(dir: string): Config | null {
  const f = join(dir, "config.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Config) : null;
}
export function writeConfig(dir: string, c: Config): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, "config.json.tmp");
  writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  renameSync(tmp, join(dir, "config.json"));
}
```
`events.ts`:
```ts
import { GENESIS, hashEvent, type ChainEvent } from "@boomerang/core";
import type { DB } from "./open";
const toEvent = (r: any): ChainEvent => ({ seq: r.seq, prevHash: r.prev_hash, hash: r.hash, actorId: r.actor_id, type: r.type, payload: JSON.parse(r.payload), createdAt: r.created_at });

export function appendEvent(db: DB, e: { actorId: string; type: string; payload: unknown; signature: string; now: string }): ChainEvent {
  const last = db.prepare("select seq, hash from events order by seq desc limit 1").get() as { seq: number; hash: string } | undefined;
  // Normalise through JSON so the hashed payload equals what listEvents reads back.
  const payload = JSON.parse(JSON.stringify(e.payload ?? null));
  const base = { seq: (last?.seq ?? 0) + 1, prevHash: last?.hash ?? GENESIS, actorId: e.actorId, type: e.type, payload, createdAt: e.now };
  const ev = { ...base, hash: hashEvent(base) };
  db.prepare("insert into events(seq, prev_hash, hash, actor_id, type, payload, signature, created_at) values(?,?,?,?,?,?,?,?)")
    .run(ev.seq, ev.prevHash, ev.hash, ev.actorId, ev.type, JSON.stringify(payload), e.signature, ev.createdAt);
  return ev;
}
export const listEvents = (db: DB, afterSeq = 0): ChainEvent[] => db.prepare("select * from events where seq > ? order by seq").all(afterSeq).map(toEvent);
export function latestCheckpoint(db: DB): { seq: number; headHash: string } | null {
  const r = db.prepare("select seq, head_hash from checkpoints order by seq desc limit 1").get() as any;
  return r ? { seq: r.seq, headHash: r.head_hash } : null;
}
export const addCheckpoint = (db: DB, c: { seq: number; headHash: string; signature: string; now: string }): void => {
  db.prepare("insert or replace into checkpoints(seq, head_hash, signature, created_at) values(?,?,?,?)").run(c.seq, c.headHash, c.signature, c.now);
};
```
`actors.ts`:
```ts
import type { Actor, Scopes } from "@boomerang/core";
import type { DB } from "./open";
const toActor = (r: any): Actor => ({ id: r.id, kind: r.kind, name: r.name, publicKey: r.public_key, scopes: r.scopes ? JSON.parse(r.scopes) : null, status: r.status, lastSeen: r.last_seen, createdAt: r.created_at });
export const insertActor = (db: DB, a: Actor): void => { db.prepare("insert into actors(id, kind, name, public_key, scopes, status, last_seen, created_at) values(?,?,?,?,?,?,?,?)").run(a.id, a.kind, a.name, a.publicKey, a.scopes ? JSON.stringify(a.scopes) : null, a.status, a.lastSeen, a.createdAt); };
export const getActor = (db: DB, id: string): Actor | undefined => { const r = db.prepare("select * from actors where id = ?").get(id); return r ? toActor(r) : undefined; };
export const listActors = (db: DB): Actor[] => db.prepare("select * from actors order by created_at").all().map(toActor);
export const setActorStatus = (db: DB, id: string, status: Actor["status"], scopes: Scopes | null): void => { db.prepare("update actors set status = ?, scopes = ? where id = ?").run(status, scopes ? JSON.stringify(scopes) : null, id); };
export const touchActor = (db: DB, id: string, now: string): void => { db.prepare("update actors set last_seen = ? where id = ?").run(now, id); };
export const countPending = (db: DB): number => (db.prepare("select count(*) c from actors where status = 'pending'").get() as { c: number }).c;
```
`projects.ts`:
```ts
import { randomUUID } from "node:crypto";
import { DEFAULT_LANES, type Lane, type Project } from "@boomerang/core";
import type { DB } from "./open";
const toProject = (r: any): Project => ({ id: r.id, key: r.key, name: r.name, createdAt: r.created_at });
const toLane = (r: any): Lane => ({ id: r.id, projectId: r.project_id, name: r.name, position: r.position, family: r.family, setsNeedsHuman: !!r.sets_needs_human, isDone: !!r.is_done });
export function createProject(db: DB, input: { name: string; key: string }, now: string): { project: Project; lanes: Lane[] } {
  const id = randomUUID();
  db.prepare("insert into projects(id, key, name, created_at) values(?,?,?,?)").run(id, input.key, input.name, now);
  const ins = db.prepare("insert into lanes(id, project_id, name, position, family, sets_needs_human, is_done) values(?,?,?,?,?,?,?)");
  DEFAULT_LANES.forEach((l, i) => ins.run(randomUUID(), id, l.name, i, l.family, l.setsNeedsHuman ? 1 : 0, l.isDone ? 1 : 0));
  return { project: getProject(db, id)!, lanes: listLanes(db, id) };
}
export const listProjects = (db: DB): Project[] => db.prepare("select * from projects order by created_at").all().map(toProject);
export const getProject = (db: DB, id: string): Project | undefined => { const r = db.prepare("select * from projects where id = ?").get(id); return r ? toProject(r) : undefined; };
export const listLanes = (db: DB, projectId: string): Lane[] => db.prepare("select * from lanes where project_id = ? order by position").all(projectId).map(toLane);
export const getLane = (db: DB, id: string): Lane | undefined => { const r = db.prepare("select * from lanes where id = ?").get(id); return r ? toLane(r) : undefined; };
```
`tickets.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { Ticket } from "@boomerang/core";
import type { DB } from "./open";
import { getLane, listLanes } from "./projects";

const SELECT = "select t.*, p.key as project_key from tickets t join projects p on p.id = t.project_id";
const HAS_FLAG = "exists(select 1 from json_each(t.flags) where value = ?)";
const toTicket = (r: any): Ticket => ({ id: r.id, projectId: r.project_id, number: r.number, key: `${r.project_key}-${r.number}`, title: r.title, laneId: r.lane_id, position: r.position,
  flags: JSON.parse(r.flags), assigneeId: r.assignee_id, startDate: r.start_date, dueDate: r.due_date, metadata: JSON.parse(r.metadata), archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at });
const nextPosition = (db: DB, laneId: string): number => ((db.prepare("select max(position) m from tickets where lane_id = ?").get(laneId) as { m: number | null }).m ?? 0) + 1;

export const getTicket = (db: DB, id: string): Ticket | undefined => { const r = db.prepare(`${SELECT} where t.id = ?`).get(id); return r ? toTicket(r) : undefined; };

export function createTicket(db: DB, input: { projectId: string; title: string; laneId?: string; assigneeId?: string | null; metadata?: Record<string, unknown> }, now: string): Ticket {
  const laneId = input.laneId ?? listLanes(db, input.projectId)[0].id;
  const { n } = db.prepare("update projects set next_number = next_number + 1 where id = ? returning next_number - 1 as n").get(input.projectId) as { n: number };
  const id = randomUUID();
  db.prepare("insert into tickets(id, project_id, number, title, lane_id, position, assignee_id, metadata, created_at, updated_at) values(?,?,?,?,?,?,?,?,?,?)")
    .run(id, input.projectId, n, input.title, laneId, nextPosition(db, laneId), input.assigneeId ?? null, JSON.stringify(input.metadata ?? {}), now, now);
  return getTicket(db, id)!;
}

export function listTickets(db: DB, f: { projectId?: string; laneId?: string; flag?: string }): Ticket[] {
  const where = ["t.archived = 0"]; const args: unknown[] = [];
  if (f.projectId) { where.push("t.project_id = ?"); args.push(f.projectId); }
  if (f.laneId) { where.push("t.lane_id = ?"); args.push(f.laneId); }
  if (f.flag) { where.push(HAS_FLAG); args.push(f.flag); }
  return db.prepare(`${SELECT} where ${where.join(" and ")} order by t.lane_id, t.position`).all(...args).map(toTicket);
}

export function updateTicket(db: DB, id: string, patch: { title?: string; startDate?: string | null; dueDate?: string | null; assigneeId?: string | null; metadata?: Record<string, unknown> }, now: string): Ticket {
  const cols: Record<string, unknown> = {};
  if (patch.title !== undefined) cols.title = patch.title;
  if (patch.startDate !== undefined) cols.start_date = patch.startDate;
  if (patch.dueDate !== undefined) cols.due_date = patch.dueDate;
  if (patch.assigneeId !== undefined) cols.assignee_id = patch.assigneeId;
  if (patch.metadata !== undefined) cols.metadata = JSON.stringify(patch.metadata);
  cols.updated_at = now;
  const keys = Object.keys(cols);
  db.prepare(`update tickets set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`).run(...keys.map((k) => cols[k]), id);
  return getTicket(db, id)!;
}

export function setFlag(db: DB, id: string, flag: string, on: boolean, now: string): Ticket {
  const t = getTicket(db, id)!;
  const flags = on ? [...new Set([...t.flags, flag])] : t.flags.filter((f) => f !== flag);
  db.prepare("update tickets set flags = ?, updated_at = ? where id = ?").run(JSON.stringify(flags), now, id);
  return getTicket(db, id)!;
}

export function moveTicket(db: DB, id: string, laneId: string, now: string): { ticket: Ticket; flagged: boolean } {
  const lane = getLane(db, laneId)!;
  db.prepare("update tickets set lane_id = ?, position = ?, updated_at = ? where id = ?").run(laneId, nextPosition(db, laneId), now, id);
  const before = getTicket(db, id)!;
  const flagged = lane.setsNeedsHuman && !before.flags.includes("needs_human");
  return { ticket: flagged ? setFlag(db, id, "needs_human", true, now) : before, flagged };
}

export function archiveTicket(db: DB, id: string, now: string): Ticket {
  db.prepare("update tickets set archived = 1, updated_at = ? where id = ?").run(now, id);
  return getTicket(db, id)!;
}

export function queue(db: DB, projectId: string): { needsHuman: Ticket[]; active: Ticket[] } {
  const needsHuman = db.prepare(`${SELECT} where t.archived = 0 and t.project_id = ? and ${HAS_FLAG} order by t.updated_at desc, t.number desc`).all(projectId, "needs_human").map(toTicket);
  const active = db.prepare(`${SELECT} join lanes l on l.id = t.lane_id where t.archived = 0 and t.project_id = ? and t.assignee_id is not null and l.is_done = 0 and not ${HAS_FLAG} order by t.updated_at desc`).all(projectId, "needs_human").map(toTicket);
  return { needsHuman, active };
}
```
`index.ts`: `export * from` each of `open, migrations, config, events, actors, projects, tickets`.

- [ ] **Step 5: Run** `pnpm install && pnpm vitest run packages/db` Expected: all pass.
- [ ] **Step 6: Commit** `feat(db): encrypted sqlite, migrations, repositories, append-only events`

---

### Task 5: Server lifecycle (status, setup, unlock, lock)

**Files:**
- Create: `apps/server/package.json`, `tsconfig.json`, `src/errors.ts`, `src/context.ts`, `src/routes/lifecycle.ts`, `src/app.ts`, `src/main.ts`, `src/test/helpers.ts`
- Test: `apps/server/src/lifecycle.test.ts`

**Interfaces:**
- Produces:
  - `class HttpError extends Error { constructor(status: number, code: string, message: string, details?: unknown) }`
  - `interface Ctx { dataDir: string; db: DB | null; config: Config | null; now: () => Date; nonces: Map<string, number> }`
  - `buildApp(opts: { dataDir: string; now?: () => Date; webDist?: string }): Promise<FastifyInstance & { ctx: Ctx }>`
  - Routes (all under `/api/v1`): `GET /health` `{ok:true}`; `GET /status` returns `{state:"uninitialized"}` or `{state:"locked"|"unlocked", kdfSalt, argon, humanPublicKey, encryption}`; `POST /setup` (self signed with the key being registered, actor header `human`) returns `{ok:true}`; `POST /unlock {dbKey}` returns `{ok:true}`; `POST /lock` (human signed, wired in Task 6).
  - Test helpers: `tempDir(): string`, `humanKeys(): Promise<{seed, dbKeyHex, publicKeyHex}>` (password `test-password-123`, salt `"00".repeat(16)`, `ARGON_FAST`), `client(app, seed, actorId)` returning `(method, url, body?) => Promise<{status:number; json:any}>` that signs with `signRequest` and calls `app.inject`, `setupApp(encryption = true): Promise<{app, human, keys, dir}>` that builds an app, performs setup, and returns a human client.

- [ ] **Step 1: Package**

```json
{ "name": "@boomerang/server", "version": "0.1.0", "private": true, "type": "module",
  "scripts": { "dev": "tsx watch src/main.ts", "start": "tsx src/main.ts" },
  "dependencies": { "@boomerang/core": "workspace:*", "@boomerang/db": "workspace:*", "fastify": "^5.0.0", "@fastify/static": "^8.0.0", "zod": "^3.23.0" } }
```

- [ ] **Step 2: Write the failing test** `lifecycle.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ARGON_FAST, signRequest } from "@boomerang/core";
import { buildApp } from "./app";
import { humanKeys, tempDir } from "./test/helpers";

const SALT = "00".repeat(16);
async function doSetup(app: any, keys: any, encryption: boolean) {
  const body = JSON.stringify({ publicKey: keys.publicKeyHex, kdfSalt: SALT, argon: ARGON_FAST, encryption, dbKey: encryption ? keys.dbKeyHex : null });
  const headers = { ...(await signRequest(keys.seed, "human", "POST", "/api/v1/setup", body)), "content-type": "application/json" };
  return app.inject({ method: "POST", url: "/api/v1/setup", payload: body, headers });
}

describe("lifecycle", () => {
  it("starts uninitialized, sets up once, and reports unlocked", async () => {
    const app = await buildApp({ dataDir: tempDir() }); const keys = await humanKeys();
    expect((await app.inject("/api/v1/status")).json()).toEqual({ state: "uninitialized" });
    expect((await doSetup(app, keys, true)).statusCode).toBe(200);
    expect((await app.inject("/api/v1/status")).json()).toMatchObject({ state: "unlocked", humanPublicKey: keys.publicKeyHex, encryption: true, kdfSalt: SALT });
    expect((await doSetup(app, keys, true)).statusCode).toBe(409);
  });
  it("rejects a setup request not signed by the key it registers", async () => {
    const app = await buildApp({ dataDir: tempDir() }); const keys = await humanKeys();
    const body = JSON.stringify({ publicKey: "11".repeat(32), kdfSalt: SALT, argon: ARGON_FAST, encryption: false, dbKey: null });
    const headers = { ...(await signRequest(keys.seed, "human", "POST", "/api/v1/setup", body)), "content-type": "application/json" };
    expect((await app.inject({ method: "POST", url: "/api/v1/setup", payload: body, headers })).statusCode).toBe(401);
  });
  it("comes back locked after restart when encrypted, and unlocks only with the right key", async () => {
    const dir = tempDir(); const keys = await humanKeys();
    const first = await buildApp({ dataDir: dir }); await doSetup(first, keys, true); await first.close();
    const app = await buildApp({ dataDir: dir });
    expect((await app.inject("/api/v1/status")).json().state).toBe("locked");
    const locked = await app.inject("/api/v1/projects");
    expect(locked.statusCode).toBe(423);
    expect(locked.headers["retry-after"]).toBe("30");
    expect((await app.inject({ method: "POST", url: "/api/v1/unlock", payload: { dbKey: "cd".repeat(32) } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/unlock", payload: { dbKey: keys.dbKeyHex } })).statusCode).toBe(200);
    expect((await app.inject("/api/v1/status")).json().state).toBe("unlocked");
  });
  it("opens without a key after restart when encryption is off", async () => {
    const dir = tempDir(); const keys = await humanKeys();
    const first = await buildApp({ dataDir: dir }); await doSetup(first, keys, false); await first.close();
    expect((await (await buildApp({ dataDir: dir })).inject("/api/v1/status")).json().state).toBe("unlocked");
  });
});
```

- [ ] **Step 3: Run, confirm FAIL.**

- [ ] **Step 4: Implement**

`errors.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
export class HttpError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "validation", message: "Invalid request", details: err.issues } });
    if ((err as any).statusCode === 400) return reply.status(400).send({ error: { code: "bad_json", message: "Body is not valid JSON" } });
    app.log.error(err);
    return reply.status(500).send({ error: { code: "internal", message: "Unexpected error" } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "not_found", message: "No such route" } }));
}
```
`context.ts`:
```ts
import type { Config, DB } from "@boomerang/db";
export interface Ctx { dataDir: string; db: DB | null; config: Config | null; now: () => Date; nonces: Map<string, number> }
```
`routes/lifecycle.ts`:
```ts
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { SetupInput, UnlockInput, verifyRequest } from "@boomerang/core";
import { appendEvent, insertActor, migrate, openDatabase, writeConfig } from "@boomerang/db";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export const dbFile = (ctx: Ctx) => join(ctx.dataDir, "panorama.db");

export function lifecycleRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/api/v1/health", async () => ({ ok: true }));

  app.get("/api/v1/status", async () => {
    if (!ctx.config) return { state: "uninitialized" };
    const { kdfSalt, argon, humanPublicKey, encryption } = ctx.config;
    return { state: ctx.db ? "unlocked" : "locked", kdfSalt, argon, humanPublicKey, encryption };
  });

  app.post("/api/v1/setup", async (req) => {
    if (ctx.config) throw new HttpError(409, "already_setup", "Boomerang is already set up");
    const input = SetupInput.parse(req.body);
    if (input.encryption !== (input.dbKey !== null)) throw new HttpError(400, "validation", "dbKey must be present exactly when encryption is on");
    const ok = await verifyRequest(input.publicKey, req.headers as any, "POST", req.url, (req as any).rawBody ?? "", ctx.now().getTime());
    if (!ok) throw new HttpError(401, "bad_signature", "Setup must be signed by the key it registers");
    const db = openDatabase(dbFile(ctx), input.dbKey);
    migrate(db);
    const now = ctx.now().toISOString();
    db.transaction(() => {
      insertActor(db, { id: "human", kind: "human", name: "Owner", publicKey: input.publicKey, scopes: null, status: "active", lastSeen: now, createdAt: now });
      appendEvent(db, { actorId: "human", type: "system.setup", payload: { encryption: input.encryption }, signature: String(req.headers["x-pan-sig"]), now });
    })();
    const config = { kdfSalt: input.kdfSalt, argon: input.argon, humanPublicKey: input.publicKey, encryption: input.encryption };
    writeConfig(ctx.dataDir, config);
    ctx.config = config; ctx.db = db;
    return { ok: true };
  });

  app.post("/api/v1/unlock", async (req) => {
    if (!ctx.config) throw new HttpError(409, "not_setup", "Boomerang is not set up");
    if (ctx.db) return { ok: true };
    const { dbKey } = UnlockInput.parse(req.body);
    try { ctx.db = openDatabase(dbFile(ctx), dbKey); } catch { throw new HttpError(401, "bad_key", "That key does not open this database"); }
    migrate(ctx.db);
    return { ok: true };
  });
}
```
`app.ts`:
```ts
import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { migrate, openDatabase, readConfig } from "@boomerang/db";
import type { Ctx } from "./context";
import { installErrorHandler } from "./errors";
import { dbFile, lifecycleRoutes } from "./routes/lifecycle";

export async function buildApp(opts: { dataDir: string; now?: () => Date; webDist?: string }) {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  const ctx: Ctx = { dataDir: opts.dataDir, db: null, config: readConfig(opts.dataDir), now: opts.now ?? (() => new Date()), nonces: new Map() };
  if (ctx.config && !ctx.config.encryption) { ctx.db = openDatabase(dbFile(ctx), null); migrate(ctx.db); }

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as any).rawBody = body as string;
    try { done(null, body ? JSON.parse(body as string) : {}); } catch (e: any) { e.statusCode = 400; done(e); }
  });
  installErrorHandler(app);

  const OPEN = new Set(["/api/v1/health", "/api/v1/status", "/api/v1/setup", "/api/v1/unlock"]);
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || OPEN.has(path)) return;
    if (!ctx.db) return reply.status(423).header("retry-after", "30").send({ error: { code: "locked", message: "Boomerang is locked" } });
  });

  lifecycleRoutes(app, ctx);
  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist });
    app.setNotFoundHandler((req, reply) => req.url.startsWith("/api/") ? reply.status(404).send({ error: { code: "not_found", message: "No such route" } }) : reply.sendFile("index.html"));
  }
  app.addHook("onClose", async () => { ctx.db?.close(); ctx.db = null; });
  return Object.assign(app, { ctx });
}
```
`main.ts`:
```ts
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";
const dataDir = process.env.BOOMERANG_DATA_DIR ?? join(homedir(), ".boomerang");
const webDist = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist");
const app = await buildApp({ dataDir, webDist });
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 4400) });
console.log(`Boomerang on http://127.0.0.1:${process.env.PORT ?? 4400} (data: ${dataDir})`);
```
`test/helpers.ts`:
```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARGON_FAST, deriveKeys, signRequest } from "@boomerang/core";
import { buildApp } from "../app";

export const tempDir = () => mkdtempSync(join(tmpdir(), "bm-srv-"));
export const humanKeys = () => deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST);

export function client(app: any, seed: Uint8Array, actorId: string) {
  return async (method: string, url: string, body?: unknown) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = { ...(await signRequest(seed, actorId, method, url, payload)) };
    if (payload) headers["content-type"] = "application/json";
    const res = await app.inject({ method, url, payload: payload || undefined, headers });
    return { status: res.statusCode, json: res.body ? res.json() : null };
  };
}

export async function setupApp(encryption = true) {
  const dir = tempDir(); const app = await buildApp({ dataDir: dir }); const keys = await humanKeys();
  const human = client(app, keys.seed, "human");
  const res = await human("POST", "/api/v1/setup", { publicKey: keys.publicKeyHex, kdfSalt: "00".repeat(16), argon: ARGON_FAST, encryption, dbKey: encryption ? keys.dbKeyHex : null });
  if (res.status !== 200) throw new Error(`setup failed: ${JSON.stringify(res.json)}`);
  return { app, human, keys, dir };
}
```
The 423 test requests `/api/v1/projects`, which has no route yet; the `onRequest` hook answers before routing, so the test is valid now.

- [ ] **Step 5: Run** `pnpm install && pnpm vitest run apps/server` Expected: 4 passed.
- [ ] **Step 6: Commit** `feat(server): setup, unlock, locked state`

---

### Task 6: Authentication and agents

**Files:**
- Create: `apps/server/src/auth.ts`, `apps/server/src/routes/agents.ts`; Modify: `apps/server/src/app.ts`, `apps/server/src/routes/lifecycle.ts`
- Test: `apps/server/src/agents.test.ts`

**Interfaces:**
- Consumes: `verifyRequest`, `can`, actor repository, `Ctx`
- Produces:
  - `installAuth(app, ctx, openPaths: Set<string>)`: a `preHandler` hook that sets `req.actor: Actor` and `req.sig: string`. Failures: missing or unknown actor 401 `unknown_actor`; bad signature or stale timestamp 401 `bad_signature`; reused nonce 401 `replay`; pending 403 `pending`; revoked 403 `revoked`.
  - `requireCan(req, action: Action, projectId?: string): void` throws 403 `forbidden`.
  - `getDb(ctx): DB` throws 423 if locked.
  - Routes: `POST /api/v1/agents/register` (unsigned, open) returns `{id, status:"pending"}` and 429 `too_many_pending` when 20 are pending; `GET /api/v1/agents` (human only) returns `Actor[]` of kind agent; `POST /api/v1/agents/:id/approve {scopes}`; `POST /api/v1/agents/:id/revoke`; `GET /api/v1/me` returns the calling actor; `POST /api/v1/lock` (human) closes the database when encryption is on, 409 `not_encrypted` otherwise.
  - Event types: `agent.registered`, `agent.approved`, `agent.revoked`, `system.locked`.

- [ ] **Step 1: Write the failing test** `agents.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, signRequest } from "@boomerang/core";
import { client, setupApp } from "./test/helpers";

const agentKeys = () => deriveKeys("agent-secret-xyz", "11".repeat(16), ARGON_FAST);

describe("auth", () => {
  it("rejects unsigned, unknown, and replayed requests", async () => {
    const { app, keys } = await setupApp();
    expect((await app.inject("/api/v1/me")).statusCode).toBe(401);
    const stranger = client(app, keys.seed, "nobody");
    expect((await stranger("GET", "/api/v1/me")).json.error.code).toBe("unknown_actor");
    const headers = await signRequest(keys.seed, "human", "GET", "/api/v1/me", "");
    expect((await app.inject({ method: "GET", url: "/api/v1/me", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/me", headers })).json().error.code).toBe("replay");
  });
});

describe("agents", () => {
  it("registers pending, cannot act until approved, acts after, stops after revoke", async () => {
    const { app, human } = await setupApp(); const ak = await agentKeys();
    const reg = await app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "claude-worker-1", publicKey: ak.publicKeyHex } });
    expect(reg.statusCode).toBe(200);
    const id = reg.json().id; const agent = client(app, ak.seed, id);
    expect((await agent("GET", "/api/v1/me")).json.error.code).toBe("pending");
    expect((await agent("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: "*", actions: ["read"] } })).status).toBe(403);
    expect((await human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: "*", actions: ["read"] } })).status).toBe(200);
    expect((await agent("GET", "/api/v1/me")).json).toMatchObject({ id, status: "active" });
    expect((await agent("GET", "/api/v1/agents")).status).toBe(403);
    expect((await human("GET", "/api/v1/agents")).json).toHaveLength(1);
    expect((await human("POST", `/api/v1/agents/${id}/revoke`)).status).toBe(200);
    expect((await agent("GET", "/api/v1/me")).json.error.code).toBe("revoked");
  });
  it("refuses a duplicate public key", async () => {
    const { app } = await setupApp(); const ak = await agentKeys();
    const payload = { name: "a", publicKey: ak.publicKeyHex };
    await app.inject({ method: "POST", url: "/api/v1/agents/register", payload });
    expect((await app.inject({ method: "POST", url: "/api/v1/agents/register", payload })).statusCode).toBe(409);
  });
  it("locks on request from the human only", async () => {
    const { app, human } = await setupApp(true);
    expect((await human("POST", "/api/v1/lock")).status).toBe(200);
    expect((await app.inject("/api/v1/status")).json().state).toBe("locked");
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement**

`auth.ts`:
```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { can, verifyRequest, type Action, type Actor } from "@boomerang/core";
import { getActor, touchActor, type DB } from "@boomerang/db";
import type { Ctx } from "./context";
import { HttpError } from "./errors";

declare module "fastify" { interface FastifyRequest { actor: Actor; sig: string } }

export function getDb(ctx: Ctx): DB {
  if (!ctx.db) throw new HttpError(423, "locked", "Boomerang is locked");
  return ctx.db;
}

export function requireCan(req: FastifyRequest, action: Action, projectId?: string): void {
  if (!can(req.actor, action, projectId)) throw new HttpError(403, "forbidden", `This key may not perform ${action}`);
}

export function installAuth(app: FastifyInstance, ctx: Ctx, openPaths: Set<string>): void {
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || openPaths.has(path)) return;
    const db = getDb(ctx);
    const actor = getActor(db, String(req.headers["x-pan-actor"] ?? ""));
    if (!actor) throw new HttpError(401, "unknown_actor", "Unknown actor");
    const nowMs = ctx.now().getTime();
    const ok = await verifyRequest(actor.publicKey, req.headers as any, req.method, req.url, (req as any).rawBody ?? "", nowMs);
    if (!ok) throw new HttpError(401, "bad_signature", "Signature check failed");
    const nonce = `${actor.id}:${req.headers["x-pan-nonce"]}`;
    for (const [k, exp] of ctx.nonces) if (exp < nowMs) ctx.nonces.delete(k);
    if (ctx.nonces.has(nonce)) throw new HttpError(401, "replay", "Nonce already used");
    ctx.nonces.set(nonce, nowMs + 120_000);
    if (actor.status === "pending") throw new HttpError(403, "pending", "This agent key is waiting for approval");
    if (actor.status === "revoked") throw new HttpError(403, "revoked", "This agent key was revoked");
    touchActor(db, actor.id, ctx.now().toISOString());
    req.actor = actor; req.sig = String(req.headers["x-pan-sig"]);
  });
}
```
`routes/agents.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ApproveAgentInput, RegisterAgentInput } from "@boomerang/core";
import { appendEvent, countPending, getActor, insertActor, listActors, setActorStatus } from "@boomerang/db";
import { getDb, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export function agentRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.post("/api/v1/agents/register", async (req) => {
    const db = getDb(ctx); const input = RegisterAgentInput.parse(req.body);
    if (countPending(db) >= 20) throw new HttpError(429, "too_many_pending", "Too many agent keys are waiting for approval");
    if (listActors(db).some((a) => a.publicKey === input.publicKey)) throw new HttpError(409, "duplicate_key", "That public key is already registered");
    const id = randomUUID(); const now = ctx.now().toISOString();
    db.transaction(() => {
      insertActor(db, { id, kind: "agent", name: input.name, publicKey: input.publicKey, scopes: null, status: "pending", lastSeen: null, createdAt: now });
      appendEvent(db, { actorId: id, type: "agent.registered", payload: { id, name: input.name, publicKey: input.publicKey }, signature: "", now });
    })();
    return { id, status: "pending" };
  });

  app.get("/api/v1/me", async (req) => req.actor);

  app.get("/api/v1/agents", async (req) => { requireCan(req, "agent.approve"); return listActors(getDb(ctx)).filter((a) => a.kind === "agent"); });

  const change = (type: "agent.approved" | "agent.revoked") => async (req: any) => {
    requireCan(req, type === "agent.approved" ? "agent.approve" : "agent.revoke");
    const db = getDb(ctx); const id = req.params.id as string; const target = getActor(db, id);
    if (!target || target.kind !== "agent") throw new HttpError(404, "not_found", "No such agent");
    const scopes = type === "agent.approved" ? ApproveAgentInput.parse(req.body).scopes : null;
    db.transaction(() => {
      setActorStatus(db, id, type === "agent.approved" ? "active" : "revoked", scopes);
      appendEvent(db, { actorId: req.actor.id, type, payload: { id, scopes }, signature: req.sig, now: ctx.now().toISOString() });
    })();
    return getActor(db, id);
  };
  app.post("/api/v1/agents/:id/approve", change("agent.approved"));
  app.post("/api/v1/agents/:id/revoke", change("agent.revoked"));
}
```
In `lifecycle.ts` add:
```ts
  app.post("/api/v1/lock", async (req) => {
    requireCan(req, "lock");
    if (!ctx.config?.encryption) throw new HttpError(409, "not_encrypted", "Locking needs encryption to be on");
    appendEvent(getDb(ctx), { actorId: req.actor.id, type: "system.locked", payload: {}, signature: req.sig, now: ctx.now().toISOString() });
    ctx.db!.close(); ctx.db = null;
    return { ok: true };
  });
```
(import `requireCan`, `getDb` from `../auth`).
In `app.ts`: add `"/api/v1/agents/register"` to `OPEN`, call `installAuth(app, ctx, OPEN)` after the `onRequest` hook, and `agentRoutes(app, ctx)` after `lifecycleRoutes`.

- [ ] **Step 4: Run** `pnpm vitest run apps/server` Expected: all pass, including Task 5 tests.
- [ ] **Step 5: Commit** `feat(server): signed requests, replay guard, agent registration and approval`

---

### Task 7: Projects, tickets, queue

**Files:**
- Create: `apps/server/src/routes/projects.ts`, `apps/server/src/routes/tickets.ts`; Modify: `app.ts`
- Test: `apps/server/src/tickets.test.ts`

**Interfaces:**
- Produces routes:
  - `GET /api/v1/projects` (`read`), `POST /api/v1/projects {name,key}` (`project.create`) returns `{project, lanes}`, 409 `duplicate_key` on a used key, `GET /api/v1/projects/:id/lanes` (`read` in that project)
  - `GET /api/v1/tickets?projectId=&laneId=&flag=` (`read`; agents with a project list see only those projects), `POST /api/v1/tickets` (`ticket.create`; an agent creator becomes assignee), `GET /api/v1/tickets/:id`, `PATCH /api/v1/tickets/:id` (`ticket.update`), `POST /api/v1/tickets/:id/move {laneId}` (`ticket.move`; lane must belong to the ticket's project else 400 `wrong_project`; an agent mover becomes assignee when none is set), `POST /api/v1/tickets/:id/flags {flag,on}` (`flag.set`, except clearing `needs_human` needs `flag.clear_needs_human`), `POST /api/v1/tickets/:id/archive` (`ticket.archive`)
  - `GET /api/v1/queue?projectId=` (`read`) returns `{needsHuman, active}`
  - Event types: `project.created`, `ticket.created`, `ticket.updated`, `ticket.moved` (`{id, from, to}`), `ticket.flag_set`, `ticket.flag_cleared` (`{id, flag, cause: "actor"|"lane"}`), `ticket.archived`

- [ ] **Step 1: Write the failing test** `tickets.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, verifyChain } from "@boomerang/core";
import { listEvents } from "@boomerang/db";
import { client, setupApp } from "./test/helpers";

async function world() {
  const s = await setupApp();
  const { project, lanes } = (await s.human("POST", "/api/v1/projects", { name: "Boomerang", key: "PAN" })).json;
  const ak = await deriveKeys("agent-secret-xyz", "11".repeat(16), ARGON_FAST);
  const id = (await s.app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker", publicKey: ak.publicKeyHex } })).json().id;
  await s.human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: [project.id], actions: ["read", "ticket.create", "ticket.update", "ticket.move", "flag.set"] } });
  return { ...s, project, lanes, agent: client(s.app, ak.seed, id), agentId: id };
}

describe("tickets", () => {
  it("runs the milestone story: agent creates and moves, lane flags it, human clears it", async () => {
    const w = await world();
    const t = (await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Ship the thing" })).json;
    expect(t).toMatchObject({ key: "PAN-1", assigneeId: w.agentId });
    const rfp = w.lanes.find((l: any) => l.name === "Ready for Production");
    const moved = (await w.agent("POST", `/api/v1/tickets/${t.id}/move`, { laneId: rfp.id })).json;
    expect(moved.flags).toEqual(["needs_human"]);
    expect((await w.human("GET", `/api/v1/queue?projectId=${w.project.id}`)).json.needsHuman.map((x: any) => x.id)).toEqual([t.id]);
    expect((await w.agent("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "needs_human", on: false })).status).toBe(403);
    expect((await w.human("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "needs_human", on: false })).json.flags).toEqual([]);
    const types = listEvents(w.app.ctx.db!).map((e) => e.type);
    expect(types).toEqual(["system.setup", "project.created", "agent.registered", "agent.approved", "ticket.created", "ticket.moved", "ticket.flag_set", "ticket.flag_cleared"]);
    expect(verifyChain(listEvents(w.app.ctx.db!)).ok).toBe(true);
  });
  it("keeps agents inside their scopes", async () => {
    const w = await world();
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    expect((await w.agent("POST", "/api/v1/tickets", { projectId: other.project.id, title: "x" })).status).toBe(403);
    expect((await w.agent("POST", "/api/v1/projects", { name: "Mine", key: "MINE" })).status).toBe(403);
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "y" })).json;
    expect((await w.agent("POST", `/api/v1/tickets/${t.id}/archive`)).status).toBe(403);
    expect((await w.agent("GET", "/api/v1/tickets")).json.every((x: any) => x.projectId === w.project.id)).toBe(true);
  });
  it("validates input and reports missing things", async () => {
    const w = await world();
    expect((await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "" })).status).toBe(400);
    expect((await w.human("GET", "/api/v1/tickets/nope")).status).toBe(404);
    expect((await w.human("POST", "/api/v1/projects", { name: "Dup", key: "PAN" })).status).toBe(409);
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "z" })).json;
    expect((await w.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: other.lanes[0].id })).json.error.code).toBe("wrong_project");
    expect((await w.human("PATCH", `/api/v1/tickets/${t.id}`, {})).status).toBe(400);
    expect((await w.human("PATCH", `/api/v1/tickets/${t.id}`, { metadata: { tokens: 1200 } })).json.metadata).toEqual({ tokens: 1200 });
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement**

`routes/projects.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { CreateProjectInput } from "@boomerang/core";
import { appendEvent, createProject, getProject, listLanes, listProjects } from "@boomerang/db";
import { getDb, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export function projectRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/api/v1/projects", async (req) => {
    requireCan(req, "read");
    const scopes = req.actor.scopes;
    return listProjects(getDb(ctx)).filter((p) => req.actor.kind === "human" || scopes?.projects === "*" || (scopes?.projects as string[]).includes(p.id));
  });
  app.post("/api/v1/projects", async (req) => {
    requireCan(req, "project.create");
    const db = getDb(ctx); const input = CreateProjectInput.parse(req.body);
    if (listProjects(db).some((p) => p.key === input.key)) throw new HttpError(409, "duplicate_key", "That project key is taken");
    return db.transaction(() => {
      const out = createProject(db, input, ctx.now().toISOString());
      appendEvent(db, { actorId: req.actor.id, type: "project.created", payload: { id: out.project.id, key: input.key, name: input.name }, signature: req.sig, now: ctx.now().toISOString() });
      return out;
    })();
  });
  app.get("/api/v1/projects/:id/lanes", async (req: any) => {
    const db = getDb(ctx);
    if (!getProject(db, req.params.id)) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "read", req.params.id);
    return listLanes(db, req.params.id);
  });
}
```
`routes/tickets.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { CreateTicketInput, FlagInput, MoveTicketInput, UpdateTicketInput } from "@boomerang/core";
import { appendEvent, archiveTicket, createTicket, getLane, getProject, getTicket, listTickets, moveTicket, queue, setFlag, updateTicket, type DB } from "@boomerang/db";
import { getDb, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export function ticketRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const load = (db: DB, id: string) => { const t = getTicket(db, id); if (!t || t.archived) throw new HttpError(404, "not_found", "No such ticket"); return t; };
  const log = (db: DB, req: any, type: string, payload: unknown) => appendEvent(db, { actorId: req.actor.id, type, payload, signature: req.sig, now: iso() });

  app.get("/api/v1/tickets", async (req: any) => {
    const { projectId, laneId, flag } = req.query as Record<string, string | undefined>;
    requireCan(req, "read", projectId);
    const scopes = req.actor.scopes;
    return listTickets(getDb(ctx), { projectId, laneId, flag }).filter((t) => req.actor.kind === "human" || scopes?.projects === "*" || (scopes?.projects as string[]).includes(t.projectId));
  });

  app.get("/api/v1/queue", async (req: any) => {
    const projectId = String(req.query.projectId ?? "");
    const db = getDb(ctx);
    if (!getProject(db, projectId)) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "read", projectId);
    return queue(db, projectId);
  });

  app.post("/api/v1/tickets", async (req) => {
    const db = getDb(ctx); const input = CreateTicketInput.parse(req.body);
    if (!getProject(db, input.projectId)) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "ticket.create", input.projectId);
    if (input.laneId && getLane(db, input.laneId)?.projectId !== input.projectId) throw new HttpError(400, "wrong_project", "That lane belongs to another project");
    return db.transaction(() => {
      const t = createTicket(db, { ...input, assigneeId: req.actor.kind === "agent" ? req.actor.id : null }, iso());
      log(db, req, "ticket.created", { id: t.id, key: t.key, title: t.title, laneId: t.laneId });
      return t;
    })();
  });

  app.get("/api/v1/tickets/:id", async (req: any) => { const t = load(getDb(ctx), req.params.id); requireCan(req, "read", t.projectId); return t; });

  app.patch("/api/v1/tickets/:id", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "ticket.update", t.projectId);
    const patch = UpdateTicketInput.parse(req.body);
    return db.transaction(() => { const out = updateTicket(db, t.id, patch, iso()); log(db, req, "ticket.updated", { id: t.id, patch }); return out; })();
  });

  app.post("/api/v1/tickets/:id/move", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "ticket.move", t.projectId);
    const { laneId } = MoveTicketInput.parse(req.body); const lane = getLane(db, laneId);
    if (!lane) throw new HttpError(404, "not_found", "No such lane");
    if (lane.projectId !== t.projectId) throw new HttpError(400, "wrong_project", "That lane belongs to another project");
    return db.transaction(() => {
      if (req.actor.kind === "agent" && !t.assigneeId) updateTicket(db, t.id, { assigneeId: req.actor.id }, iso());
      const { ticket, flagged } = moveTicket(db, t.id, laneId, iso());
      log(db, req, "ticket.moved", { id: t.id, from: t.laneId, to: laneId });
      if (flagged) log(db, req, "ticket.flag_set", { id: t.id, flag: "needs_human", cause: "lane" });
      return ticket;
    })();
  });

  app.post("/api/v1/tickets/:id/flags", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); const { flag, on } = FlagInput.parse(req.body);
    requireCan(req, flag === "needs_human" && !on ? "flag.clear_needs_human" : "flag.set", t.projectId);
    return db.transaction(() => { const out = setFlag(db, t.id, flag, on, iso()); log(db, req, on ? "ticket.flag_set" : "ticket.flag_cleared", { id: t.id, flag, cause: "actor" }); return out; })();
  });

  app.post("/api/v1/tickets/:id/archive", async (req: any) => {
    const db = getDb(ctx); const t = load(db, req.params.id); requireCan(req, "ticket.archive", t.projectId);
    return db.transaction(() => { const out = archiveTicket(db, t.id, iso()); log(db, req, "ticket.archived", { id: t.id }); return out; })();
  });
}
```
Register both in `app.ts` after `agentRoutes`.

- [ ] **Step 4: Run** `pnpm vitest run apps/server` Expected: all pass.
- [ ] **Step 5: Commit** `feat(server): projects, tickets, queue, lane-set needs human, scoped agents`

---

### Task 8: Chain verification and checkpoints

**Files:**
- Create: `apps/server/src/routes/chain.ts`; Modify: `app.ts`
- Test: `apps/server/src/chain.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/chain/verify` (human) returns `{ok:true, head, seq, checkpointSeq}` or `{ok:false, brokenAt}`. It verifies the whole chain in M1 (checkpoint-relative verification arrives with export in milestone 5). `POST /api/v1/checkpoints {headHash, signature}` (`checkpoint.create`): server checks `headHash` equals the current head and `verifyText(humanPublicKey, headHash, signature)`, else 400 `bad_checkpoint`; stores it at the current seq. Checkpoints do not append an event.

- [ ] **Step 1: Write the failing test** `chain.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { signText } from "@boomerang/core";
import { latestCheckpoint } from "@boomerang/db";
import { setupApp } from "./test/helpers";

describe("chain", () => {
  it("verifies, accepts a signed checkpoint, rejects a forged one", async () => {
    const { app, human, keys } = await setupApp();
    await human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const v = (await human("GET", "/api/v1/chain/verify")).json;
    expect(v).toMatchObject({ ok: true, seq: 2 });
    expect((await human("POST", "/api/v1/checkpoints", { headHash: v.head, signature: "00".repeat(64) })).status).toBe(400);
    expect((await human("POST", "/api/v1/checkpoints", { headHash: v.head, signature: await signText(keys.seed, v.head) })).status).toBe(200);
    expect(latestCheckpoint(app.ctx.db!)).toEqual({ seq: 2, headHash: v.head });
  });
  it("reports direct database tampering", async () => {
    const { app, human } = await setupApp();
    await human("POST", "/api/v1/projects", { name: "P", key: "PP" });
    const db = app.ctx.db!;
    db.exec("drop trigger events_no_update");
    db.prepare("update events set payload = '{\"id\":\"x\"}' where seq = 2").run();
    expect((await human("GET", "/api/v1/chain/verify")).json).toEqual({ ok: false, brokenAt: 2 });
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement** `routes/chain.ts`

```ts
import type { FastifyInstance } from "fastify";
import { CheckpointInput, verifyChain, verifyText } from "@boomerang/core";
import { addCheckpoint, latestCheckpoint, listEvents } from "@boomerang/db";
import { getDb, requireCan } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export function chainRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/api/v1/chain/verify", async (req) => {
    requireCan(req, "checkpoint.create");
    const db = getDb(ctx); const events = listEvents(db); const result = verifyChain(events);
    if (!result.ok) return result;
    return { ok: true, head: result.head, seq: events.length ? events[events.length - 1].seq : 0, checkpointSeq: latestCheckpoint(db)?.seq ?? null };
  });
  app.post("/api/v1/checkpoints", async (req) => {
    requireCan(req, "checkpoint.create");
    const db = getDb(ctx); const input = CheckpointInput.parse(req.body);
    const events = listEvents(db); const result = verifyChain(events);
    if (!result.ok || result.head !== input.headHash || !(await verifyText(ctx.config!.humanPublicKey, input.headHash, input.signature)))
      throw new HttpError(400, "bad_checkpoint", "Checkpoint does not match the verified chain head");
    addCheckpoint(db, { seq: events[events.length - 1].seq, headHash: input.headHash, signature: input.signature, now: ctx.now().toISOString() });
    return { ok: true };
  });
}
```
Register in `app.ts`.

- [ ] **Step 4: Run all tests** `pnpm test` Expected: all pass.
- [ ] **Step 5: Commit** `feat(server): chain verification and signed checkpoints`

---

### Task 9: Web scaffold, tokens, session, signed API client

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/vite-env.d.ts` (one line: `/// <reference types="vite/client" />`), `src/main.tsx`, `src/App.tsx`, `src/styles/tokens.css`, `src/styles/app.css`, `src/lib/families.ts`, `src/lib/session.ts`, `src/lib/api.ts`
- Test: `apps/web/src/lib/api.test.ts` (add `"apps/web"` to `vitest.workspace.ts`)

**Interfaces:**
- Produces:
  - `FAMILY: Record<Family, { top: string; left: string; right: string; ink: string }>` with the exact values from `BRAND.md`
  - `session`: `setSeed(seed: Uint8Array): void`, `getSeed(): Uint8Array | null`, `clear(): void`, `subscribe(fn: () => void): () => void` (module memory only, never storage)
  - `class ApiError extends Error { status: number; code: string }`, `api<T>(method: string, path: string, body?: unknown): Promise<T>` (signs as `human` when a seed is present; on 423 or 401 `bad_signature` it clears the session)
  - `App` state machine: fetch `/api/v1/status`; `uninitialized` or no seed gives `<LockScreen>`; otherwise `<Shell>`. Task 9 renders placeholders `Lock` and `Unlocked` text only; Tasks 10 to 12 replace them.

- [ ] **Step 1: Package and config**

```json
{ "name": "@boomerang/web", "version": "0.1.0", "private": true, "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -p . && vite build" },
  "dependencies": { "@boomerang/core": "workspace:*", "react": "^18.3.0", "react-dom": "^18.3.0", "react-router-dom": "^6.26.0", "@tanstack/react-query": "^5.56.0",
    "@phosphor-icons/react": "^2.1.7", "@fontsource/figtree": "^5.1.0", "@fontsource/jetbrains-mono": "^5.1.0" },
  "devDependencies": { "vite": "^5.4.0", "@vitejs/plugin-react": "^4.3.0", "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0" } }
```
`vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({ plugins: [react()], server: { port: 4401, proxy: { "/api": "http://127.0.0.1:4400" } } });
```
`index.html`: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Boomerang</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`

`src/styles/tokens.css` (values exact, from `BRAND.md`):
```css
:root{
  --bg:#FAFBFC;--surface:#FFFFFF;--line:#E3E7EE;--text:#1B2230;--muted:#5D6778;--accent:#12706A;--on-accent:#F3FFFC;
  --coral-top:#FFD3C9;--coral-left:#F7A999;--coral-right:#E98672;--coral-ink:#8A2A17;
  --sky-top:#CFE6FB;--sky-left:#A3CDF3;--sky-right:#7FB3E6;--sky-ink:#124A7A;
  --lilac-top:#E1DAFB;--lilac-left:#C2B5F2;--lilac-right:#A595E6;--lilac-ink:#43318F;
  --mint-top:#CDF0E2;--mint-left:#9FDDC5;--mint-right:#78C7A9;--mint-ink:#0E5A43;
  --stone-top:#EEF1F5;--stone-left:#D9DEE6;--stone-right:#C3CAD6;--stone-ink:#3A4352;
  --font:"Figtree",system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,monospace;
  --r-card:12px;--r-input:8px;--r-pill:999px;
  --gutter:16px;--ease-in:cubic-bezier(.16,1,.3,1);--ease:cubic-bezier(.2,.7,.3,1);--dur:150ms;
  --shadow:0 6px 16px -8px rgba(20,30,60,.25);
  --z-content:10;--z-header:20;--z-sidebar:30;--z-panel:40;--z-menu:50;--z-modal:60;--z-toast:70;
}
@media (min-width:860px){:root{--gutter:28px}}
```
`src/styles/app.css` base rules (component rules are added by later tasks in this same file):
```css
*{box-sizing:border-box}
html,body,#root{height:100%}
body{margin:0;background:var(--bg);color:var(--text);font:400 .9375rem/1.55 var(--font)}
h1{font-size:2.4rem;line-height:1;letter-spacing:-.035em;font-weight:700;margin:0}
h2{font-size:1.125rem;letter-spacing:-.01em;font-weight:600;margin:0}
.mono{font-family:var(--mono);font-size:.75rem;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
::selection{background:var(--accent);color:var(--on-accent)}
.btn{font:600 .875rem var(--font);padding:.6rem 1.1rem;border-radius:var(--r-pill);border:1px solid var(--accent);background:var(--accent);color:var(--on-accent);cursor:pointer;transition:transform var(--dur) var(--ease),filter var(--dur) var(--ease)}
.btn:hover{transform:translateY(-1px);filter:brightness(1.08)}.btn:active{transform:none}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none;filter:none}
.btn.ghost{background:transparent;color:var(--text);border-color:var(--line)}.btn.ghost:hover{border-color:var(--text);filter:none}
.input{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-input);padding:.55rem .7rem;width:100%;transition:border-color var(--dur) var(--ease)}
.input:hover{border-color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card)}
.field{display:grid;gap:.35rem;margin-bottom:1rem}.field label{font-weight:600;font-size:.8125rem}
.error{color:var(--coral-ink);background:var(--coral-top);border-radius:var(--r-input);padding:.5rem .7rem}
.skip{position:absolute;left:-9999px}.skip:focus{left:var(--gutter);top:8px;z-index:var(--z-toast);background:var(--surface);padding:.5rem}
@media (prefers-reduced-motion:reduce){*{transition-duration:0ms!important;animation-duration:0ms!important}}
```
`src/main.tsx`:
```tsx
import "@fontsource/figtree/400.css"; import "@fontsource/figtree/600.css"; import "@fontsource/figtree/700.css";
import "@fontsource/jetbrains-mono/400.css"; import "@fontsource/jetbrains-mono/500.css";
import "./styles/tokens.css"; import "./styles/app.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, retry: false } } });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={qc}><BrowserRouter><App /></BrowserRouter></QueryClientProvider>);
```
`src/lib/families.ts`: the `FAMILY` record built from the exact hex values above.

- [ ] **Step 2: Write the failing test** `src/lib/api.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARGON_FAST, deriveKeys, verifyRequest } from "@boomerang/core";
import { api, ApiError } from "./api";
import { session } from "./session";

afterEach(() => { session.clear(); vi.unstubAllGlobals(); });

describe("api", () => {
  it("signs requests as the human when a seed is in memory", async () => {
    const k = await deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST); session.setSeed(k.seed);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api("POST", "/api/v1/tickets", { a: 1 })).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe("/api/v1/tickets");
    expect(await verifyRequest(k.publicKeyHex, init.headers, "POST", "/api/v1/tickets", init.body, Date.now())).toBe(true);
  });
  it("throws ApiError with the server code and drops the session when locked", async () => {
    const k = await deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST); session.setSeed(k.seed);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "locked", message: "Boomerang is locked" } }), { status: 423 })));
    await expect(api("GET", "/api/v1/projects")).rejects.toMatchObject({ status: 423, code: "locked" });
    expect(session.getSeed()).toBeNull();
    expect(new ApiError(400, "x", "y")).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 3: Run, confirm FAIL. Step 4: Implement**

`session.ts`:
```ts
let seed: Uint8Array | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const session = {
  setSeed(s: Uint8Array) { seed = s; emit(); },
  getSeed: () => seed,
  clear() { seed?.fill(0); seed = null; emit(); },
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
};
```
`api.ts`:
```ts
import { signRequest } from "@boomerang/core";
import { session } from "./session";
export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
export async function api<T = unknown>(method: string, path: string, body?: unknown, seedOverride?: Uint8Array): Promise<T> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const seed = seedOverride ?? session.getSeed();
  const headers: Record<string, string> = seed ? { ...(await signRequest(seed, "human", method, path, payload)) } : {};
  if (payload) headers["content-type"] = "application/json";
  const res = await fetch(path, { method, headers, body: payload || undefined });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error ?? { code: "network", message: `Request failed (${res.status})` };
    if (res.status === 423 || e.code === "bad_signature") session.clear();
    throw new ApiError(res.status, e.code, e.message, e.details);
  }
  return json as T;
}
```
`App.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api } from "./lib/api";
import { session } from "./lib/session";
export interface Status { state: "uninitialized" | "locked" | "unlocked"; kdfSalt?: string; argon?: { iterations: number; memorySize: number; parallelism: number }; humanPublicKey?: string; encryption?: boolean }
export function App() {
  const seed = useSyncExternalStore(session.subscribe, session.getSeed);
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("GET", "/api/v1/status") });
  if (status.isPending) return null;
  if (status.isError) return <main style={{ padding: "var(--gutter)" }}><p className="error">Cannot reach the Boomerang server. Is it running?</p><button className="btn" onClick={() => status.refetch()}>Try again</button></main>;
  if (status.data.state !== "unlocked" || !seed) return <p>Lock</p>;
  return <p>Unlocked</p>;
}
```

- [ ] **Step 5: Run** `pnpm install && pnpm test && pnpm --filter @boomerang/web build` Expected: tests pass and the build succeeds.
- [ ] **Step 6: Commit** `feat(web): scaffold, locked tokens, in-memory session, signed api client`

---

### Task 10: Isometric helper and lock screen

**Files:**
- Create: `apps/web/src/lib/iso.tsx`, `apps/web/src/views/LockScreen.tsx`, `apps/web/src/components/ChainBanner.tsx`; Modify: `App.tsx`, `app.css`
- Test: `apps/web/src/lib/iso.test.ts`, `apps/web/src/views/unlock.test.ts`

**Interfaces:**
- Produces:
  - `isoPoint(x, y, z, unit?): [number, number]`, `isoBoxFaces(x, y, z, w, d, h, unit?): { top: string; left: string; right: string }` (SVG `points` strings), `<IsoBox x y z w d h family />`, `<LaneScene settle?: boolean />` (three stone platforms; blocks: sky, sky / lilac, coral (taller, h 1.4) / mint, mint, mint; `settle` adds the 500ms, 40ms stagger, 12px drop on the entrance curve; `role="img"` with `aria-label="Lanes drawn as platforms with tickets as blocks"`)
  - `unlockFlow(password: string, status: Status, deps?): Promise<{ seed: Uint8Array; chain: { ok: true } | { ok: false; brokenAt: number } }>` exported from `views/unlock.ts`. Steps: derive keys; if `publicKeyHex !== status.humanPublicKey` throw `Error("wrong_password")`; if state is `locked` `POST /unlock {dbKey}`; `GET /chain/verify` signed with the seed; when ok, sign `head` and `POST /checkpoints`; return.
  - `setupFlow(password: string, encryption: boolean): Promise<Uint8Array>`: salt `randomHex(16)`, params `import.meta.env.VITE_FAST_KDF ? ARGON_FAST : ARGON`, signed `POST /setup`.
  - `<LockScreen status onDone={(seed, chain) => void} />`, `<ChainBanner brokenAt />`

- [ ] **Step 1: Write failing tests**

`iso.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isoBoxFaces, isoPoint } from "./iso";
describe("iso", () => {
  it("projects at 30 degrees", () => {
    expect(isoPoint(0, 0, 0, 20)).toEqual([0, 0]);
    expect(isoPoint(1, 0, 0, 20)[0]).toBeCloseTo(17.32, 2);
    expect(isoPoint(1, 0, 0, 20)[1]).toBeCloseTo(10, 2);
    expect(isoPoint(0, 0, 1, 20)).toEqual([0, -20]);
  });
  it("returns three four-point faces", () => {
    const f = isoBoxFaces(0, 0, 0, 1, 1, 1, 20);
    for (const face of [f.top, f.left, f.right]) expect(face.trim().split(" ")).toHaveLength(4);
  });
});
```
`unlock.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { ARGON_FAST, deriveKeys } from "@boomerang/core";
import { unlockFlow } from "./unlock";

const SALT = "00".repeat(16);
describe("unlockFlow", () => {
  it("rejects a password whose public key does not match, before touching the server", async () => {
    const call = vi.fn();
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    await expect(unlockFlow("wrong-password-1", { state: "locked", kdfSalt: SALT, argon: ARGON_FAST, humanPublicKey: k.publicKeyHex, encryption: true }, { call })).rejects.toThrow("wrong_password");
    expect(call).not.toHaveBeenCalled();
  });
  it("unlocks, verifies, and checkpoints", async () => {
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    const call = vi.fn(async (_m: string, path: string) => path.endsWith("/chain/verify") ? { ok: true, head: "ab".repeat(32), seq: 3 } : { ok: true });
    const out = await unlockFlow("right-password-1", { state: "locked", kdfSalt: SALT, argon: ARGON_FAST, humanPublicKey: k.publicKeyHex, encryption: true }, { call });
    expect(out.chain).toEqual({ ok: true });
    expect(call.mock.calls.map((c) => c[1])).toEqual(["/api/v1/unlock", "/api/v1/chain/verify", "/api/v1/checkpoints"]);
    expect(call.mock.calls[0][2]).toEqual({ dbKey: k.dbKeyHex });
  });
  it("skips the checkpoint and reports a broken chain", async () => {
    const k = await deriveKeys("right-password-1", SALT, ARGON_FAST);
    const call = vi.fn(async (_m: string, path: string) => path.endsWith("/chain/verify") ? { ok: false, brokenAt: 7 } : { ok: true });
    const out = await unlockFlow("right-password-1", { state: "unlocked", kdfSalt: SALT, argon: ARGON_FAST, humanPublicKey: k.publicKeyHex, encryption: false }, { call });
    expect(out.chain).toEqual({ ok: false, brokenAt: 7 });
    expect(call.mock.calls.map((c) => c[1])).toEqual(["/api/v1/chain/verify"]);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement**

`iso.tsx`:
```tsx
import type { Family } from "@boomerang/core";
import { FAMILY } from "./families";
const C = Math.cos(Math.PI / 6), S = 0.5;
const r = (n: number) => Math.round(n * 100) / 100 + 0;
export const isoPoint = (x: number, y: number, z: number, unit = 22): [number, number] => [r((x - y) * C * unit), r((x + y) * S * unit - z * unit)];
const pts = (p: [number, number][]) => p.map((q) => q.join(",")).join(" ");
export function isoBoxFaces(x: number, y: number, z: number, w: number, d: number, h: number, unit = 22) {
  const P = (a: number, b: number, c: number) => isoPoint(a, b, c, unit);
  return {
    left: pts([P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)]),
    right: pts([P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)]),
    top: pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)]),
  };
}
export function IsoBox(p: { x: number; y: number; z: number; w: number; d: number; h: number; family: Family; className?: string; style?: React.CSSProperties }) {
  const f = isoBoxFaces(p.x, p.y, p.z, p.w, p.d, p.h), c = FAMILY[p.family];
  return <g className={p.className} style={p.style}><polygon points={f.left} fill={c.left} /><polygon points={f.right} fill={c.right} /><polygon points={f.top} fill={c.top} /></g>;
}
const LANES: [number, [Family, number][]][] = [[0, [["sky", 1], ["sky", 1]]], [5, [["lilac", 1], ["coral", 1.4]]], [10, [["mint", 1], ["mint", 1], ["mint", 1]]]];
export function LaneScene({ settle = false }: { settle?: boolean }) {
  let i = 0;
  return (
    <svg viewBox="-150 -40 440 250" width="100%" style={{ maxHeight: 240 }} role="img" aria-label="Lanes drawn as platforms with tickets as blocks">
      {LANES.map(([x, blocks]) => (
        <g key={x}>
          <IsoBox x={x} y={0} z={0} w={4} d={7} h={0.4} family="stone" />
          {blocks.map(([family, h], j) => <IsoBox key={j} x={x + 0.7} y={0.8 + j * 2} z={0.4} w={2.6} d={1.6} h={h} family={family} className={settle ? "iso-settle" : undefined} style={settle ? { animationDelay: `${i++ * 40}ms` } : undefined} />)}
        </g>
      ))}
    </svg>
  );
}
```
Add to `app.css`:
```css
@keyframes iso-settle{from{transform:translateY(-12px);opacity:0}to{transform:none;opacity:1}}
.iso-settle{animation:iso-settle 500ms var(--ease-in) both}
.lock{min-height:100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:var(--gutter);padding:var(--gutter);max-width:1080px;margin:0 auto}
.lock form{max-width:380px}
.lock .mark{font-weight:700;font-size:1.05rem;letter-spacing:-.01em;margin-bottom:2rem}
.lock h1{margin-bottom:.75rem}.lock p{margin:0 0 1.5rem}
.check{display:flex;gap:.6rem;align-items:flex-start;margin-bottom:1.25rem}
.banner{background:var(--coral-top);color:var(--coral-ink);padding:.7rem var(--gutter);font-weight:600}
@media (max-width:860px){.lock{grid-template-columns:1fr}.lock .art{order:-1}}
```
`views/unlock.ts`:
```ts
import { ARGON, ARGON_FAST, deriveKeys, randomHex, signText } from "@boomerang/core";
import { api } from "../lib/api";
import type { Status } from "../App";
type Call = (method: string, path: string, body: unknown, seed: Uint8Array) => Promise<any>;
const defaultCall: Call = (m, p, b, seed) => api(m, p, b, seed);

export async function unlockFlow(password: string, status: Status, deps: { call?: Call } = {}) {
  const call = deps.call ?? defaultCall;
  const k = await deriveKeys(password, status.kdfSalt!, status.argon!);
  if (k.publicKeyHex !== status.humanPublicKey) throw new Error("wrong_password");
  if (status.state === "locked") await call("POST", "/api/v1/unlock", { dbKey: k.dbKeyHex }, k.seed);
  const v = await call("GET", "/api/v1/chain/verify", undefined, k.seed);
  if (!v.ok) return { seed: k.seed, chain: { ok: false as const, brokenAt: v.brokenAt as number } };
  if (v.seq > 0) await call("POST", "/api/v1/checkpoints", { headHash: v.head, signature: await signText(k.seed, v.head) }, k.seed);
  return { seed: k.seed, chain: { ok: true as const } };
}

export async function setupFlow(password: string, encryption: boolean): Promise<Uint8Array> {
  const kdfSalt = randomHex(16), argon = import.meta.env.VITE_FAST_KDF ? ARGON_FAST : ARGON;
  const k = await deriveKeys(password, kdfSalt, argon);
  await api("POST", "/api/v1/setup", { publicKey: k.publicKeyHex, kdfSalt, argon, encryption, dbKey: encryption ? k.dbKeyHex : null }, k.seed);
  return k.seed;
}
```
`LockScreen.tsx`:
```tsx
import { useState } from "react";
import type { Status } from "../App";
import { LaneScene } from "../lib/iso";
import { setupFlow, unlockFlow } from "./unlock";

export function LockScreen({ status, onDone }: { status: Status; onDone: (seed: Uint8Array, brokenAt: number | null) => void }) {
  const first = status.state === "uninitialized";
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [enc, setEnc] = useState(true), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (first && pw.length < 12) return setErr("Use at least 12 characters.");
    if (first && pw !== pw2) return setErr("The two passwords do not match.");
    setBusy(true);
    try {
      if (first) onDone(await setupFlow(pw, enc), null);
      else { const out = await unlockFlow(pw, status); onDone(out.seed, out.chain.ok ? null : out.chain.brokenAt); }
    } catch (x: any) {
      setErr(x.message === "wrong_password" ? "That password does not match this installation's key. If you are sure it is right, config.json may have been altered." : x.message);
    } finally { setBusy(false); }
  }
  return (
    <main className="lock">
      <form onSubmit={submit}>
        <div className="mark">Boomerang</div>
        <h1>{first ? "Set your password" : "Unlock"}</h1>
        <p className="muted">{first ? "It signs everything you approve and it is never stored. If you lose it, it cannot be recovered in this version." : status.encryption ? "Your database is encrypted. Schedules and agents wait until you unlock." : "Your password signs the actions only you can take."}</p>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoFocus autoComplete={first ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        {first && <div className="field"><label htmlFor="pw2">Repeat password</label><input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>}
        {first && <label className="check"><input type="checkbox" checked={enc} onChange={(e) => setEnc(e.target.checked)} /><span>Encrypt the database. Boomerang then stays locked after a restart until you enter this password.</span></label>}
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn" disabled={busy || !pw}>{busy ? "Working" : first ? "Create" : "Unlock"}</button>
      </form>
      <div className="art"><LaneScene settle /></div>
    </main>
  );
}
```
`ChainBanner.tsx`:
```tsx
export const ChainBanner = ({ brokenAt }: { brokenAt: number }) => (
  <div className="banner" role="alert">The event log was changed outside Boomerang. First bad entry: {brokenAt}. Treat ticket history after that point as untrusted.</div>
);
```
In `App.tsx`: hold `const [brokenAt, setBrokenAt] = useState<number | null>(null)`. Replace the `Lock` placeholder with `<LockScreen status={status.data} onDone={(s, b) => { setBrokenAt(b); session.setSeed(s); status.refetch(); }} />`, and render `{brokenAt !== null && <ChainBanner brokenAt={brokenAt} />}` above the unlocked placeholder.

- [ ] **Step 4: Run tests, then check by hand.** `pnpm test`. Then `BOOMERANG_DATA_DIR=/tmp/pan-dev pnpm dev:server` and `VITE_FAST_KDF=1 pnpm dev:web`, open `http://localhost:4401`: set a password, see "Unlocked", reload, unlock, try a wrong password, tab through the form and confirm the teal focus ring, view at 375px.
- [ ] **Step 5: Commit** `feat(web): isometric helper, first run and unlock with chain check`

---

### Task 11: Shell, first project, Queue

**Files:**
- Create: `apps/web/src/views/Shell.tsx`, `FirstProject.tsx`, `Queue.tsx`, `src/components/Chip.tsx`, `TicketRow.tsx`, `NewTicket.tsx`, `src/lib/hooks.ts`; Modify: `App.tsx`, `app.css`
- Test: `apps/web/src/components/TicketRow.test.tsx` (add devDependencies `@testing-library/react`, `jsdom`; create `apps/web/vitest.config.ts` with `environment: "jsdom"` and the react plugin)

**Interfaces:**
- Produces:
  - hooks: `useProjects()`, `useLanes(projectId)`, `useQueue(projectId)`, `useAgents()`, `useTicket(id)`, and mutations `useCreateProject()`, `useCreateTicket()`, `useMoveTicket()`, `useSetFlag()`, `useUpdateTicket()`, `useApproveAgent()`, `useRevokeAgent()`. Every mutation invalidates `["queue"]`, `["ticket"]`, `["agents"]` as relevant.
  - `laneFamily(ticket: Ticket, lanes: Lane[]): Family` returns `coral` when flags include `needs_human`, else the lane's family.
  - `<Chip family onClick?>`, `<TicketRow ticket lanes agents onOpen />`, `<NewTicket projectId onClose />` (modal dialog, title input, Create and Cancel, Esc closes, focus returns to the opener)
  - `<Shell>`: sidebar (232px, collapsible to 56px, state kept in `localStorage` key `pan.sidebar`; this is a layout preference, not a secret) with project switcher, nav items Queue (`/`) and Agents (`/agents`) using Phosphor `Tray` and `Robot` at 18px regular with labels, footer showing `chain verified` or `chain broken` in mono plus a Lock button when `encryption` is on (calls `POST /lock`, then `session.clear()`). Routes: `/` Queue, `/agents` Agents (Task 12), `/t/:id` Queue with the panel open (Task 12). Keyboard: `g q`, `g a`, `c`, `j`, `k`, `Enter`, `Esc`.
  - `<FirstProject>` shown when `useProjects()` returns an empty list: fields labelled "Project name" and "Key", submit button "Create project" (key auto-suggested as the first three letters of the name, upper case), LaneScene beside it.
  - `<Queue>`: header `<h1><span class="count mono">{n}</span> need you</h1>`, sub line "`{m}` more with agents", New ticket button, needs-human rows, then a section "With agents" with the active rows. States: loading (four skeleton rows), error (message and Try again), empty (LaneScene, "Nothing needs you", "Agents are working. Flagged tickets land here.", New ticket button). Entrance choreography from `BRAND.md` via CSS classes `enter-header` and `enter-row` with `--i` index, first needs-human row focused at 600ms.

- [ ] **Step 1: Write the failing test** `TicketRow.test.tsx`

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { laneFamily, TicketRow } from "./TicketRow";

const lanes = [{ id: "l1", projectId: "p", name: "In Progress", position: 2, family: "sky", setsNeedsHuman: false, isDone: false }] as any;
const base = { id: "t1", projectId: "p", number: 7, key: "PAN-7", title: "A very long title that must truncate rather than wrap the row", laneId: "l1", position: 1, flags: [], assigneeId: "a1", startDate: null, dueDate: null, metadata: { tokens: 184220 }, archived: false, createdAt: "", updatedAt: "" } as any;
const agents = [{ id: "a1", name: "claude-worker-2" }] as any;

describe("TicketRow", () => {
  it("shows key, title, agent, tokens, and the lane as state", () => {
    render(<TicketRow ticket={base} lanes={lanes} agents={agents} onOpen={() => {}} />);
    expect(screen.getByText("PAN-7")).toBeTruthy();
    expect(screen.getByText("claude-worker-2")).toBeTruthy();
    expect(screen.getByText("184,220 tok")).toBeTruthy();
    expect(screen.getByText("In Progress")).toBeTruthy();
  });
  it("shows Needs human in coral when flagged", () => {
    expect(laneFamily({ ...base, flags: ["needs_human"] }, lanes)).toBe("coral");
    render(<TicketRow ticket={{ ...base, flags: ["needs_human"] }} lanes={lanes} agents={agents} onOpen={() => {}} />);
    expect(screen.getByText("Needs human")).toBeTruthy();
  });
  it("opens on click and on Enter", () => {
    const onOpen = vi.fn();
    render(<TicketRow ticket={base} lanes={lanes} agents={agents} onOpen={onOpen} />);
    const row = screen.getByRole("link");
    fireEvent.click(row); fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement**

`Chip.tsx`:
```tsx
import type { Family } from "@boomerang/core";
export function Chip({ family, children, onClick }: { family: Family; children: React.ReactNode; onClick?: () => void }) {
  const style = { background: `var(--${family}-top)`, color: `var(--${family}-ink)` };
  return onClick ? <button type="button" className="chip" style={style} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button> : <span className="chip" style={style}>{children}</span>;
}
```
`TicketRow.tsx`:
```tsx
import type { Actor, Family, Lane, Ticket } from "@boomerang/core";
import { Chip } from "./Chip";
export const laneFamily = (t: Ticket, lanes: Lane[]): Family => t.flags.includes("needs_human") ? "coral" : lanes.find((l) => l.id === t.laneId)?.family ?? "stone";
export function TicketRow({ ticket, lanes, agents, onOpen, index = 0 }: { ticket: Ticket; lanes: Lane[]; agents: Pick<Actor, "id" | "name">[]; onOpen: (id: string) => void; index?: number }) {
  const family = laneFamily(ticket, lanes), lane = lanes.find((l) => l.id === ticket.laneId);
  const agent = agents.find((a) => a.id === ticket.assigneeId), tokens = typeof ticket.metadata.tokens === "number" ? ticket.metadata.tokens : null;
  return (
    <a className="trow enter-row" style={{ "--i": index } as React.CSSProperties} role="link" tabIndex={0} data-ticket={ticket.id}
      onClick={() => onOpen(ticket.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(ticket.id); }}>
      <span className="mark" style={{ background: `var(--${family}-right)` }} aria-hidden="true" />
      <span className="mono muted id">{ticket.key}</span>
      <span className="ttl" title={ticket.title}>{ticket.title}</span>
      {agent && <span className="mono muted ag">{agent.name}</span>}
      {tokens !== null && <span className="mono muted tk">{tokens.toLocaleString("en-US")} tok</span>}
      <Chip family={family}>{ticket.flags.includes("needs_human") ? "Needs human" : lane?.name ?? "Unknown lane"}</Chip>
    </a>
  );
}
```
(The epic chip, timer, and state-filter click arrive with epics, timers, and the Board in later milestones; they are absent here, not dead.)

`hooks.ts`: one `useQuery` or `useMutation` per name listed under Produces, each a thin wrapper over `api`, for example:
```ts
export const useQueue = (projectId: string) => useQuery({ queryKey: ["queue", projectId], queryFn: () => api<{ needsHuman: Ticket[]; active: Ticket[] }>("GET", `/api/v1/queue?projectId=${projectId}`), refetchInterval: false });
export const useSetFlag = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (v: { id: string; flag: string; on: boolean }) => api<Ticket>("POST", `/api/v1/tickets/${v.id}/flags`, { flag: v.flag, on: v.on }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["queue"] }); qc.invalidateQueries({ queryKey: ["ticket"] }); } }); };
```
`useAgents` must tolerate being the human only. Queue passes `agents` from `useAgents().data ?? []`.

`Queue.tsx`, `Shell.tsx`, `FirstProject.tsx`, `NewTicket.tsx`: build exactly to the Produces description above and `BRAND.md` (composition, interaction inventory, choreography). CSS to add to `app.css`:
```css
.shell{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100%}.shell.collapsed{grid-template-columns:56px minmax(0,1fr)}
.side{background:var(--surface);border-right:1px solid var(--line);padding:16px 12px;display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh;z-index:var(--z-sidebar);animation:fade 300ms var(--ease-in) both}
.side .nav-item{display:flex;align-items:center;gap:.6rem;padding:.5rem .7rem;border-radius:var(--r-pill);color:var(--muted);text-decoration:none;font-weight:600;font-size:.875rem;border:0;background:none;cursor:pointer;transition:background var(--dur) var(--ease),color var(--dur) var(--ease)}
.side .nav-item:hover{background:var(--line);color:var(--text)}
.side .nav-item[aria-current="page"]{background:var(--accent);color:var(--on-accent)}
.side .foot{margin-top:auto;display:grid;gap:8px}
.collapsed .side .label{display:none}
.view{padding:2rem var(--gutter);max-width:1200px;position:relative;z-index:var(--z-content)}
.view-head{display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem}
.view-head .count{font-size:2.4rem;font-weight:500;color:var(--accent);letter-spacing:-.03em;margin-right:.5rem}
.view-head .spacer{margin-left:auto}
.trow{display:flex;align-items:center;gap:.75rem;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:.7rem .9rem;margin-bottom:8px;color:inherit;text-decoration:none;cursor:pointer;transition:transform var(--dur) var(--ease),box-shadow var(--dur) var(--ease),border-color var(--dur) var(--ease)}
.trow:hover{transform:translateY(-1px);box-shadow:var(--shadow);border-color:var(--muted)}
.trow .mark{width:10px;height:10px;border-radius:3px;transform:rotate(45deg);flex:none}
.trow .ttl{font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{font:600 .75rem var(--font);padding:.2rem .6rem;border-radius:var(--r-pill);border:0;white-space:nowrap;flex:none}
button.chip{cursor:pointer;transition:filter var(--dur) var(--ease)}button.chip:hover{filter:brightness(.96)}
.section-title{margin:1.75rem 0 .75rem}
.skeleton{height:46px;border-radius:var(--r-card);background:var(--stone-top);margin-bottom:8px}
.empty{display:grid;justify-items:start;gap:.5rem;max-width:420px}
.modal-back{position:fixed;inset:0;background:rgba(27,34,48,.35);z-index:var(--z-modal);display:grid;place-items:center;padding:var(--gutter)}
.modal{width:min(480px,100%);padding:1.25rem}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.enter-header{animation:rise 400ms var(--ease-in) 80ms both}
.enter-row{animation:rise 350ms var(--ease-in) both;animation-delay:calc(140ms + min(var(--i),7) * 30ms)}
@media (max-width:860px){.shell,.shell.collapsed{grid-template-columns:1fr}.side{position:fixed;inset:auto 0 0 0;height:auto;flex-direction:row;border-right:0;border-top:1px solid var(--line)}.side .foot,.side .switcher{display:none}.view{padding-bottom:5rem}.trow .ag,.trow .tk{display:none}}
```
Wire `App.tsx`: unlocked with seed renders `<Shell status brokenAt />`; Shell renders `<FirstProject>` when there are no projects.

- [ ] **Step 4: Run tests, then check by hand** with the dev servers from Task 10: create the first project, create two tickets, confirm the empty state before and rows after, hover and focus states on nav items, rows, and buttons, keyboard shortcuts, the entrance order, 375px layout, and `prefers-reduced-motion` (rows arrive at once).
- [ ] **Step 5: Commit** `feat(web): app shell, first project, queue`

---

### Task 12: Ticket panel and Agents view

**Files:**
- Create: `apps/web/src/views/TicketPanel.tsx`, `apps/web/src/views/Agents.tsx`; Modify: `Shell.tsx`, `Queue.tsx`, `app.css`
- Test: `apps/web/src/views/Agents.test.tsx`

**Interfaces:**
- Consumes: hooks from Task 11.
- Produces:
  - `<TicketPanel id onClose />`: right panel, 520px, `role="dialog"`, `aria-label` is the ticket key. Shows key (mono), editable title (saves on blur when changed), lane `<select>` (calls move), flags as chips, primary button "Clear needs human" when flagged, "Flag for human" ghost button when not, assignee name, metadata rendered as a mono key and value list (read only), created and updated times. Esc and the close button call `onClose`, focus returns to the row. Overlay below 1280px, pushes content above. Loading skeleton and error state with retry. Route `/t/:id`.
  - `<Agents>`: header "Agents" with pending count. Pending section first: each row has name, short public key (first 8 and last 4 hex, mono), registered time, Approve and Reject buttons. Approve opens a dialog: project checkboxes plus "All projects", action checkboxes labelled "Read", "Create tickets", "Edit tickets", "Move tickets", "Set flags" mapped to `AGENT_ACTIONS`, all checked by default; Approve is disabled until at least one project and the Read action are selected. Active and revoked sections below, with last seen, scopes summary, and Revoke. Empty state: LaneScene, "No agents yet", and the literal registration call in a mono block: `POST /api/v1/agents/register {"name":"my-agent","publicKey":"<ed25519 public key hex>"}`.
  - `scopesFromForm(projects: string[] | "*", actions: AgentAction[]): Scopes`, `shortKey(hex: string): string`

- [ ] **Step 1: Write the failing test** `Agents.test.tsx`

```tsx
import { describe, expect, it } from "vitest";
import { scopesFromForm, shortKey } from "./Agents";
describe("agents helpers", () => {
  it("shortens keys", () => { expect(shortKey("0123456789abcdef".repeat(4))).toBe("01234567…cdef"); });
  it("builds scopes and always keeps read first", () => {
    expect(scopesFromForm("*", ["ticket.move", "read"])).toEqual({ projects: "*", actions: ["read", "ticket.move"] });
    expect(scopesFromForm(["p1"], ["read"])).toEqual({ projects: ["p1"], actions: ["read"] });
  });
});
```

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement** both views to the Produces description. Helpers:

```ts
import { AGENT_ACTIONS, type AgentAction, type Scopes } from "@boomerang/core";
export const shortKey = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-4)}`;
export const scopesFromForm = (projects: string[] | "*", actions: AgentAction[]): Scopes => ({ projects, actions: AGENT_ACTIONS.filter((a) => actions.includes(a)) });
```
CSS to add:
```css
.panel{position:fixed;top:0;right:0;bottom:0;width:min(520px,100%);background:var(--surface);border-left:1px solid var(--line);z-index:var(--z-panel);padding:1.25rem var(--gutter);overflow:auto;animation:panel-in 250ms var(--ease-in) both;box-shadow:var(--shadow)}
@keyframes panel-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
@media (min-width:1280px){.with-panel .view{margin-right:520px}}
.panel .title-input{font:600 1.25rem var(--font);letter-spacing:-.01em;border:1px solid transparent;border-radius:var(--r-input);padding:.3rem .4rem;width:100%;margin:.5rem 0 1rem -.4rem;color:inherit;background:none}
.panel .title-input:hover,.panel .title-input:focus{border-color:var(--line)}
.kv{display:grid;grid-template-columns:8rem 1fr;gap:.4rem 1rem;margin:1rem 0}.kv dt{color:var(--muted);font-size:.8125rem}.kv dd{margin:0}
.codeblock{font-family:var(--mono);font-size:.75rem;background:var(--stone-top);color:var(--stone-ink);border-radius:var(--r-input);padding:.7rem;overflow-x:auto;white-space:pre}
.agent-row{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;padding:.8rem .9rem;margin-bottom:8px}
```
The horizontal ellipsis in `shortKey` is U+2026, which is allowed; dashes are not.

- [ ] **Step 4: Run tests, then check by hand:** open a ticket, rename it, move it to Ready for Production and watch it jump to the top of the Queue in coral, clear the flag, then register an agent with `curl -s -X POST localhost:4400/api/v1/agents/register -H 'content-type: application/json' -d '{"name":"probe","publicKey":"<64 hex>"}'` and approve and revoke it. Check every control, hover, focus, Esc, and 375px.
- [ ] **Step 5: Commit** `feat(web): ticket panel and agent approval`

---

### Task 13: Demo agent, production serving, end to end

**Files:**
- Create: `scripts/demo-agent.ts`, `playwright.config.ts`, `e2e/first-run.spec.ts`; Modify: root `package.json` (devDependency `@playwright/test`, script `"demo:agent": "tsx scripts/demo-agent.ts"`), `README.md`

**Interfaces:**
- Consumes: the REST API, `signRequest`, `publicKeyFromSeed`, `randomHex`.
- Produces: `scripts/demo-agent.ts` with env `BOOMERANG_URL` (default `http://127.0.0.1:4400`) and `AGENT_NAME` (default `demo-agent`). It generates a 32 byte seed in memory, registers, polls `GET /api/v1/me` every second until 200 (max 120 tries), lists projects, creates the ticket "Demo: wire outbox retries" with `metadata: {tokens: 18422}`, moves it to In Progress, then to Ready for Production, prints each step, exits 0.

- [ ] **Step 1: Write the demo agent**

```ts
import { publicKeyFromSeed, signRequest } from "@boomerang/core";
const BASE = process.env.BOOMERANG_URL ?? "http://127.0.0.1:4400", NAME = process.env.AGENT_NAME ?? "demo-agent";
const seed = crypto.getRandomValues(new Uint8Array(32));
let actorId = "";
async function call(method: string, path: string, body?: unknown, signed = true) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = signed ? { ...(await signRequest(seed, actorId, method, path, payload)) } : {};
  if (payload) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: payload || undefined });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const reg = await call("POST", "/api/v1/agents/register", { name: NAME, publicKey: await publicKeyFromSeed(seed) }, false);
if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.json)}`);
actorId = reg.json.id;
console.log(`Registered as ${actorId}. Approve "${NAME}" in the Agents view.`);
for (let i = 0; ; i++) {
  if ((await call("GET", "/api/v1/me")).status === 200) break;
  if (i >= 120) throw new Error("not approved in time");
  await new Promise((r) => setTimeout(r, 1000));
}
const project = (await call("GET", "/api/v1/projects")).json[0];
const lanes = (await call("GET", `/api/v1/projects/${project.id}/lanes`)).json;
const lane = (name: string) => lanes.find((l: any) => l.name === name).id;
const t = (await call("POST", "/api/v1/tickets", { projectId: project.id, title: "Demo: wire outbox retries", metadata: { tokens: 18422 } })).json;
console.log(`Created ${t.key}`);
await call("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lane("In Progress") });
const done = (await call("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lane("Ready for Production") })).json;
console.log(`Moved ${t.key} to Ready for Production. Flags: ${done.flags.join(", ")}`);
```

- [ ] **Step 2: Playwright config and spec**

`playwright.config.ts`:
```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
const dataDir = mkdtempSync(join(tmpdir(), "bm-e2e-"));
export default defineConfig({
  testDir: "e2e", timeout: 60_000, use: { baseURL: "http://127.0.0.1:4410" },
  webServer: { command: "pnpm start", url: "http://127.0.0.1:4410/api/v1/health", env: { PORT: "4410", BOOMERANG_DATA_DIR: dataDir, VITE_FAST_KDF: "1" }, reuseExistingServer: false, timeout: 120_000 },
});
```
`e2e/first-run.spec.ts`:
```ts
import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

test("first run, agent approval, clearing the queue", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("a-long-test-password");
  await page.getByLabel("Repeat password").fill("a-long-test-password");
  await page.getByRole("button", { name: "Create" }).click();

  await page.getByLabel("Project name").fill("Boomerang");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("Nothing needs you")).toBeVisible();

  const agent = spawn("pnpm", ["demo:agent"], { env: { ...process.env, BOOMERANG_URL: "http://127.0.0.1:4410", AGENT_NAME: "e2e-agent" }, stdio: "inherit" });
  const exited = new Promise<number>((r) => agent.on("exit", (c) => r(c ?? 1)));
  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByText("e2e-agent")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  expect(await exited).toBe(0);

  await page.getByRole("link", { name: "Queue" }).click();
  const row = page.getByRole("link", { name: /Demo: wire outbox retries/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Needs human")).toBeVisible();
  await expect(row.getByText("18,422 tok")).toBeVisible();
  await row.click();
  await page.getByRole("button", { name: "Clear needs human" }).click();
  await expect(page.getByText("Nothing needs you")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Unlock" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("not-the-password-1");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toContainText("does not match");
  await page.getByLabel("Password", { exact: true }).fill("a-long-test-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("chain verified")).toBeVisible();
});
```
The Agents list does not poll; the spec navigates to Agents after the script starts, and the view fetches on mount. If the row is not there yet, the test's `toBeVisible` timeout needs a refetch: give `useAgents` `refetchInterval: 3000` only while the Agents view is mounted. That is the one interval in M1 and SSE replaces it in milestone 2.

- [ ] **Step 3: Run** `pnpm add -Dw @playwright/test && pnpm exec playwright install chromium && pnpm e2e` Expected: 1 passed.
- [ ] **Step 4: README.** Sections: what Boomerang is (spec section 1), requirements (Node 20, pnpm 9), `pnpm install`, `pnpm start`, where data lives, how an agent registers and signs (link `scripts/demo-agent.ts`), `pnpm test`, `pnpm e2e`, license. No em dashes.
- [ ] **Step 5: Final check** `pnpm test && pnpm e2e && grep -rn "—\|–" --include="*.ts" --include="*.tsx" --include="*.css" --include="*.md" . --exclude-dir=node_modules --exclude-dir=docs | wc -l` Expected: tests pass, grep count 0.
- [ ] **Step 6: Commit** `feat: demo agent, production static serving, end to end first run`

---

## Milestone 1 acceptance

1. `pnpm start` on a clean machine serves the app on `127.0.0.1:4400`.
2. First run sets a password; with encryption on, a restart leaves Boomerang locked, every API call answers 423, and only the right password unlocks.
3. `pnpm demo:agent` can do nothing until approved in the Agents view, then creates and moves a ticket; the ticket appears in the Queue in coral; the agent cannot clear the flag; the owner can.
4. Editing `panorama.db` directly makes the next unlock show the chain banner with the first bad entry.
5. Every control on screen works, has hover and focus states from `BRAND.md`, and the app is usable at 375px and with reduced motion.
