# Panorama Milestone 2: Evidence and Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ticket carries an append-only comment thread with attachments and typed evidence, a lane can require evidence before a ticket may enter it from any surface, the Board lets the owner drag tickets between lanes with gated drops refused and explained, and every view updates live over server-sent events.

**Architecture:** Evidence kinds, their payload schemas, pass evaluation, and the gate check live in `packages/core` as pure functions. `packages/db` adds migration 3 (comments, attachments, evidence types, evidence, all append-only) and repositories. `apps/server` adds routes for the thread, evidence, encrypted file storage, lane requirements, enforces the gate inside the existing move route, and publishes committed events to connected SSE clients. `apps/web` adds a markdown pipeline with sandboxed HTML, a TipTap composer with markdown shorthand and drop-to-upload, the thread and evidence checklist in the ticket panel, the Board with dnd-kit, and a stream client that replaces polling.

**Tech Stack:** As milestone 1, plus: `@fastify/multipart` (MIT), `sanitize-html` (MIT), `marked` (MIT), `dompurify` (Apache 2.0 or MPL 2.0, dual, MIT compatible), `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm` (MIT), `tiptap-markdown` (MIT), `@dnd-kit/core`, `@dnd-kit/utilities` (MIT), `@phosphor-icons/react` (already present).

**Spec:** `docs/superpowers/specs/2026-09-21-panorama-design.md` (sections 3, 8 gate paragraph, 10, 11, 12, 13, milestone 2 of 14). UI: `BRIEF.md` (Views 2 and 8, "The comment thread", states, quality floor) and `BRAND.md` (locked). The milestone 1 interface digest the executors should assume is what `git` shows on `main` after commit `48abedc`; every name used below exists there unless a task creates it.

## Global Constraints

- License MIT. Every dependency MIT, ISC, BSD, Apache 2.0, MPL 2.0 (dual with MIT), or OFL. No paid services, no telemetry, no runtime network requests except to the local server and to webhook destinations the owner configures (none in this milestone).
- No em dashes and no en dashes in any string, comment, commit message, document, or UI text. The ellipsis character is allowed.
- UI uses only the tokens in `BRAND.md` as CSS custom properties from `apps/web/src/styles/tokens.css`. No inline hex, no CSS framework, two easing curves only, keep the reduced-motion rule in `app.css` intact. Sentence case, plain verbs. One `h1` per view. Every control does what it looks like it does; a feature that is not built has no control.
- Error body shape everywhere: `{"error":{"code":string,"message":string,"details"?:unknown}}`. New status codes in this milestone: `422` with code `gate` for a refused lane entry, `413` for a file over the cap, `415` for a disallowed type.
- Every mutation, its event row(s), and nothing else happen in one SQLite transaction. Events are broadcast only after the transaction has committed.
- Comments, evidence, and events are append-only: no update or delete routes, and database triggers refuse both.
- A gated lane can never be entered without its evidence from any surface: REST move, Board drag, keyboard move, and later rules and MCP. The check lives in one function in `packages/core` and one place in the server.
- The password and the Ed25519 seed never reach the server or any storage. The database key held in server memory is also the file key; when encryption is off, files are stored as plain bytes.
- Agent-supplied text (comments, filenames, evidence payloads, metadata) is rendered as text or through the sanitising pipeline; never `dangerouslySetInnerHTML` outside `Markdown.tsx`, and raw HTML only inside the sandboxed frame.
- The Agents view's `refetchInterval` from milestone 1 is removed in this milestone; after Task 6 nothing polls.
- Board virtualisation for lanes with hundreds of cards is deferred to milestone 4 (Planning and accounting), where the Timeline needs the same windowing. Task 11 adds one line saying so to the README milestone status.
- Commit after every task with a conventional commit message ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work on branch `m2-evidence`.

## File Structure

```
packages/core/src/
  evidence.ts        EVIDENCE_KINDS, EvidenceType, Evidence, LaneRequirement, EvidencePayload schemas, evaluateEvidence, checkGate
  schemas.ts         (modify) Lane gains evidenceRequirements; Comment, Attachment interfaces; AddCommentInput, AddEvidenceInput, LaneRequirementsInput
  permissions.ts     (modify) new actions
packages/db/src/
  migrations.ts      (modify) M3
  projects.ts        (modify) toLane reads requirements; setLaneRequirements
  thread.ts          comments, attachments, evidence repositories, evidence types
apps/server/src/
  context.ts         (modify) fileKey, bus
  bus.ts             EventBus, record(req, ev), installStream(app, ctx)
  files.ts           storeFile, readFile (AES-256-GCM when keyed)
  routes/thread.ts   comments, evidence, evidence types, gates, lane requirements
  routes/attachments.ts
  routes/tickets.ts  (modify) gate in move, record events
  routes/agents.ts, projects.ts, lifecycle.ts, chain.ts (modify) record events, fileKey at setup and unlock and lock
  test/helpers.ts    (modify) multipart helper, agentIn helper
apps/web/src/
  lib/stream.ts      connectStream, useStream
  lib/hooks.ts       (modify) thread, evidence, gates, board, attachments hooks; remove Agents polling
  lib/markdown.tsx   renderBlocks, Markdown, HtmlFrame, useAttachmentUrl
  lib/attachments.ts fetchBlob, uploadFile
  components/Composer.tsx
  components/Thread.tsx
  components/EvidenceChip.tsx
  components/AddEvidence.tsx
  components/GateList.tsx
  views/TicketPanel.tsx (modify) thread, checklist
  views/Board.tsx, components/BoardCard.tsx, components/LaneRequirements.tsx
  views/Shell.tsx    (modify) Board nav, g b, useStream
scripts/demo-agent.ts (modify) evidence flow
e2e/gate.spec.ts
```

---

### Task 1: Core evidence model, evaluation, and gate check

**Files:**
- Create: `packages/core/src/evidence.ts`; Modify: `packages/core/src/schemas.ts`, `packages/core/src/permissions.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/evidence.test.ts`, extend `packages/core/src/permissions.test.ts`

**Interfaces:**
- Produces in `evidence.ts`:
  - `EVIDENCE_KINDS = ["test_run","pr_link","eval_score","screenshot","human_signoff","file","custom"] as const`, `type EvidenceKind`, `type EvidenceResult = "pass" | "fail" | "info"`
  - `interface EvidenceType { id: string; name: string; kind: EvidenceKind; params: { threshold?: number }; humanOnly: boolean; needsAttachment: boolean; createdAt: string }`
  - `interface Evidence { id: string; ticketId: string; typeId: string; commentId: string | null; attachmentId: string | null; actorId: string; payload: Record<string, unknown>; result: EvidenceResult; createdAt: string }`
  - `interface LaneRequirement { typeId: string; count: number }`
  - `EvidencePayload: Record<EvidenceKind, z.ZodTypeAny>`: test_run `{passed: int>=0, failed: int>=0, output?: string<=20000}`; pr_link `{url: url string, title?: string<=200}`; eval_score `{score: number 0..1, note?: string<=2000}`; screenshot `{note?: string<=2000}`; human_signoff `{note?: string<=2000}`; file `{note?: string<=2000}`; custom `{result: "pass"|"fail"|"info", note?: string<=2000}`. All `.strict()`.
  - `evaluateEvidence(type: Pick<EvidenceType,"kind"|"params">, payload: unknown): EvidenceResult`: parses with the kind's schema (throws ZodError on bad payload); test_run pass when `failed === 0` else fail; eval_score pass when `score >= (params.threshold ?? 0.9)` else fail; human_signoff pass; custom returns `payload.result`; pr_link, screenshot, file return info.
  - `checkGate(requirements: LaneRequirement[], evidence: Pick<Evidence,"typeId"|"result">[]): { typeId: string; need: number; have: number }[]`: `have` counts evidence of that type whose result is pass or info; returns only unmet requirements, in requirement order.
  - `DEFAULT_EVIDENCE_TYPES: Omit<EvidenceType,"createdAt">[]` with fixed ids: `et_test_run` "Test run" test_run; `et_pr_link` "Pull request" pr_link; `et_eval_score` "Eval score" eval_score params `{threshold: 0.9}`; `et_screenshot` "Screenshot" screenshot needsAttachment; `et_human_signoff` "Human sign-off" human_signoff humanOnly; `et_file` "File" file needsAttachment. Other fields false and `params: {}` unless stated.
- Modifies `schemas.ts`: `Lane` gains `evidenceRequirements: LaneRequirement[]`; `DEFAULT_LANES` entries gain `evidenceRequirements` (Ready for Production: `[{typeId:"et_eval_score",count:1}]`; Done: `[{typeId:"et_human_signoff",count:1}]`; others `[]`). New: `interface Comment { id: string; ticketId: string; actorId: string; body: string; attachmentIds: string[]; createdAt: string }`, `interface Attachment { id: string; ticketId: string; commentId: string | null; actorId: string; filename: string; mime: string; size: number; sha256: string; createdAt: string }`, `AddCommentInput = z.object({ ticketId: z.string().min(1), body: z.string().min(1).max(20000), attachmentIds: z.array(z.string().min(1)).max(20).optional() }).strict()`, `AddEvidenceInput = z.object({ ticketId, typeId, payload: z.record(z.unknown()), attachmentId: z.string().min(1).nullable().optional(), commentId: z.string().min(1).nullable().optional() }).strict()`, `LaneRequirementsInput = z.object({ requirements: z.array(z.object({ typeId: z.string().min(1), count: z.number().int().min(1).max(20) }).strict()).max(20) }).strict()`.
- Modifies `permissions.ts`: `AGENT_ACTIONS` gains `"comment.add"`, `"evidence.add"`, `"attachment.add"`; `HUMAN_ACTIONS` gains `"lane.edit"`, `"evidence.signoff"`.

- [ ] **Step 1: Write the failing tests** `evidence.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { checkGate, DEFAULT_EVIDENCE_TYPES, evaluateEvidence } from "./index";

const t = (kind: any, params: any = {}) => ({ kind, params });

describe("evaluateEvidence", () => {
  it("passes a clean test run and fails one with failures", () => {
    expect(evaluateEvidence(t("test_run"), { passed: 12, failed: 0 })).toBe("pass");
    expect(evaluateEvidence(t("test_run"), { passed: 11, failed: 1, output: "x" })).toBe("fail");
  });
  it("applies the eval threshold, defaulting to 0.9", () => {
    expect(evaluateEvidence(t("eval_score"), { score: 0.9 })).toBe("pass");
    expect(evaluateEvidence(t("eval_score"), { score: 0.89 })).toBe("fail");
    expect(evaluateEvidence(t("eval_score", { threshold: 0.5 }), { score: 0.6 })).toBe("pass");
  });
  it("returns info for links and files, pass for sign-off, and the stated result for custom", () => {
    expect(evaluateEvidence(t("pr_link"), { url: "https://example.com/pr/1" })).toBe("info");
    expect(evaluateEvidence(t("file"), {})).toBe("info");
    expect(evaluateEvidence(t("human_signoff"), { note: "ok" })).toBe("pass");
    expect(evaluateEvidence(t("custom"), { result: "fail" })).toBe("fail");
  });
  it("rejects payloads that do not match the kind", () => {
    expect(() => evaluateEvidence(t("test_run"), { passed: "many" })).toThrow();
    expect(() => evaluateEvidence(t("eval_score"), { score: 2 })).toThrow();
    expect(() => evaluateEvidence(t("pr_link"), { url: "not a url" })).toThrow();
    expect(() => evaluateEvidence(t("custom"), { result: "maybe" })).toThrow();
  });
});

describe("checkGate", () => {
  const req = [{ typeId: "et_eval_score", count: 1 }, { typeId: "et_test_run", count: 2 }];
  it("returns only unmet requirements with counts, ignoring failed evidence", () => {
    expect(checkGate(req, [])).toEqual([{ typeId: "et_eval_score", need: 1, have: 0 }, { typeId: "et_test_run", need: 2, have: 0 }]);
    expect(checkGate(req, [{ typeId: "et_eval_score", result: "fail" }, { typeId: "et_test_run", result: "pass" }, { typeId: "et_test_run", result: "info" }]))
      .toEqual([{ typeId: "et_eval_score", need: 1, have: 0 }]);
    expect(checkGate(req, [{ typeId: "et_eval_score", result: "pass" }, { typeId: "et_test_run", result: "pass" }, { typeId: "et_test_run", result: "pass" }])).toEqual([]);
  });
  it("is empty for a lane with no requirements", () => { expect(checkGate([], [])).toEqual([]); });
});

describe("defaults", () => {
  it("ships six evidence types with the ids the default lanes reference", () => {
    const ids = DEFAULT_EVIDENCE_TYPES.map((e) => e.id);
    expect(ids).toEqual(["et_test_run", "et_pr_link", "et_eval_score", "et_screenshot", "et_human_signoff", "et_file"]);
    expect(DEFAULT_EVIDENCE_TYPES.find((e) => e.id === "et_human_signoff")!.humanOnly).toBe(true);
    expect(DEFAULT_EVIDENCE_TYPES.find((e) => e.id === "et_screenshot")!.needsAttachment).toBe(true);
  });
});
```
Add to `permissions.test.ts`: an agent with actions `["comment.add"]` can `comment.add` in scope; no agent can `lane.edit` or `evidence.signoff` whatever its scopes say.

- [ ] **Step 2: Run, confirm FAIL.** `pnpm vitest run packages/core`

- [ ] **Step 3: Implement** `evidence.ts`

```ts
import { z } from "zod";
export const EVIDENCE_KINDS = ["test_run", "pr_link", "eval_score", "screenshot", "human_signoff", "file", "custom"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type EvidenceResult = "pass" | "fail" | "info";
export interface EvidenceType { id: string; name: string; kind: EvidenceKind; params: { threshold?: number }; humanOnly: boolean; needsAttachment: boolean; createdAt: string }
export interface Evidence { id: string; ticketId: string; typeId: string; commentId: string | null; attachmentId: string | null; actorId: string; payload: Record<string, unknown>; result: EvidenceResult; createdAt: string }
export interface LaneRequirement { typeId: string; count: number }

const note = z.string().max(2000).optional();
export const EvidencePayload: Record<EvidenceKind, z.ZodTypeAny> = {
  test_run: z.object({ passed: z.number().int().min(0), failed: z.number().int().min(0), output: z.string().max(20000).optional() }).strict(),
  pr_link: z.object({ url: z.string().url().max(2000), title: z.string().max(200).optional() }).strict(),
  eval_score: z.object({ score: z.number().min(0).max(1), note }).strict(),
  screenshot: z.object({ note }).strict(),
  human_signoff: z.object({ note }).strict(),
  file: z.object({ note }).strict(),
  custom: z.object({ result: z.enum(["pass", "fail", "info"]), note }).strict(),
};

export function evaluateEvidence(type: Pick<EvidenceType, "kind" | "params">, payload: unknown): EvidenceResult {
  const p = EvidencePayload[type.kind].parse(payload) as any;
  switch (type.kind) {
    case "test_run": return p.failed === 0 ? "pass" : "fail";
    case "eval_score": return p.score >= (type.params.threshold ?? 0.9) ? "pass" : "fail";
    case "human_signoff": return "pass";
    case "custom": return p.result;
    default: return "info";
  }
}

export function checkGate(requirements: LaneRequirement[], evidence: Pick<Evidence, "typeId" | "result">[]) {
  return requirements
    .map((r) => ({ typeId: r.typeId, need: r.count, have: evidence.filter((e) => e.typeId === r.typeId && e.result !== "fail").length }))
    .filter((r) => r.have < r.need);
}

export const DEFAULT_EVIDENCE_TYPES: Omit<EvidenceType, "createdAt">[] = [
  { id: "et_test_run", name: "Test run", kind: "test_run", params: {}, humanOnly: false, needsAttachment: false },
  { id: "et_pr_link", name: "Pull request", kind: "pr_link", params: {}, humanOnly: false, needsAttachment: false },
  { id: "et_eval_score", name: "Eval score", kind: "eval_score", params: { threshold: 0.9 }, humanOnly: false, needsAttachment: false },
  { id: "et_screenshot", name: "Screenshot", kind: "screenshot", params: {}, humanOnly: false, needsAttachment: true },
  { id: "et_human_signoff", name: "Human sign-off", kind: "human_signoff", params: {}, humanOnly: true, needsAttachment: false },
  { id: "et_file", name: "File", kind: "file", params: {}, humanOnly: false, needsAttachment: true },
];
```
Apply the `schemas.ts` and `permissions.ts` changes listed under Interfaces (import `LaneRequirement` type into `schemas.ts`; export `./evidence` from `index.ts`). Update `DEFAULT_LANES` and its existing test in `schemas.test.ts` to include `evidenceRequirements`.

- [ ] **Step 4: Run** `pnpm vitest run packages/core && pnpm exec tsc -p packages/core` Expected: pass. Other packages will fail to type check until Task 2 (Lane shape changed); that is expected here.
- [ ] **Step 5: Commit** `feat(core): evidence kinds, evaluation, lane gate check`

---

### Task 2: Database migration 3 and thread repositories

**Files:**
- Create: `packages/db/src/thread.ts`; Modify: `packages/db/src/migrations.ts`, `packages/db/src/projects.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/thread.test.ts`, extend `packages/db/src/db.test.ts` (lanes carry requirements)

**Interfaces:**
- `toLane` maps `evidence_requirements` JSON to `evidenceRequirements`; `createProject` writes each default lane's requirements. `setLaneRequirements(db, laneId, requirements: LaneRequirement[]): Lane`.
- `thread.ts`: `listEvidenceTypes(db): EvidenceType[]`, `getEvidenceType(db, id): EvidenceType | undefined`, `addComment(db, c: { ticketId; actorId; body; attachmentIds: string[]; now }): Comment` (also sets `attachments.comment_id` for the given ids), `listComments(db, ticketId): Comment[]` (with `attachmentIds` gathered from attachments), `addAttachment(db, a: Omit<Attachment,"commentId"> & { now?: never }): Attachment` (takes a full object including `createdAt`), `getAttachment(db, id): Attachment | undefined`, `listAttachments(db, ticketId): Attachment[]`, `addEvidence(db, e: Omit<Evidence,"id"|"createdAt"> & { now: string }): Evidence`, `listEvidence(db, ticketId): Evidence[]`, `thread(db, ticketId): { comments: Comment[]; attachments: Attachment[]; evidence: Evidence[] }`.

- [ ] **Step 1: Write the failing tests** `thread.test.ts`

```ts
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as d from "./index";
const NOW = "2026-09-22T10:00:00.000Z";
function world() {
  const db = d.openDatabase(join(mkdtempSync(join(tmpdir(), "pan-")), "p.db"), null); d.migrate(db);
  d.insertActor(db, { id: "human", kind: "human", name: "Owner", publicKey: "11".repeat(32), scopes: null, status: "active", lastSeen: null, createdAt: NOW });
  const { project, lanes } = d.createProject(db, { name: "P", key: "PP" }, NOW);
  const t = d.createTicket(db, { projectId: project.id, title: "x" }, NOW);
  return { db, project, lanes, t };
}
describe("evidence types and lanes", () => {
  it("seeds the six default types and the default lane requirements", () => {
    const { db, lanes } = world();
    expect(d.listEvidenceTypes(db).map((e) => e.id)).toContain("et_eval_score");
    expect(lanes.find((l) => l.name === "Ready for Production")!.evidenceRequirements).toEqual([{ typeId: "et_eval_score", count: 1 }]);
    expect(lanes.find((l) => l.name === "Backlog")!.evidenceRequirements).toEqual([]);
  });
  it("updates lane requirements", () => {
    const { db, lanes } = world();
    const l = d.setLaneRequirements(db, lanes[1].id, [{ typeId: "et_test_run", count: 2 }]);
    expect(l.evidenceRequirements).toEqual([{ typeId: "et_test_run", count: 2 }]);
    expect(d.getLane(db, lanes[1].id)!.evidenceRequirements).toEqual([{ typeId: "et_test_run", count: 2 }]);
  });
});
describe("thread", () => {
  it("stores comments, links attachments, and lists evidence in order", () => {
    const { db, t } = world();
    const a = d.addAttachment(db, { id: "a1", ticketId: t.id, actorId: "human", filename: "shot.png", mime: "image/png", size: 10, sha256: "ab".repeat(32), createdAt: NOW });
    expect(a.commentId).toBeNull();
    const c = d.addComment(db, { ticketId: t.id, actorId: "human", body: "# Done", attachmentIds: ["a1"], now: NOW });
    expect(c.attachmentIds).toEqual(["a1"]);
    expect(d.getAttachment(db, "a1")!.commentId).toBe(c.id);
    const e = d.addEvidence(db, { ticketId: t.id, typeId: "et_test_run", commentId: c.id, attachmentId: null, actorId: "human", payload: { passed: 1, failed: 0 }, result: "pass", now: NOW });
    const th = d.thread(db, t.id);
    expect(th.comments.map((x) => x.id)).toEqual([c.id]);
    expect(th.attachments.map((x) => x.id)).toEqual(["a1"]);
    expect(th.evidence.map((x) => x.id)).toEqual([e.id]);
    expect(d.listEvidence(db, t.id)[0]).toMatchObject({ result: "pass", payload: { passed: 1, failed: 0 } });
  });
  it("refuses updates and deletes on comments and evidence", () => {
    const { db, t } = world();
    const c = d.addComment(db, { ticketId: t.id, actorId: "human", body: "x", attachmentIds: [], now: NOW });
    d.addEvidence(db, { ticketId: t.id, typeId: "et_file", commentId: null, attachmentId: null, actorId: "human", payload: {}, result: "info", now: NOW });
    expect(() => db.prepare("update comments set body='y' where id=?").run(c.id)).toThrow(/append-only/);
    expect(() => db.prepare("delete from comments where id=?").run(c.id)).toThrow(/append-only/);
    expect(() => db.prepare("delete from evidence").run()).toThrow(/append-only/);
  });
});
```
In `db.test.ts`, extend the default lanes test: `expect(lanes[4].evidenceRequirements).toEqual([{ typeId: "et_eval_score", count: 1 }])`.

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement**

Migration M3 (append to `MIGRATIONS`):
```ts
const M3 = `
create table evidence_types(id text primary key, name text not null unique, kind text not null, params text not null default '{}',
  human_only integer not null default 0, needs_attachment integer not null default 0, created_at text not null);
create table comments(id text primary key, ticket_id text not null references tickets(id), actor_id text not null references actors(id),
  body text not null, created_at text not null);
create index comments_ticket on comments(ticket_id, created_at);
create trigger comments_no_update before update on comments begin select raise(abort, 'comments are append-only'); end;
create trigger comments_no_delete before delete on comments begin select raise(abort, 'comments are append-only'); end;
create table attachments(id text primary key, ticket_id text not null references tickets(id), comment_id text references comments(id),
  actor_id text not null references actors(id), filename text not null, mime text not null, size integer not null, sha256 text not null, created_at text not null);
create index attachments_ticket on attachments(ticket_id, created_at);
create trigger attachments_no_delete before delete on attachments begin select raise(abort, 'attachments are append-only'); end;
create table evidence(id text primary key, ticket_id text not null references tickets(id), type_id text not null references evidence_types(id),
  comment_id text references comments(id), attachment_id text references attachments(id), actor_id text not null references actors(id),
  payload text not null, result text not null check(result in('pass','fail','info')), created_at text not null);
create index evidence_ticket on evidence(ticket_id, created_at);
create trigger evidence_no_update before update on evidence begin select raise(abort, 'evidence is append-only'); end;
create trigger evidence_no_delete before delete on evidence begin select raise(abort, 'evidence is append-only'); end;
` + DEFAULT_EVIDENCE_TYPES.map((e) => `insert into evidence_types(id, name, kind, params, human_only, needs_attachment, created_at) values(${[e.id, e.name, e.kind, JSON.stringify(e.params)].map((v) => `'${v}'`).join(",")}, ${e.humanOnly ? 1 : 0}, ${e.needsAttachment ? 1 : 0}, '2026-09-22T00:00:00.000Z');`).join("\n");
```
(Import `DEFAULT_EVIDENCE_TYPES` from `@panorama/core`. The seeded values contain no quotes, so string interpolation into the migration is safe; add a comment saying so.)

`projects.ts`: `toLane` adds `evidenceRequirements: JSON.parse(r.evidence_requirements)`; `createProject` inserts `JSON.stringify(l.evidenceRequirements)` into `evidence_requirements`; add:
```ts
export function setLaneRequirements(db: DB, laneId: string, requirements: LaneRequirement[]): Lane {
  db.prepare("update lanes set evidence_requirements = ? where id = ?").run(JSON.stringify(requirements), laneId);
  return getLane(db, laneId)!;
}
```
`thread.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { Attachment, Comment, Evidence, EvidenceType } from "@panorama/core";
import type { DB } from "./open";
const toType = (r: any): EvidenceType => ({ id: r.id, name: r.name, kind: r.kind, params: JSON.parse(r.params), humanOnly: !!r.human_only, needsAttachment: !!r.needs_attachment, createdAt: r.created_at });
const toAtt = (r: any): Attachment => ({ id: r.id, ticketId: r.ticket_id, commentId: r.comment_id, actorId: r.actor_id, filename: r.filename, mime: r.mime, size: r.size, sha256: r.sha256, createdAt: r.created_at });
const toEv = (r: any): Evidence => ({ id: r.id, ticketId: r.ticket_id, typeId: r.type_id, commentId: r.comment_id, attachmentId: r.attachment_id, actorId: r.actor_id, payload: JSON.parse(r.payload), result: r.result, createdAt: r.created_at });
export const listEvidenceTypes = (db: DB): EvidenceType[] => db.prepare("select * from evidence_types order by created_at, name").all().map(toType);
export const getEvidenceType = (db: DB, id: string): EvidenceType | undefined => { const r = db.prepare("select * from evidence_types where id = ?").get(id); return r ? toType(r) : undefined; };
export function addAttachment(db: DB, a: Omit<Attachment, "commentId">): Attachment {
  db.prepare("insert into attachments(id, ticket_id, comment_id, actor_id, filename, mime, size, sha256, created_at) values(?,?,null,?,?,?,?,?,?)")
    .run(a.id, a.ticketId, a.actorId, a.filename, a.mime, a.size, a.sha256, a.createdAt);
  return getAttachment(db, a.id)!;
}
export const getAttachment = (db: DB, id: string): Attachment | undefined => { const r = db.prepare("select * from attachments where id = ?").get(id); return r ? toAtt(r) : undefined; };
export const listAttachments = (db: DB, ticketId: string): Attachment[] => db.prepare("select * from attachments where ticket_id = ? order by created_at, id").all(ticketId).map(toAtt);
export function addComment(db: DB, c: { ticketId: string; actorId: string; body: string; attachmentIds: string[]; now: string }): Comment {
  const id = randomUUID();
  db.prepare("insert into comments(id, ticket_id, actor_id, body, created_at) values(?,?,?,?,?)").run(id, c.ticketId, c.actorId, c.body, c.now);
  const link = db.prepare("update attachments set comment_id = ? where id = ? and ticket_id = ? and comment_id is null");
  for (const a of c.attachmentIds) link.run(id, a, c.ticketId);
  return listComments(db, c.ticketId).find((x) => x.id === id)!;
}
export function listComments(db: DB, ticketId: string): Comment[] {
  const atts = listAttachments(db, ticketId);
  return db.prepare("select * from comments where ticket_id = ? order by created_at, id").all(ticketId)
    .map((r: any) => ({ id: r.id, ticketId: r.ticket_id, actorId: r.actor_id, body: r.body, createdAt: r.created_at, attachmentIds: atts.filter((a) => a.commentId === r.id).map((a) => a.id) }));
}
export function addEvidence(db: DB, e: Omit<Evidence, "id" | "createdAt"> & { now: string }): Evidence {
  const id = randomUUID();
  db.prepare("insert into evidence(id, ticket_id, type_id, comment_id, attachment_id, actor_id, payload, result, created_at) values(?,?,?,?,?,?,?,?,?)")
    .run(id, e.ticketId, e.typeId, e.commentId, e.attachmentId, e.actorId, JSON.stringify(e.payload), e.result, e.now);
  return toEv(db.prepare("select * from evidence where id = ?").get(id));
}
export const listEvidence = (db: DB, ticketId: string): Evidence[] => db.prepare("select * from evidence where ticket_id = ? order by created_at, id").all(ticketId).map(toEv);
export const thread = (db: DB, ticketId: string) => ({ comments: listComments(db, ticketId), attachments: listAttachments(db, ticketId), evidence: listEvidence(db, ticketId) });
```
Export `./thread` from `index.ts`.

- [ ] **Step 4: Run** `pnpm test && pnpm exec tsc -p packages/db && pnpm exec tsc -p apps/server` Expected: pass (server compiles because `Lane` is only read there).
- [ ] **Step 5: Commit** `feat(db): comments, attachments, evidence, lane requirements`

---

### Task 3: Thread, evidence, and gate routes; gate enforced on move

**Files:**
- Create: `apps/server/src/routes/thread.ts`; Modify: `apps/server/src/routes/tickets.ts`, `apps/server/src/app.ts`, `apps/server/src/test/helpers.ts`
- Test: `apps/server/src/thread.test.ts`, extend `apps/server/src/tickets.test.ts`

**Interfaces:**
- Routes:
  - `GET /api/v1/evidence-types` (`read`) → `EvidenceType[]`
  - `PUT /api/v1/lanes/:id/requirements {requirements}` (`lane.edit`; every `typeId` must exist else 400 `validation`) → `Lane`; event `lane.requirements_set {id, requirements}`
  - `GET /api/v1/tickets/:id/thread` (`read` in the ticket's project) → `{comments, attachments, evidence, actors: Pick<Actor,"id"|"name"|"kind">[]}` (actors referenced by the thread, so the UI needs no extra call)
  - `POST /api/v1/comments {ticketId, body, attachmentIds?}` (`comment.add`): body is passed through `sanitizeCommentBody` (Task 3 defines it here: `sanitize-html` over the whole body with an allowlist of `p, br, b, strong, i, em, u, s, code, pre, h1..h6, ul, ol, li, blockquote, hr, table, thead, tbody, tr, th, td, a[href], img[src,alt], div, span, details, summary` and `allowedSchemes: ["https","http","attachment"]`, `disallowedTagsMode: "discard"`; markdown syntax is untouched because sanitize-html only rewrites tags); every attachment id must exist, belong to the ticket, have been uploaded by the same actor, and be unlinked, else 400 `validation` with `details.attachmentId`; → `Comment`; event `comment.added {id, ticketId}`
  - `POST /api/v1/evidence {ticketId, typeId, payload, attachmentId?, commentId?}` (`evidence.add`; when the type is `humanOnly` also `requireCan(req,"evidence.signoff")`): payload validated by `evaluateEvidence` (ZodError → 400); `needsAttachment` types require an `attachmentId` that belongs to the ticket else 400 `validation`; `commentId` must belong to the ticket; → `Evidence`; event `evidence.added {id, ticketId, typeId, result}`
  - `GET /api/v1/tickets/:id/gates` (`read`) → `Record<laneId, { typeId, name, need, have }[]>` for every lane of the project (empty array means allowed)
- `POST /api/v1/tickets/:id/move` gains the gate: before the transaction, `const missing = checkGate(lane.evidenceRequirements, listEvidence(db, t.id))`; if non-empty throw `HttpError(422, "gate", \`${lane.name} needs evidence first\`, { laneId, missing: missing.map(m => ({ ...m, name: getEvidenceType(db, m.typeId)?.name ?? m.typeId })) })`.
- `test/helpers.ts` gains `agentIn(s: Awaited<ReturnType<typeof setupApp>>, projectId: string, actions?: AgentAction[]): Promise<{ agent: ReturnType<typeof client>; agentId: string }>` registering and approving an agent with all `AGENT_ACTIONS` by default.

- [ ] **Step 1: Write the failing tests** `thread.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { verifyChain } from "@panorama/core";
import { listEvents } from "@panorama/db";
import { agentIn, setupApp } from "./test/helpers";

async function world() {
  const s = await setupApp();
  const { project, lanes } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
  const { agent, agentId } = await agentIn(s, project.id);
  const t = (await agent("POST", "/api/v1/tickets", { projectId: project.id, title: "Ship" })).json;
  return { ...s, project, lanes, agent, agentId, t, lane: (n: string) => lanes.find((l: any) => l.name === n) };
}

describe("gate", () => {
  it("refuses a move into a lane whose evidence is missing, from agent and human alike", async () => {
    const w = await world();
    const rfp = w.lane("Ready for Production");
    const r = await w.agent("POST", `/api/v1/tickets/${w.t.id}/move`, { laneId: rfp.id });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({ code: "gate", details: { laneId: rfp.id, missing: [{ typeId: "et_eval_score", name: "Eval score", need: 1, have: 0 }] } });
    expect((await w.human("POST", `/api/v1/tickets/${w.t.id}/move`, { laneId: rfp.id })).status).toBe(422);
    const gates = (await w.human("GET", `/api/v1/tickets/${w.t.id}/gates`)).json;
    expect(gates[rfp.id]).toHaveLength(1); expect(gates[w.lane("Backlog").id]).toEqual([]);
  });
  it("lets the move through once passing evidence exists, and failing evidence does not count", async () => {
    const w = await world(); const rfp = w.lane("Ready for Production");
    expect((await w.agent("POST", "/api/v1/evidence", { ticketId: w.t.id, typeId: "et_eval_score", payload: { score: 0.5 } })).json.result).toBe("fail");
    expect((await w.agent("POST", `/api/v1/tickets/${w.t.id}/move`, { laneId: rfp.id })).status).toBe(422);
    expect((await w.agent("POST", "/api/v1/evidence", { ticketId: w.t.id, typeId: "et_eval_score", payload: { score: 0.95 } })).json.result).toBe("pass");
    const moved = await w.agent("POST", `/api/v1/tickets/${w.t.id}/move`, { laneId: rfp.id });
    expect(moved.status).toBe(200); expect(moved.json.flags).toEqual(["needs_human"]);
  });
  it("only the human can sign off, and Done needs the sign-off", async () => {
    const w = await world(); const done = w.lane("Done");
    expect((await w.agent("POST", "/api/v1/evidence", { ticketId: w.t.id, typeId: "et_human_signoff", payload: {} })).status).toBe(403);
    expect((await w.human("POST", `/api/v1/tickets/${w.t.id}/move`, { laneId: done.id })).status).toBe(422);
    expect((await w.human("POST", "/api/v1/evidence", { ticketId: w.t.id, typeId: "et_human_signoff", payload: { note: "looks right" } })).json.result).toBe("pass");
    expect((await w.human("POST", `/api/v1/tickets/${w.t.id}/move`, { laneId: done.id })).status).toBe(200);
  });
  it("validates payloads and attachment requirements", async () => {
    const w = await world();
    expect((await w.agent("POST", "/api/v1/evidence", { ticketId: w.t.id, typeId: "et_test_run", payload: { passed: "x" } })).status).toBe(400);
    expect((await w.agent("POST", "/api/v1/evidence", { ticketId: w.t.id, typeId: "et_screenshot", payload: {} })).json.error.code).toBe("validation");
    expect((await w.agent("POST", "/api/v1/evidence", { ticketId: w.t.id, typeId: "nope", payload: {} })).status).toBe(404);
  });
});

describe("comments and lanes", () => {
  it("appends comments, sanitises html, refuses foreign attachments, and reports the thread", async () => {
    const w = await world();
    const c = (await w.agent("POST", "/api/v1/comments", { ticketId: w.t.id, body: "# Done\n\n<script>alert(1)</script><b>bold</b>" })).json;
    expect(c.body).toBe("# Done\n\n<b>bold</b>");
    expect((await w.agent("POST", "/api/v1/comments", { ticketId: w.t.id, body: "x", attachmentIds: ["missing"] })).json.error.code).toBe("validation");
    const th = (await w.human("GET", `/api/v1/tickets/${w.t.id}/thread`)).json;
    expect(th.comments.map((x: any) => x.body)).toEqual(["# Done\n\n<b>bold</b>"]);
    expect(th.actors.map((a: any) => a.id)).toContain(w.agentId);
    expect((await w.human("GET", "/api/v1/evidence-types")).json).toHaveLength(6);
  });
  it("lets only the human set lane requirements, with real type ids", async () => {
    const w = await world(); const ready = w.lane("Ready");
    expect((await w.agent("PUT", `/api/v1/lanes/${ready.id}/requirements`, { requirements: [{ typeId: "et_test_run", count: 1 }] })).status).toBe(403);
    expect((await w.human("PUT", `/api/v1/lanes/${ready.id}/requirements`, { requirements: [{ typeId: "nope", count: 1 }] })).status).toBe(400);
    const l = (await w.human("PUT", `/api/v1/lanes/${ready.id}/requirements`, { requirements: [{ typeId: "et_test_run", count: 1 }] })).json;
    expect(l.evidenceRequirements).toEqual([{ typeId: "et_test_run", count: 1 }]);
    expect((await w.agent("POST", `/api/v1/tickets/${w.t.id}/move`, { laneId: ready.id })).status).toBe(422);
    const types = listEvents(w.app.ctx.db!).map((e) => e.type);
    expect(types).toContain("lane.requirements_set"); expect(verifyChain(listEvents(w.app.ctx.db!)).ok).toBe(true);
  });
});
```
Also add to `tickets.test.ts` a check that the existing "milestone story" test still passes by attaching `et_eval_score` evidence before moving to Ready for Production.

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement** `routes/thread.ts` following the `ticketRoutes` pattern (`iso`, `load`, `log` helpers copied; `getDb`, `requireCan`, `HttpError`). `sanitizeCommentBody` uses `sanitize-html` as specified (add the dependency to `apps/server`). Register `threadRoutes(app, ctx)` after `ticketRoutes` in `app.ts`. Add the gate to the move route. Add `agentIn` to helpers:
```ts
export async function agentIn(s: { app: any; human: any }, projectId: string, actions: AgentAction[] = [...AGENT_ACTIONS]) {
  const ak = await deriveKeys("agent-secret-" + randomHex(4), "11".repeat(16), ARGON_FAST);
  const id = (await s.app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker-" + id8(), publicKey: ak.publicKeyHex } })).json().id;
  await s.human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: [projectId], actions } });
  return { agent: client(s.app, ak.seed, id), agentId: id };
}
```
(`id8 = () => randomHex(4)`.)

- [ ] **Step 4: Run** `pnpm test && pnpm exec tsc -p apps/server` Expected: pass.
- [ ] **Step 5: Commit** `feat(server): thread, evidence, lane requirements, gated moves`

---

### Task 4: Encrypted attachments

**Files:**
- Create: `apps/server/src/files.ts`, `apps/server/src/routes/attachments.ts`; Modify: `apps/server/src/context.ts`, `routes/lifecycle.ts`, `app.ts`, `test/helpers.ts`
- Test: `apps/server/src/files.test.ts`, `apps/server/src/attachments.test.ts`

**Interfaces:**
- `Ctx` gains `fileKey: Buffer | null` (set from `dbKey` at setup and unlock when encryption is on, cleared at lock; `null` when encryption is off).
- `files.ts`: `filePath(dataDir, id): string` (`<dataDir>/files/<id>`, id validated `/^[0-9a-f-]{36}$/`), `storeFile(dataDir, key: Buffer | null, id, bytes: Buffer): Promise<void>` (dir created 0700, file 0600; when `key`: 12 random IV bytes + AES-256-GCM ciphertext + 16 byte tag), `readFile(dataDir, key, id): Promise<Buffer>` (throws `Error("file_auth")` on a bad tag).
- Routes:
  - `POST /api/v1/attachments` multipart (`@fastify/multipart`, limit `fileSize: 50 * 1024 * 1024`, `files: 1`): fields `ticketId`, file part `file`. Permission `attachment.add` in the ticket's project. Filename sanitised to its basename, max 200 chars. Mime taken from the part, lower-cased; allowed: `image/png, image/jpeg, image/gif, image/webp, image/svg+xml, text/plain, text/markdown, text/html, application/json, application/pdf, application/zip, application/octet-stream`; anything else 415 `unsupported_type`. Over the cap 413 `too_large`. Sha256 computed over the plain bytes. Returns `Attachment`; event `attachment.added {id, ticketId, filename, mime, size}`.
  - `GET /api/v1/attachments/:id` (`read` in the ticket's project): bytes with `content-length`, `x-content-type-options: nosniff`, `content-disposition: attachment; filename="<ascii-safe name>"`; `content-type` is the stored mime for `image/png, image/jpeg, image/gif, image/webp, application/pdf, application/json, text/plain, text/markdown`, and `application/octet-stream` for everything else (html and svg are never served as themselves).
- Signing rule for multipart: `signRequest` hashes a UTF-8 string, so binary bodies are not signed byte for byte. For any request whose `content-type` starts with `multipart/`, the signature covers the empty string as the body, and `installAuth` verifies with `""` in that case. The upload is still bound to the actor, the path, the timestamp, and the nonce. Task 11 states this in the README signing section.
- Tests must not need a browser: `test/helpers.ts` gains `multipart(fields: Record<string,string>, file: { name: string; mime: string; bytes: Buffer }): { body: Buffer; contentType: string }` building a boundary body by hand, and `client` accepts an optional 4th argument `raw?: { body: Buffer; contentType: string }` that sends those bytes with that content type and signs `""`.

- [ ] **Step 1: Write the failing tests**

`files.test.ts`:
```ts
import { mkdtempSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filePath, readFile, storeFile } from "./files";
const id = "0f0f0f0f-0000-4000-8000-000000000001";
describe("files", () => {
  it("round trips plain and encrypted bytes and refuses a tampered ciphertext", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pan-files-")); const key = Buffer.alloc(32, 7); const bytes = Buffer.from("hello attachments");
    await storeFile(dir, null, id, bytes); expect(await readFile(dir, null, id)).toEqual(bytes);
    await storeFile(dir, key, id, bytes);
    expect(readFileSync(filePath(dir, id)).includes("hello")).toBe(false);
    expect(await readFile(dir, key, id)).toEqual(bytes);
    await expect(readFile(dir, Buffer.alloc(32, 8), id)).rejects.toThrow("file_auth");
    expect(() => filePath(dir, "../etc/passwd")).toThrow();
  });
});
```
`attachments.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { signRequest } from "@panorama/core";
import { agentIn, multipart, setupApp } from "./test/helpers";
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
async function world() { const s = await setupApp(); const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json; const { agent } = await agentIn(s, project.id); const t = (await agent("POST", "/api/v1/tickets", { projectId: project.id, title: "x" })).json; return { ...s, project, agent, t }; }
describe("attachments", () => {
  it("uploads, stores encrypted, serves with safe headers, and links to a comment", async () => {
    const w = await world();
    const up = await w.agent("POST", "/api/v1/attachments", undefined, multipart({ ticketId: w.t.id }, { name: "shot.png", mime: "image/png", bytes: png }));
    expect(up.status).toBe(200); expect(up.json).toMatchObject({ filename: "shot.png", mime: "image/png", size: png.length, commentId: null });
    const res = await w.app.inject({ method: "GET", url: `/api/v1/attachments/${up.json.id}`, headers: await signRequest(w.keys.seed, "human", "GET", `/api/v1/attachments/${up.json.id}`, "") });
    expect(res.statusCode).toBe(200); expect(res.headers["content-type"]).toBe("image/png"); expect(res.headers["x-content-type-options"]).toBe("nosniff"); expect(res.rawPayload).toEqual(png);
    const c = (await w.agent("POST", "/api/v1/comments", { ticketId: w.t.id, body: `![shot](attachment:${up.json.id})`, attachmentIds: [up.json.id] })).json;
    expect(c.attachmentIds).toEqual([up.json.id]);
    expect((await w.agent("POST", "/api/v1/comments", { ticketId: w.t.id, body: "again", attachmentIds: [up.json.id] })).status).toBe(400);
  });
  it("serves html as octet-stream, refuses unknown types, and hides files across scopes", async () => {
    const w = await world();
    const html = await w.agent("POST", "/api/v1/attachments", undefined, multipart({ ticketId: w.t.id }, { name: "r.html", mime: "text/html", bytes: Buffer.from("<b>x</b>") }));
    const res = await w.app.inject({ method: "GET", url: `/api/v1/attachments/${html.json.id}`, headers: await signRequest(w.keys.seed, "human", "GET", `/api/v1/attachments/${html.json.id}`, "") });
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect((await w.agent("POST", "/api/v1/attachments", undefined, multipart({ ticketId: w.t.id }, { name: "x.exe", mime: "application/x-msdownload", bytes: png }))).status).toBe(415);
    const other = (await w.human("POST", "/api/v1/projects", { name: "O", key: "OO" })).json;
    const { agent: outsider } = await agentIn(w, other.project.id);
    expect((await outsider("GET", `/api/v1/attachments/${html.json.id}`)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement** `files.ts` with `node:crypto` (`createCipheriv("aes-256-gcm")`), the routes, `ctx.fileKey` wiring (`Buffer.from(dbKey, "hex")` at setup when `encryption`, at unlock; `null` at lock and when encryption is off), multipart registration in `app.ts` before routes (`await app.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } })`), and the auth adjustment: in `installAuth`, when `req.headers["content-type"]` starts with `multipart/`, verify with body `""`. Helpers: `multipart()` and the `client` 4th argument (sets `content-type` to the boundary type, sends `body`, signs `""`).

- [ ] **Step 4: Run** `pnpm test && pnpm exec tsc -p apps/server`. **Step 5: Commit** `feat(server): encrypted attachments with safe serving`

---

### Task 5: Event bus and server-sent events

**Files:**
- Create: `apps/server/src/bus.ts`; Modify: `context.ts`, `app.ts`, every route file that logs events (`tickets.ts`, `thread.ts`, `attachments.ts`, `agents.ts`, `projects.ts`, `lifecycle.ts`)
- Test: `apps/server/src/stream.test.ts`

**Interfaces:**
- `bus.ts`: `class EventBus { subscribe(fn: (e: StreamEvent) => void): () => void; publish(e: StreamEvent): void; closeAll(): void }`, `interface StreamEvent { seq: number; type: string; payload: unknown; at: string }`, `record(req: FastifyRequest, ev: ChainEvent): void` (pushes onto `req.emitted`), `installStream(app, ctx)`: registers an `onResponse` hook that publishes `req.emitted` when `reply.statusCode < 400`, and the route `GET /api/v1/stream` (`read`): replies `text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`, sends `: connected\n\n`, then for every published event `id: <seq>\nevent: <type>\ndata: <json>\n\n` filtered by scope (events whose payload carries a `projectId` or a ticket id resolve to a project; agents see only their projects; human sees all), plus a `: ping\n\n` every 15 s; unsubscribes on `req.raw.on("close")`. `POST /lock` calls `ctx.bus.closeAll()` which ends every stream response.
- Every existing `log` helper becomes `const log = (db, req, type, payload) => { const ev = appendEvent(...); record(req, ev); return ev; }`. `agents.ts` register route records too (its actor is the pending agent, human sees it). Ticket events carry `projectId` in their payload from now on (add it where missing: `ticket.created`, `ticket.moved`, `ticket.updated`, `ticket.flag_set`, `ticket.flag_cleared`, `ticket.archived`, `comment.added`, `evidence.added`, `attachment.added`, `lane.requirements_set`).

- [ ] **Step 1: Write the failing test** `stream.test.ts` (uses a real listening socket because `inject` cannot read an open stream)

```ts
import { describe, expect, it } from "vitest";
import { signRequest } from "@panorama/core";
import { agentIn, setupApp } from "./test/helpers";

async function open(app: any, seed: Uint8Array, actor: string) {
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const res = await fetch(base + "/api/v1/stream", { headers: await signRequest(seed, actor, "GET", "/api/v1/stream", "") });
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  const next = async (): Promise<{ type: string; data: any }> => {
    for (;;) { const i = buf.indexOf("\n\n"); if (i >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); if (chunk.startsWith(":")) continue;
      const type = /event: (.*)/.exec(chunk)![1]; const data = JSON.parse(/data: (.*)/.exec(chunk)![1]); return { type, data }; }
      const { value, done } = await reader.read(); if (done) throw new Error("closed"); buf += dec.decode(value); }
  };
  return { res, next, base, close: () => reader.cancel() };
}

describe("stream", () => {
  it("delivers committed events to the human and only in-scope events to an agent, and ends on lock", async () => {
    const s = await setupApp();
    const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
    const other = (await s.human("POST", "/api/v1/projects", { name: "O", key: "OO" })).json;
    const { agent } = await agentIn(s, project.id);
    const h = await open(s.app, s.keys.seed, "human");
    const t = (await agent("POST", "/api/v1/tickets", { projectId: project.id, title: "x" })).json;
    expect(await h.next()).toMatchObject({ type: "ticket.created", data: { id: t.id, projectId: project.id } });
    await s.human("POST", "/api/v1/tickets", { projectId: other.project.id, title: "y" });
    expect((await h.next()).type).toBe("ticket.created");
    expect((await s.human("POST", "/api/v1/comments", { ticketId: t.id, body: "hi" })).status).toBe(200);
    expect((await h.next()).type).toBe("comment.added");
    await s.human("POST", "/api/v1/lock");
    await expect(h.next()).rejects.toThrow("closed");
    await s.app.close();
  });
  it("does not publish events from a request that failed", async () => {
    const s = await setupApp();
    const { project, lanes } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json;
    const h = await open(s.app, s.keys.seed, "human");
    const t = (await s.human("POST", "/api/v1/tickets", { projectId: project.id, title: "x" })).json; await h.next();
    expect((await s.human("POST", `/api/v1/tickets/${t.id}/move`, { laneId: lanes[4].id })).status).toBe(422);
    await s.human("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "blocked", on: true });
    expect((await h.next()).type).toBe("ticket.flag_set");
    h.close(); await s.app.close();
  });
});
```

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement** as specified. Scope filter in the stream route: resolve `projectId` from `payload.projectId`; events without one (`agent.*`, `system.*`, `project.created`) go to the human only, except `agent.approved`/`agent.revoked` which also go to that agent. Heartbeat with `setInterval`, cleared on close. `closeAll` calls `reply.raw.end()` for every open stream.

- [ ] **Step 4: Run** `pnpm test`. **Step 5: Commit** `feat(server): event bus and server-sent events`

---

### Task 6: Web stream client replaces polling

**Files:**
- Create: `apps/web/src/lib/stream.ts`; Modify: `apps/web/src/lib/hooks.ts`, `apps/web/src/views/Shell.tsx`, `apps/web/src/views/Agents.tsx`
- Test: `apps/web/src/lib/stream.test.ts`

**Interfaces:**
- `connectStream(opts: { fetchImpl?: typeof fetch; signal: AbortSignal; onEvent: (e: { type: string; data: any }) => void; onStatus: (s: "open" | "closed") => void }): Promise<void>`: signed GET (headers from `signRequest` with the session seed as `human`), parses SSE frames, ignores comment lines, reconnects with backoff 1 s, 2 s, 4 s, capped 15 s, until aborted; on 423 or 401 stops and lets the existing `api()` session handling apply (`session.clear()`).
- `invalidationsFor(type: string, data: any): unknown[][]` (pure, exported for the test): `ticket.*` → `["queue"]`, `["tickets"]`, `["ticket", data.id]`, `["gates", data.id]`; `comment.added`, `evidence.added`, `attachment.added` → `["thread", data.ticketId]`, `["ticket", data.ticketId]`, `["gates", data.ticketId]`, `["queue"]`; `agent.*` → `["agents"]`; `lane.*`, `project.*` → `["lanes"]`, `["projects"]`, `["gates"]`.
- `useStream()` in `hooks.ts`: effect that connects while a seed exists and invalidates through `queryClient`; exposes `"open" | "closed"` for the sidebar footer, which shows `live` or `reconnecting` in mono next to the chain status.
- `useAgents` loses its `refetchInterval` option and `Agents.tsx` stops passing it.

- [ ] **Step 1: Write the failing test** `stream.test.ts` (node env): feed `connectStream` a fake `fetchImpl` returning a `Response` whose body is a `ReadableStream` emitting `": connected\n\n"`, then `"id: 1\nevent: ticket.moved\ndata: {\"id\":\"t1\",\"projectId\":\"p\"}\n\n"` split across two chunks, then closing; assert `onEvent` got exactly one event with `type: "ticket.moved"` and `data.id === "t1"`, `onStatus` saw `open` then `closed`, and after abort no further fetch happens (count calls). Test `invalidationsFor("comment.added", { ticketId: "t1" })` contains `["thread","t1"]` and `["queue"]`.

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement.** Reconnect loop: `while (!signal.aborted) { try { await once() } catch {} ; await sleep(backoff) }` with `sleep` racing the abort signal. Ensure `pnpm vitest run apps/web` and `pnpm --filter @panorama/web build` pass and `grep -rn refetchInterval apps/web/src` returns nothing.

- [ ] **Step 4: Commit** `feat(web): live updates over server-sent events`

---

### Task 7: Markdown pipeline with sandboxed HTML and attachment images

**Files:**
- Create: `apps/web/src/lib/markdown.tsx`, `apps/web/src/lib/attachments.ts`; Modify: `apps/web/package.json` (add `marked`, `dompurify`, `@types/dompurify` if needed)
- Test: `apps/web/src/lib/markdown.test.tsx` (`// @vitest-environment jsdom`)

**Interfaces:**
- `attachments.ts`: `fetchBlob(path: string): Promise<Blob>` (signed like `api()` but returns the blob; 4xx throws `ApiError`), `uploadFile(ticketId: string, file: File, onProgress?: (n: number) => void): Promise<Attachment>` (signed multipart POST with body signature `""` per Task 4; uses `XMLHttpRequest` for progress), `useAttachmentUrl(id: string | null): string | null` (react-query keyed `["attachment-url", id]`, fetches the blob once, `URL.createObjectURL`, revoked on unmount via `gcTime` and an effect).
- `markdown.tsx`: `renderBlocks(md: string): Block[]` where `Block = { kind: "rich"; html: string } | { kind: "html"; html: string }`: uses `marked.lexer`; consecutive non-`html` tokens are parsed with `marked.parser` and sanitised with DOMPurify (`USE_PROFILES: {html: true}`, `FORBID_TAGS: ["style","iframe","object","embed","form","input"]`, `ALLOWED_URI_REGEXP` allowing `https?:`, `mailto:`, and `attachment:`); each `html` token (a raw HTML block) or a fenced code block with lang `html` becomes a `{kind:"html"}` block whose html is DOMPurify-sanitised with `WHOLE_DOCUMENT: false`, `FORBID_TAGS: ["script"]` and no event handlers. `<Markdown body attachments />`: renders rich blocks with `dangerouslySetInnerHTML` (the only place in the app), rewriting `<img src="attachment:ID">` to an `<AttachmentImage id>` that uses `useAttachmentUrl` (do the rewrite by rendering rich blocks into a container and replacing matched `img` elements with React portals, or simpler: pre-split rich html at `<img src="attachment:...">` boundaries into segments and render images as React elements; choose the second), and `<a href="attachment:ID">` as a link that downloads through `fetchBlob` on click; renders html blocks with `<HtmlFrame html />`. `<HtmlFrame html />`: `<iframe sandbox="" referrerPolicy="no-referrer" srcDoc={...}>` where the document is `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'"><style>body{margin:0;font:14px/1.5 system-ui;color:#1B2230}</style>` + html; the document is opaque to the parent (no `allow-same-origin`), so the frame cannot auto-size; it gets a fixed `height: 320px` with `resize: vertical`, noted in a code comment. The frame is titled "Rendered HTML".

- [ ] **Step 1: Write the failing test** `markdown.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderBlocks } from "./markdown";
describe("renderBlocks", () => {
  it("renders markdown to sanitised html and keeps attachment links", () => {
    const [b] = renderBlocks("# Title\n\nsome **bold** and ![shot](attachment:abc) and [f](attachment:def) <img src=x onerror=alert(1)>");
    expect(b.kind).toBe("rich");
    expect(b.html).toContain("<h1>Title</h1>"); expect(b.html).toContain("<strong>bold</strong>");
    expect(b.html).toContain('src="attachment:abc"'); expect(b.html).toContain('href="attachment:def"');
    expect(b.html).not.toContain("onerror");
  });
  it("splits raw html blocks and html fences into frame blocks with scripts removed", () => {
    const blocks = renderBlocks("before\n\n<div class=\"report\"><script>x()</script><b>ok</b></div>\n\nafter\n\n```html\n<p onclick=\"y()\">hi</p>\n```\n");
    expect(blocks.map((b) => b.kind)).toEqual(["rich", "html", "rich", "html"]);
    expect(blocks[1].html).toContain("<b>ok</b>"); expect(blocks[1].html).not.toContain("script");
    expect(blocks[3].html).toBe("<p>hi</p>");
  });
  it("strips javascript urls", () => {
    expect(renderBlocks("[x](javascript:alert(1))")[0].html).not.toContain("javascript:");
  });
});
```

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement** as specified. **Step 4: Run** `pnpm vitest run apps/web && pnpm --filter @panorama/web build`. **Step 5: Commit** `feat(web): markdown rendering with sandboxed html and attachment images`

---

### Task 8: Composer and thread in the ticket panel

**Files:**
- Create: `apps/web/src/components/Composer.tsx`, `apps/web/src/components/Thread.tsx`, `apps/web/src/components/EvidenceChip.tsx`; Modify: `apps/web/src/lib/hooks.ts` (`useThread(ticketId)` keyed `["thread", id]`, `useAddComment()` invalidating `["thread", ticketId]`, `["queue"]`), `apps/web/src/views/TicketPanel.tsx`, `apps/web/src/styles/app.css`, `apps/web/package.json`
- Test: `apps/web/src/components/Composer.test.tsx` (`// @vitest-environment jsdom`)

**Interfaces:**
- `<Composer ticketId onPosted />`: TipTap `useEditor` with `StarterKit` (heading levels 1 to 3, horizontal rule, code block, blockquote, lists, bold, italic, strike, code) and `tiptap-markdown` (`html: true, transformPastedText: true`); no toolbar; placeholder "Write a comment"; input rules give `#`, `##`, `-`, `1.`, `>`, `---`, backticks, `**`; `[]` at line start becomes a task item only if `@tiptap/extension-task-list` is added: it is not, so `[]` stays literal text in this milestone. Drop or paste of files: each file goes through `uploadFile`; while uploading a row "Uploading <name> 42%" shows below the editor; on success an image becomes `![name](attachment:id)` inserted at the cursor, another file `[name](attachment:id)`; the id is added to `attachmentIds` for the post. Submit with the "Comment" button or Ctrl or Cmd plus Enter; disabled while empty or in flight; error shown with `role="alert"`; on success the editor clears and `onPosted()` runs. Exports `composerMarkdown(editor): string` for the test.
- `<Thread ticketId actors />`: renders the thread in time order: each comment as a `card` with author name (agent or "You"), mono time, the word `signed` in mono, `<Markdown>` body, attachment rows (name, size, download link), and the `EvidenceChip`s whose `commentId` matches; evidence without a comment renders as its own entry "<actor> attached evidence". Empty: "No comments yet." Loading: two skeletons.
- `<EvidenceChip evidence type />`: pill with family `mint` for pass, `coral` for fail, `stone` for info; text `<result upper> <type name>` plus the key number (`12/12` for test runs, `0.94` for eval, a link for pr_link).
- Panel: the thread and the composer sit below the metadata list; the composer is last. The panel's `Escape` handler must not fire while the editor has focus (TipTap handles Escape itself: check `document.activeElement` is inside the editor).

- [ ] **Step 1: Write the failing test** `Composer.test.tsx`: mount `<Composer ticketId="t1" onPosted={() => {}} />` inside a `QueryClientProvider`; get the editor through a test-only `data-testid="composer"` and `(window as any).__panEditor` set in an effect when `import.meta.env.MODE === "test"`; simulate input rules with `editor.view.someProp("handleTextInput", (f) => f(editor.view, 1, 1, "# "))` then `editor.commands.insertContent("Title")`, then a new paragraph with `editor.commands.enter()` and `handleTextInput` of `"- "` plus `insertContent("item")`; assert `composerMarkdown(editor)` equals `"# Title\n\n- item"`. Second test: `editor.commands.setContent("<p>x</p>")` and pressing Ctrl+Enter on the editor element calls `api` (mock `fetch` to return a comment) and clears the editor.

- [ ] **Step 2: Run, confirm FAIL.** If TipTap cannot run in jsdom because of missing `getClientRects` or `elementFromPoint`, add minimal polyfills at the top of the test file (`Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as any` and `Range.prototype.getBoundingClientRect = () => ({ x:0,y:0,width:0,height:0,top:0,left:0,right:0,bottom:0,toJSON(){} }) as any`) and say so in the report.

- [ ] **Step 3: Implement.** CSS: `.thread`, `.comment`, `.comment .who`, `.composer` (bordered `card` with the ProseMirror area at min-height 6rem, `.ProseMirror:focus{outline:none}` and the card gets the focus ring via `:focus-within`), `.upload-row`, `.attachment-row`, `.htmlframe{width:100%;height:320px;border:1px solid var(--line);border-radius:var(--r-input);resize:vertical}`. Type in the editor uses the body scale; headings use the `h2` size for `#` and a step down for `##`.

- [ ] **Step 4: Run** `pnpm vitest run apps/web && pnpm --filter @panorama/web build`. Then check by hand with the dev servers (`PANORAMA_DATA_DIR=$(mktemp -d) PANORAMA_ALLOW_FAST_KDF=1 pnpm dev:server`, `VITE_FAST_KDF=1 pnpm dev:web`): type `# ` and see a heading, drop a PNG and see it inline after posting, paste an HTML snippet in a fenced `html` block and see it in the frame with no script execution.
- [ ] **Step 5: Commit** `feat(web): comment composer with markdown shorthand and thread`

---

### Task 9: Evidence checklist and adding evidence

**Files:**
- Create: `apps/web/src/components/GateList.tsx`, `apps/web/src/components/AddEvidence.tsx`; Modify: `hooks.ts` (`useGates(ticketId)` keyed `["gates", id]`, `useEvidenceTypes()` keyed `["evidence-types"]`, `useAddEvidence()` invalidating `["thread", ticketId]`, `["gates", ticketId]`, `["queue"]`), `TicketPanel.tsx`, `app.css`
- Test: `apps/web/src/components/GateList.test.tsx` (`// @vitest-environment jsdom`)

**Interfaces:**
- `nextLane(lanes: Lane[], current: string): Lane | null` (exported from `GateList.tsx`): the lane with the smallest position greater than the current lane's, or null.
- `<GateList lane missing types />`: heading "To enter <lane name>" (`h2`), then one row per requirement of that lane: a mint check mark and "<name>" when met, a stone circle and "<name>, <have> of <need>" when not; when the lane has no requirements: "No evidence required." Rendered in the panel for the next lane; when the lane is the last, "This is the last lane."
- `<AddEvidence ticketId types onClose />`: dialog (shared `useFocusTrap`) with a `<select>` of evidence types (human sees all; the human-only types are shown to the human only, which is always the case in this UI), then fields per kind: test_run (passed, failed numbers, output textarea), pr_link (url, title), eval_score (score 0 to 1), screenshot and file (a file input that uploads through `uploadFile` and shows the name), human_signoff (note), custom (result select and note). "Attach" submits; disabled while invalid or in flight; errors `role="alert"`. Opened from a "Add evidence" ghost button in the panel next to the checklist.

- [ ] **Step 1: Write the failing test** `GateList.test.tsx`: `nextLane` returns the following lane by position and null at the end; rendering with `missing=[{typeId:"et_eval_score", need:1, have:0}]` for a lane requiring eval score and test run (met) shows "Eval score, 0 of 1" and "Test run" with the check mark (`aria-label="met"`).

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement. Step 4: Run tests and build; hand check: attach a failing eval score, see the chip in coral and the checklist unchanged; attach a passing one, see the checklist tick and the lane select accept the move. Step 5: Commit** `feat(web): evidence checklist and add evidence dialog`

---

### Task 10: Board with gated drag

**Files:**
- Create: `apps/web/src/views/Board.tsx`, `apps/web/src/components/BoardCard.tsx`, `apps/web/src/components/LaneRequirements.tsx`; Modify: `App.tsx` (route `/board`), `Shell.tsx` (nav item Board with Phosphor `Kanban`, shortcut `g b`), `hooks.ts` (`useBoard(projectId)` = tickets grouped by lane from `useTickets`, `useSetLaneRequirements()` invalidating `["lanes"]`, `["gates"]`), `app.css`, `package.json` (`@dnd-kit/core`, `@dnd-kit/utilities`)
- Test: `apps/web/src/views/Board.test.tsx` (`// @vitest-environment jsdom`)

**Interfaces:**
- `groupByLane(tickets: Ticket[], lanes: Lane[]): Record<string, Ticket[]>` sorted by `position` (exported for the test).
- `<Board />`: `h1` "Board", one column per lane in position order, full width with horizontal scroll inside its own `overflow-x: auto` container (the page never scrolls sideways). Column header: lane name, mono count, a small coral mark with the label "Needs human on entry" when `setsNeedsHuman`, and for the human a "Requirements" ghost button opening `<LaneRequirements lane types />`. Cards: `<BoardCard ticket />` showing the state mark, key, title, agent name, and the needs-human chip when flagged; click opens `/t/:id` (a real `Link`). Drag with dnd-kit `DndContext` and `useDraggable` per card, `useDroppable` per column; during a drag, columns whose gate would refuse the card (from `useGates(activeId)`) get `aria-disabled`, 50 percent opacity, and a `title` listing what is missing; dropping on one does nothing. Dropping on an allowed column calls the move; a 422 still shows an inline error in the source column ("Eval score needed first") with `role="alert"`, because gates can change between hover and drop. Keyboard: with a card focused, `m` opens a small "Move to" `<select>` in the card; choosing a lane moves it; refused lanes are listed as disabled options with the missing text. Empty board (no tickets): the lanes still render with "No tickets" in each, plus the LaneScene above the columns once only.
- `<LaneRequirements lane types onClose />`: dialog listing the lane's requirements as rows of type `<select>` and count `<input type=number min=1 max=20>`, "Add requirement" and per-row "Remove" buttons, Save (human signed through `api`) and Cancel.

- [ ] **Step 1: Write the failing test** `Board.test.tsx`: `groupByLane` puts tickets under their lane in position order and gives empty arrays for empty lanes; render `<Board>` with a mocked `useOutletContext` providing two lanes and `fetch` mocked for tickets, gates, agents, evidence types, and assert both column headings render with counts and that the card link points at `/t/<id>`.

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement.** CSS: `.board{display:flex;gap:16px;overflow-x:auto;padding-bottom:1rem}`, `.lane{flex:0 0 280px;background:var(--stone-top);border-radius:var(--r-card);padding:.75rem;min-height:12rem}`, `.lane-head`, `.lane[aria-disabled="true"]{opacity:.5}`, `.bcard` (surface card, hover lift as `.trow`, `cursor:grab`, `.bcard.dragging{box-shadow:var(--shadow);transform:translateY(-2px)}`, origin slot dashed `--line`). Below 860px the board scrolls horizontally with 240px columns.

- [ ] **Step 4: Run tests and build; hand check: drag a ticket into Ready for Production without evidence (column dims, drop refused), attach evidence, drag again (accepted, card gains the Needs human chip and the Queue updates live in another tab), `m` keyboard move, lane requirements dialog. Step 5: Commit** `feat(web): board with gated drag and lane requirements`

---

### Task 11: Demo agent, end to end gate flow, README

**Files:**
- Modify: `scripts/demo-agent.ts`, `e2e/first-run.spec.ts`, `README.md`; Create: `e2e/gate.spec.ts`

**Interfaces:**
- Demo agent now: creates the ticket, moves to In Progress, attempts Ready for Production and prints the 422 body (`Gate refused: Eval score, 0 of 1`), posts a comment `"## Test run\n\nAll 212 tests pass."`, attaches `et_test_run {passed: 212, failed: 0}` and `et_eval_score {score: 0.94}`, moves to Ready for Production, prints the flags.
- `first-run.spec.ts`: unchanged assertions, plus after clearing the flag it expects the thread to show the comment heading "Test run" and two evidence chips.
- `gate.spec.ts`: setup, project, human creates a ticket, opens it, tries the lane select to Done and sees the alert containing "Human sign-off"; adds evidence Human sign-off through the dialog; moves to Done successfully; navigates to Board and sees the ticket under Done; posts a comment with `# ` shorthand and sees an `h1` inside the thread.
- README: update the milestone line to "milestone 2 of 5", document the thread, evidence, gates, attachments, the stream, and add the multipart signing rule (body signed as the empty string). No dashes.

- [ ] **Step 1: Update the demo agent and specs as described. Step 2: Run** `pnpm test && pnpm e2e` (expect 2 passed) and the dash grep. **Step 3: Commit** `feat: evidence gated demo, end to end gate flow, docs`

---

## Milestone 2 acceptance

1. An agent cannot move a ticket into Ready for Production or Done without the required evidence, from REST, from a Board drag, or from the keyboard; the refusal names what is missing.
2. Only the human can attach a sign-off; agents attempting it get 403.
3. A comment thread with markdown shorthand, dropped images, and a sandboxed HTML block works end to end, and the stored body is sanitised.
4. Attachments on an encrypted install are ciphertext on disk and are never served as `text/html`.
5. Two browser tabs see each other's changes within a second without any polling.
6. All previous acceptance items still hold, `pnpm test` and `pnpm e2e` pass, and the dash grep is 0.
