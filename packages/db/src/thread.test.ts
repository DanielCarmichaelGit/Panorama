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
