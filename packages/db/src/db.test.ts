import { chmodSync, existsSync, mkdtempSync } from "node:fs";
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
  it("refuses a malformed key without creating a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pan-"));
    const file = join(dir, "p.db");
    expect(() => d.openDatabase(file, "nothex")).toThrow("bad_key");
    expect(existsSync(file)).toBe(false);
  });
  it("rethrows a failure that is not a bad key", () => {
    const { dir, db } = fresh(); db.close();
    const file = join(dir, "p.db");
    chmodSync(file, 0o444);
    chmodSync(dir, 0o555);
    try {
      expect(() => d.openDatabase(file, null)).toThrow(/readonly/i);
    } finally {
      chmodSync(dir, 0o755);
      chmodSync(file, 0o644);
    }
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

describe("M5 migration backfill", () => {
  it("gives every pre-existing project a default board and points its tickets at it", () => {
    const dir = mkdtempSync(join(tmpdir(), "pan-"));
    const db = d.openDatabase(join(dir, "p.db"), null);
    d.migrateTo(db, 4); // stop right after M4: no boards table, no tickets.board_id column yet

    db.prepare("insert into projects(id, key, name, next_number, created_at) values(?,?,?,?,?)").run("proj1", "PAN", "Panorama", 2, NOW);
    db.prepare("insert into lanes(id, project_id, name, position, family) values(?,?,?,?,?)").run("lane1", "proj1", "Backlog", 0, "stone");
    db.prepare("insert into tickets(id, project_id, number, title, lane_id, position, created_at, updated_at) values(?,?,?,?,?,?,?,?)")
      .run("t1", "proj1", 1, "Pre-existing ticket", "lane1", 1, NOW, NOW);

    const before = Date.now();
    d.migrate(db); // completes the upgrade to M5, running the backfill
    const after = Date.now();

    const boards = d.listBoards(db, "proj1");
    expect(boards).toEqual([{ id: boards[0].id, projectId: "proj1", name: "Panorama", description: null, family: "stone", position: 0, createdAt: boards[0].createdAt }]);
    // The backfill stamps the real time the migration runs, not a fixed literal: assert it
    // parses as an ISO timestamp landing within this test's own run window.
    const createdMs = new Date(boards[0].createdAt).getTime();
    expect(Number.isNaN(createdMs)).toBe(false);
    expect(createdMs).toBeGreaterThanOrEqual(before);
    expect(createdMs).toBeLessThanOrEqual(after);
    expect(d.getTicket(db, "t1")!.boardId).toBe(boards[0].id);
    db.close();
  });
});

describe("projects and tickets", () => {
  it("creates a project with the six default lanes", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    expect(lanes.map((l) => l.name)).toEqual(["Backlog", "Ready", "In Progress", "Eval", "Ready for Production", "Done"]);
    expect(lanes[4].setsNeedsHuman).toBe(true);
    expect(lanes[4].evidenceRequirements).toEqual([{ typeId: "et_eval_score", count: 1 }]);
    expect(d.listLanes(db, project.id)).toHaveLength(6);
  });
  it("creates a default board named after the project, family stone, and lands new tickets on it", () => {
    const { db } = fresh();
    const { project, boards } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    expect(boards).toEqual([{ id: boards[0].id, projectId: project.id, name: "Panorama", description: null, family: "stone", position: 0, createdAt: NOW }]);
    expect(d.listBoards(db, project.id)).toEqual(boards);
    const t = d.createTicket(db, { projectId: project.id, title: "One" }, NOW);
    expect(t.boardId).toBe(boards[0].id);
  });
  it("creates a second board and can put a ticket on it explicitly; listTickets filters by board", () => {
    const { db } = fresh();
    const { project, boards } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    const second = d.createBoard(db, { projectId: project.id, name: "Growth", family: "sky" }, NOW);
    expect(second.position).toBe(1);
    expect(d.getBoard(db, second.id)).toEqual(second);
    const onDefault = d.createTicket(db, { projectId: project.id, title: "default board" }, NOW);
    const onSecond = d.createTicket(db, { projectId: project.id, title: "second board", boardId: second.id }, NOW);
    expect(onDefault.boardId).toBe(boards[0].id);
    expect(onSecond.boardId).toBe(second.id);
    expect(d.listTickets(db, { boardId: second.id }).map((t) => t.id)).toEqual([onSecond.id]);
    expect(d.listTickets(db, { projectId: project.id }).map((t) => t.id).sort()).toEqual([onDefault.id, onSecond.id].sort());
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
    d.insertActor(db, { id: "ag1", kind: "agent", name: "a", publicKey: "22".repeat(32), scopes: null, status: "active", lastSeen: null, currentTicketId: null, createdAt: NOW });
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
