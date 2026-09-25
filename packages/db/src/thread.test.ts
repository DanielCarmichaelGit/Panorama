import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as d from "./index";
const NOW = "2026-09-22T10:00:00.000Z";
function world() {
  const db = d.openDatabase(join(mkdtempSync(join(tmpdir(), "pan-")), "p.db"), null); d.migrate(db);
  d.insertActor(db, { id: "human", kind: "human", name: "Owner", publicKey: "11".repeat(32), scopes: null, status: "active", lastSeen: null, currentTicketId: null, createdAt: NOW });
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
describe("evidence type lifecycle", () => {
  it("creates a type with its params and flags, refusing a duplicate name case-insensitively", () => {
    const { db } = world();
    const et = d.createEvidenceType(db, { name: "Lint", kind: "custom", humanOnly: false, needsAttachment: false }, NOW);
    expect(et).toMatchObject({ name: "Lint", kind: "custom", params: {}, humanOnly: false, needsAttachment: false, createdAt: NOW });
    expect(d.getEvidenceType(db, et.id)).toEqual(et);
    const scored = d.createEvidenceType(db, { name: "Strict score", kind: "eval_score", params: { threshold: 0.95 }, humanOnly: true, needsAttachment: true }, NOW);
    expect(scored).toMatchObject({ params: { threshold: 0.95 }, humanOnly: true, needsAttachment: true });
    expect(() => d.createEvidenceType(db, { name: "lint", kind: "custom", humanOnly: false, needsAttachment: false }, NOW)).toThrow("duplicate_evidence_type");
    expect(() => d.createEvidenceType(db, { name: "eval SCORE", kind: "custom", humanOnly: false, needsAttachment: false }, NOW)).toThrow("duplicate_evidence_type");
  });

  it("refuses to delete a type a lane requires, naming the lane", () => {
    const { db, lanes } = world();
    const et = d.createEvidenceType(db, { name: "Lint", kind: "custom", humanOnly: false, needsAttachment: false }, NOW);
    d.setLaneRequirements(db, lanes[3].id, [{ typeId: et.id, count: 1 }]);
    expect(d.deleteEvidenceType(db, et.id)).toEqual({ deleted: false, lanes: [{ id: lanes[3].id, projectId: lanes[3].projectId, name: "Eval" }], evidenceCount: 0 });
    expect(d.getEvidenceType(db, et.id)).toBeDefined();
  });

  it("refuses to delete a type an evidence row references, counting the rows, and deletes an unused one", () => {
    const { db, t } = world();
    const et = d.createEvidenceType(db, { name: "Lint", kind: "custom", humanOnly: false, needsAttachment: false }, NOW);
    d.addEvidence(db, { ticketId: t.id, typeId: et.id, commentId: null, attachmentId: null, actorId: "human", payload: { result: "pass" }, result: "pass", now: NOW });
    d.addEvidence(db, { ticketId: t.id, typeId: et.id, commentId: null, attachmentId: null, actorId: "human", payload: { result: "pass" }, result: "pass", now: NOW });
    expect(d.deleteEvidenceType(db, et.id)).toEqual({ deleted: false, lanes: [], evidenceCount: 2 });

    const unused = d.createEvidenceType(db, { name: "Unused", kind: "file", humanOnly: false, needsAttachment: true }, NOW);
    expect(d.deleteEvidenceType(db, unused.id)).toEqual({ deleted: true, lanes: [], evidenceCount: 0 });
    expect(d.getEvidenceType(db, unused.id)).toBeUndefined();
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
