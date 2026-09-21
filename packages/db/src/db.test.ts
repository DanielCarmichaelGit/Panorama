import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyChain } from "@panorama/core";
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

describe("checkpoints", () => {
  it("keeps checkpoints append-only and ignores a second one at the same seq", () => {
    const { db } = fresh();
    d.addCheckpoint(db, { seq: 1, headHash: "aa".repeat(32), signature: "s1", now: NOW });
    d.addCheckpoint(db, { seq: 1, headHash: "bb".repeat(32), signature: "s2", now: NOW });
    expect(d.latestCheckpoint(db)).toEqual({ seq: 1, headHash: "aa".repeat(32), signature: "s1" });
    expect(() => db.prepare("update checkpoints set head_hash='cc' where seq=1").run()).toThrow(/append-only/);
    expect(() => db.prepare("delete from checkpoints where seq=1").run()).toThrow(/append-only/);
  });
});

describe("projects and tickets", () => {
  it("creates a project with the six default lanes", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    expect(lanes.map((l) => l.name)).toEqual(["Backlog", "Ready", "In Progress", "Eval", "Ready for Production", "Done"]);
    expect(lanes[4].setsNeedsHuman).toBe(true);
    expect(d.listLanes(db, project.id)).toHaveLength(6);
  });
  it("numbers tickets per project, defaults to the first lane, and flags on entry to a needs-human lane", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
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
