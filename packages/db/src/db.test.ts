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

describe("M6 migration", () => {
  it("upgrades a database at version 5 with an existing ticket, leaving success_criteria empty and epic_id null", () => {
    const dir = mkdtempSync(join(tmpdir(), "pan-"));
    const db = d.openDatabase(join(dir, "p.db"), null);
    d.migrateTo(db, 5); // stop right after M5: no epics, tags, links, fields tables yet

    db.prepare("insert into projects(id, key, name, next_number, created_at) values(?,?,?,?,?)").run("proj1", "PAN", "Panorama", 2, NOW);
    db.prepare("insert into lanes(id, project_id, name, position, family) values(?,?,?,?,?)").run("lane1", "proj1", "Backlog", 0, "stone");
    db.prepare("insert into boards(id, project_id, name, family, position, created_at) values(?,?,?,?,?,?)").run("board1", "proj1", "Panorama", "stone", 0, NOW);
    db.prepare("insert into tickets(id, project_id, board_id, number, title, lane_id, position, created_at, updated_at) values(?,?,?,?,?,?,?,?,?)")
      .run("t1", "proj1", "board1", 1, "Pre-existing ticket", "lane1", 1, NOW, NOW);

    d.migrate(db); // completes the upgrade to M6

    const t = d.getTicket(db, "t1")!;
    expect(t.epicId).toBeNull();
    expect(t.successCriteria).toBe("");
    expect(t.tagIds).toEqual([]);
    expect(t.fields).toEqual({});
    db.close();
  });
});

describe("M7 migration", () => {
  it("upgrades a database at version 6 so existing epics and tags read back with a null colour", () => {
    const dir = mkdtempSync(join(tmpdir(), "pan-"));
    const db = d.openDatabase(join(dir, "p.db"), null);
    d.migrateTo(db, 6); // stop right after M6: epics and tags exist but have no color column yet

    db.prepare("insert into projects(id, key, name, next_number, created_at) values(?,?,?,?,?)").run("proj1", "PAN", "Panorama", 1, NOW);
    db.prepare("insert into epics(id, project_id, name, family, position, created_at) values(?,?,?,?,?,?)").run("epic1", "proj1", "Launch", "coral", 1, NOW);
    db.prepare("insert into tags(id, project_id, name, family, created_at) values(?,?,?,?,?)").run("tag1", "proj1", "backend", "sky", NOW);

    d.migrateTo(db, 7); // applies M7 alone; M8 has its own test below

    expect(db.pragma("user_version", { simple: true })).toBe(7);
    expect(d.getEpic(db, "epic1")).toMatchObject({ name: "Launch", family: "coral", color: null });
    expect(d.getTag(db, "tag1")).toMatchObject({ name: "backend", family: "sky", color: null });
    db.close();
  });
});

describe("M8 migration", () => {
  it("rebuilds field_definitions so kind may be file, keeping rows, values, and the foreign key", () => {
    const dir = mkdtempSync(join(tmpdir(), "pan-"));
    const db = d.openDatabase(join(dir, "p.db"), null);
    d.migrateTo(db, 7); // stop right after M7: the kind check still lists five kinds
    db.prepare("insert into projects(id, key, name, next_number, created_at) values(?,?,?,?,?)").run("proj1", "PAN", "Panorama", 2, NOW);
    db.prepare("insert into lanes(id, project_id, name, position, family) values(?,?,?,?,?)").run("lane1", "proj1", "Backlog", 0, "stone");
    db.prepare("insert into boards(id, project_id, name, family, position, created_at) values(?,?,?,?,?,?)").run("board1", "proj1", "Panorama", "stone", 0, NOW);
    db.prepare("insert into tickets(id, project_id, board_id, number, title, lane_id, position, created_at, updated_at) values(?,?,?,?,?,?,?,?,?)")
      .run("t1", "proj1", "board1", 1, "Pre-existing ticket", "lane1", 1, NOW, NOW);
    db.prepare("insert into field_definitions(id, project_id, name, key, kind, options, required, position, archived, created_at) values(?,?,?,?,?,?,?,?,?,?)")
      .run("fd1", "proj1", "Points", "points", "number", "[]", 1, 0, 0, NOW);
    db.prepare("insert into ticket_field_values(ticket_id, field_id, value) values(?,?,?)").run("t1", "fd1", "3");
    expect(() => db.prepare("insert into field_definitions(id, project_id, name, key, kind, options, required, position, archived, created_at) values(?,?,?,?,?,?,?,?,?,?)")
      .run("fd2", "proj1", "Spec", "spec", "file", "[]", 0, 1, 0, NOW)).toThrow(/CHECK constraint/);

    d.migrate(db); // completes the upgrade to M8

    expect(db.pragma("user_version", { simple: true })).toBe(8);
    expect(d.getField(db, "fd1")).toMatchObject({ key: "points", kind: "number", required: true });
    expect(d.getTicketFields(db, "t1")).toEqual({ points: 3 });
    const file = d.createField(db, { projectId: "proj1", name: "Spec", key: "spec", kind: "file", required: false }, NOW);
    expect(file.kind).toBe("file");
    d.setTicketFields(db, "t1", { spec: { attachmentId: "att1" } });
    expect(d.getTicketFields(db, "t1")).toEqual({ points: 3, spec: { attachmentId: "att1" } });
    expect(() => d.createField(db, { projectId: "proj1", name: "Dup", key: "points", kind: "text", required: false }, NOW)).toThrow("duplicate_key");
    expect(() => db.prepare("insert into ticket_field_values(ticket_id, field_id, value) values(?,?,?)").run("t1", "ghost", "1")).toThrow(/FOREIGN KEY/);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });
});

describe("lane lifecycle", () => {
  it("appends a new lane after the last non-done lane, before the done lanes", () => {
    const { db } = fresh();
    const { project } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    const lane = d.createLane(db, { projectId: project.id, name: "Review", family: "lilac", setsNeedsHuman: true, isDone: false }, NOW);
    expect(lane).toMatchObject({ projectId: project.id, name: "Review", family: "lilac", setsNeedsHuman: true, isDone: false, position: 5, evidenceRequirements: [] });
    const names = d.listLanes(db, project.id).map((l) => l.name);
    expect(names).toEqual(["Backlog", "Ready", "In Progress", "Eval", "Ready for Production", "Review", "Done"]);
    expect(d.listLanes(db, project.id).map((l) => l.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("inserts before the first done lane by position, so a done lane toggled in the middle does not capture new lanes", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    d.updateLane(db, lanes[2].id, { isDone: true }); // In Progress becomes a done lane, mid-board
    const lane = d.createLane(db, { projectId: project.id, name: "Review", family: "lilac", setsNeedsHuman: false, isDone: false }, NOW);
    expect(lane.position).toBe(2);
    expect(d.listLanes(db, project.id).map((l) => l.name)).toEqual(["Backlog", "Ready", "Review", "In Progress", "Eval", "Ready for Production", "Done"]);
  });

  it("appends at the end when the project has no done lane", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    for (const l of lanes) d.updateLane(db, l.id, { isDone: false });
    const lane = d.createLane(db, { projectId: project.id, name: "Archive", family: "stone", setsNeedsHuman: false, isDone: true }, NOW);
    expect(lane.position).toBe(6);
    expect(d.listLanes(db, project.id).at(-1)!.id).toBe(lane.id);
  });

  it("updates a lane's family and flags but never its name", () => {
    const { db } = fresh();
    const { lanes } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    const out = d.updateLane(db, lanes[0].id, { family: "coral", setsNeedsHuman: true, isDone: true });
    expect(out).toMatchObject({ name: "Backlog", family: "coral", setsNeedsHuman: true, isDone: true });
    expect(d.getLane(db, lanes[0].id)).toEqual(out);
  });

  it("reorders lanes to the given id list and rejects a list that is not exactly the project's lanes", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    const ids = lanes.map((l) => l.id);
    const reversed = [...ids].reverse();
    d.reorderLanes(db, project.id, reversed);
    expect(d.listLanes(db, project.id).map((l) => l.id)).toEqual(reversed);
    expect(d.listLanes(db, project.id).map((l) => l.position)).toEqual([0, 1, 2, 3, 4, 5]);

    expect(() => d.reorderLanes(db, project.id, ids.slice(1))).toThrow("lane_set_mismatch");
    expect(() => d.reorderLanes(db, project.id, [...ids, "stranger"])).toThrow("lane_set_mismatch");
    expect(() => d.reorderLanes(db, project.id, [ids[0], ids[0], ...ids.slice(2)])).toThrow("lane_set_mismatch");
    expect(d.listLanes(db, project.id).map((l) => l.id)).toEqual(reversed);
  });

  it("refuses to delete a lane holding tickets, archived ones included, and deletes an empty one", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    const t1 = d.createTicket(db, { projectId: project.id, title: "a" }, NOW);
    d.createTicket(db, { projectId: project.id, title: "b" }, NOW);
    d.archiveTicket(db, t1.id, NOW);

    expect(d.deleteLane(db, lanes[0].id)).toEqual({ deleted: false, ticketCount: 2 });
    expect(d.getLane(db, lanes[0].id)).toBeDefined();

    expect(d.deleteLane(db, lanes[1].id)).toEqual({ deleted: true, ticketCount: 0 });
    expect(d.getLane(db, lanes[1].id)).toBeUndefined();
    expect(d.listLanes(db, project.id)).toHaveLength(5);
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
  it("applies a lane's entry rules to a ticket created straight into it, the same as a move does", () => {
    const { db } = fresh();
    const { project, lanes } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    const plain = d.createTicket(db, { projectId: project.id, title: "in backlog" }, NOW);
    expect(d.enterLane(db, plain.id, plain.laneId, NOW).flagged).toBe(false);

    const straight = d.createTicket(db, { projectId: project.id, title: "straight in", laneId: lanes[4].id }, NOW);
    const entered = d.enterLane(db, straight.id, straight.laneId, NOW);
    expect(entered.flagged).toBe(true);
    expect(entered.ticket.flags).toContain("needs_human");
    // Entering the same lane again is not a second flagging: the flag is already there.
    expect(d.enterLane(db, straight.id, straight.laneId, NOW).flagged).toBe(false);
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
  it("round trips epic, tags, success criteria, and fields through toTicket", () => {
    const { db } = fresh();
    const { project } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    const epic = d.createEpic(db, { projectId: project.id, name: "Onboarding" }, NOW);
    const tag = d.createTag(db, { projectId: project.id, name: "Bug" }, NOW);
    const field = d.createField(db, { projectId: project.id, name: "Severity", key: "severity", kind: "text" }, NOW);

    const created = d.createTicket(
      db,
      { projectId: project.id, title: "Full ticket", epicId: epic.id, tagIds: [tag.id], successCriteria: "- [ ] ship it", fields: { [field.key]: "high" } },
      NOW
    );
    expect(created.epicId).toBe(epic.id);
    expect(created.tagIds).toEqual([tag.id]);
    expect(created.successCriteria).toBe("- [ ] ship it");
    expect(created.fields).toEqual({ severity: "high" });
    expect(d.getTicket(db, created.id)).toEqual(created);

    const updated = d.updateTicket(db, created.id, { epicId: null, tagIds: [], successCriteria: "done", fields: { severity: null } }, NOW);
    expect(updated.epicId).toBeNull();
    expect(updated.tagIds).toEqual([]);
    expect(updated.successCriteria).toBe("done");
    expect(updated.fields).toEqual({});
  });
  it("filters listTickets by epicId and tagId", () => {
    const { db } = fresh();
    const { project } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
    const epic = d.createEpic(db, { projectId: project.id, name: "Onboarding" }, NOW);
    const tag = d.createTag(db, { projectId: project.id, name: "Bug" }, NOW);
    const inEpic = d.createTicket(db, { projectId: project.id, title: "in epic", epicId: epic.id }, NOW);
    const tagged = d.createTicket(db, { projectId: project.id, title: "tagged", tagIds: [tag.id] }, NOW);
    d.createTicket(db, { projectId: project.id, title: "plain" }, NOW);

    expect(d.listTickets(db, { projectId: project.id, epicId: epic.id }).map((t) => t.id)).toEqual([inEpic.id]);
    expect(d.listTickets(db, { projectId: project.id, tagId: tag.id }).map((t) => t.id)).toEqual([tagged.id]);
  });
});
