import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, verifyChain } from "@panorama/core";
import { listEvents } from "@panorama/db";
import { client, setupApp } from "./test/helpers";

async function world() {
  const s = await setupApp();
  const { project, lanes } = (await s.human("POST", "/api/v1/projects", { name: "Panorama", key: "PAN" })).json;
  const ak = await deriveKeys("agent-secret-xyz", "11".repeat(16), ARGON_FAST);
  const id = (await s.app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker", publicKey: ak.publicKeyHex } })).json().id;
  await s.human("POST", `/api/v1/agents/${id}/approve`, {
    scopes: { projects: [project.id], actions: ["read", "ticket.create", "ticket.update", "ticket.move", "flag.set", "evidence.add", "comment.add", "attachment.add"] },
  });
  return { ...s, project, lanes, agent: client(s.app, ak.seed, id), agentId: id };
}

describe("epics and tags", () => {
  it("lets a human create an epic and two tags, but not an agent", async () => {
    const w = await world();
    const epic = (await w.human("POST", "/api/v1/epics", { projectId: w.project.id, name: "Launch" })).json;
    expect(epic).toMatchObject({ projectId: w.project.id, name: "Launch" });

    const t1 = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "backend" })).json;
    const t2 = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "urgent" })).json;
    expect(t1.name).toBe("backend");
    expect(t2.name).toBe("urgent");

    expect((await w.agent("POST", "/api/v1/epics", { projectId: w.project.id, name: "Nope" })).status).toBe(403);
    expect((await w.agent("POST", "/api/v1/tags", { projectId: w.project.id, name: "nope" })).status).toBe(403);

    const dup = await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "backend" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("duplicate_tag");
  });

  it("creates a tag with a chosen family and reads it back", async () => {
    const w = await world();
    const tag = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "design", family: "lilac" })).json;
    expect(tag.family).toBe("lilac");

    const listed = (await w.human("GET", `/api/v1/tags?projectId=${w.project.id}`)).json;
    expect(listed.find((t: any) => t.id === tag.id).family).toBe("lilac");
  });

  it("updates an epic and archives a tag, human only", async () => {
    const w = await world();
    const epic = (await w.human("POST", "/api/v1/epics", { projectId: w.project.id, name: "Launch" })).json;
    const updated = (await w.human("PATCH", `/api/v1/epics/${epic.id}`, { name: "Launch v2" })).json;
    expect(updated.name).toBe("Launch v2");
    expect((await w.agent("PATCH", `/api/v1/epics/${epic.id}`, { name: "Nope" })).status).toBe(403);

    const tag = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "stale" })).json;
    expect((await w.agent("POST", `/api/v1/tags/${tag.id}/archive`)).status).toBe(403);
    const archived = (await w.human("POST", `/api/v1/tags/${tag.id}/archive`)).json;
    expect(archived.archived).toBe(true);
  });
});

describe("colour on epics and tags", () => {
  it("stores a lower-cased colour on create, carries it in the events, and lets a patch clear it", async () => {
    const w = await world();
    const epic = (await w.human("POST", "/api/v1/epics", { projectId: w.project.id, name: "Launch", color: "#A1B2C3" })).json;
    expect(epic.color).toBe("#a1b2c3");
    const tag = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "backend", family: "sky", color: "#F6C1B4" })).json;
    expect(tag.color).toBe("#f6c1b4");

    const cleared = (await w.human("PATCH", `/api/v1/epics/${epic.id}`, { color: null })).json;
    expect(cleared.color).toBeNull();
    expect((await w.human("POST", "/api/v1/epics", { projectId: w.project.id, name: "Bad", color: "red" })).status).toBe(400);

    const events = listEvents(w.app.ctx.db!);
    expect(events.find((e) => e.type === "epic.created")!.payload).toMatchObject({ id: epic.id, projectId: w.project.id, name: "Launch", family: "stone", color: "#a1b2c3" });
    expect(events.find((e) => e.type === "tag.created")!.payload).toMatchObject({ id: tag.id, projectId: w.project.id, name: "backend", family: "sky", color: "#f6c1b4" });
    expect(events.find((e) => e.type === "epic.updated")!.payload).toMatchObject({ id: epic.id, patch: { color: null } });
  });

  it("lets a human rename and recolour a tag through PATCH, logging tag.updated with changed[], and refuses an agent", async () => {
    const w = await world();
    const tag = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "backend" })).json;
    const other = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "frontend" })).json;

    const updated = (await w.human("PATCH", `/api/v1/tags/${tag.id}`, { name: "server", color: "#B9DDF5" })).json;
    expect(updated).toMatchObject({ id: tag.id, name: "server", color: "#b9ddf5" });
    expect((await w.agent("PATCH", `/api/v1/tags/${tag.id}`, { name: "nope" })).status).toBe(403);
    expect((await w.human("PATCH", `/api/v1/tags/${tag.id}`, {})).status).toBe(400);
    expect((await w.human("PATCH", "/api/v1/tags/missing", { name: "x" })).status).toBe(404);

    const dup = await w.human("PATCH", `/api/v1/tags/${other.id}`, { name: "Server" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("duplicate_tag");

    const ev = listEvents(w.app.ctx.db!).find((e) => e.type === "tag.updated");
    expect(ev!.payload).toMatchObject({ id: tag.id, projectId: w.project.id, changed: ["name", "color"], patch: { name: "server", color: "#b9ddf5" } });
  });
});

describe("lane lifecycle", () => {
  it("adds a lane before the done lanes, logs lane.created, and refuses a duplicate name and an agent", async () => {
    const w = await world();
    const res = await w.human("POST", `/api/v1/projects/${w.project.id}/lanes`, { name: "Review", family: "lilac", setsNeedsHuman: true, isDone: false });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ projectId: w.project.id, name: "Review", family: "lilac", setsNeedsHuman: true, isDone: false, position: 5 });
    const lanes = (await w.human("GET", `/api/v1/projects/${w.project.id}/lanes`)).json;
    expect(lanes.map((l: any) => l.name)).toEqual(["Backlog", "Ready", "In Progress", "Eval", "Ready for Production", "Review", "Done"]);

    const dup = await w.human("POST", `/api/v1/projects/${w.project.id}/lanes`, { name: "review" });
    expect(dup.status).toBe(400);
    expect(dup.json.error.code).toBe("validation");
    expect(dup.json.error.message).toBe("A lane named review already exists in this project");

    expect((await w.human("POST", "/api/v1/projects/missing/lanes", { name: "x" })).status).toBe(404);
    expect((await w.agent("POST", `/api/v1/projects/${w.project.id}/lanes`, { name: "Nope" })).status).toBe(403);

    const ev = listEvents(w.app.ctx.db!).find((e) => e.type === "lane.created");
    expect(ev!.payload).toMatchObject({ id: res.json.id, projectId: w.project.id, name: "Review", family: "lilac", setsNeedsHuman: true, isDone: false, position: 5 });
  });

  it("patches a lane's flags and family with changed[], never its name, and refuses an agent", async () => {
    const w = await world();
    const lane = w.lanes[1];
    const res = await w.human("PATCH", `/api/v1/lanes/${lane.id}`, { family: "coral", isDone: true });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: lane.id, name: "Ready", family: "coral", isDone: true });
    expect((await w.human("PATCH", `/api/v1/lanes/${lane.id}`, { name: "Renamed" })).status).toBe(400);
    expect((await w.human("PATCH", "/api/v1/lanes/missing", { isDone: true })).status).toBe(404);
    expect((await w.agent("PATCH", `/api/v1/lanes/${lane.id}`, { isDone: false })).status).toBe(403);

    const ev = listEvents(w.app.ctx.db!).find((e) => e.type === "lane.updated");
    expect(ev!.payload).toEqual({ id: lane.id, projectId: w.project.id, changed: ["family", "isDone"], patch: { family: "coral", isDone: true } });
  });

  it("reorders lanes from the full id list, refusing a partial list and an agent", async () => {
    const w = await world();
    const ids = w.lanes.map((l: any) => l.id);
    const reversed = [...ids].reverse();
    const res = await w.human("PUT", `/api/v1/projects/${w.project.id}/lanes/order`, { ids: reversed });
    expect(res.status).toBe(200);
    expect(res.json.map((l: any) => l.id)).toEqual(reversed);

    const partial = await w.human("PUT", `/api/v1/projects/${w.project.id}/lanes/order`, { ids: ids.slice(1) });
    expect(partial.status).toBe(400);
    expect(partial.json.error.code).toBe("validation");
    expect((await w.agent("PUT", `/api/v1/projects/${w.project.id}/lanes/order`, { ids })).status).toBe(403);

    const ev = listEvents(w.app.ctx.db!).find((e) => e.type === "lane.reordered");
    expect(ev!.payload).toEqual({ projectId: w.project.id, ids: reversed });
  });

  it("refuses to delete a lane with tickets (archived included) or the last lane, and deletes an empty one", async () => {
    const w = await world();
    const backlog = w.lanes[0];
    const t1 = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "a" })).json;
    await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "b" });
    await w.human("POST", `/api/v1/tickets/${t1.id}/archive`);

    const inUse = await w.human("DELETE", `/api/v1/lanes/${backlog.id}`);
    expect(inUse.status).toBe(409);
    expect(inUse.json.error.code).toBe("lane_in_use");
    expect(inUse.json.error.message).toBe("Move its 2 tickets first");
    expect(inUse.json.error.details).toEqual({ ticketCount: 2 });

    expect((await w.agent("DELETE", `/api/v1/lanes/${w.lanes[1].id}`)).status).toBe(403);
    expect((await w.human("DELETE", "/api/v1/lanes/missing")).status).toBe(404);

    for (const lane of w.lanes.slice(1)) expect((await w.human("DELETE", `/api/v1/lanes/${lane.id}`)).status).toBe(200);
    expect((await w.human("GET", `/api/v1/projects/${w.project.id}/lanes`)).json.map((l: any) => l.id)).toEqual([backlog.id]);

    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    for (const lane of other.lanes.slice(1)) await w.human("DELETE", `/api/v1/lanes/${lane.id}`);
    const last = await w.human("DELETE", `/api/v1/lanes/${other.lanes[0].id}`);
    expect(last.status).toBe(409);
    expect(last.json.error.code).toBe("last_lane");

    const deleted = listEvents(w.app.ctx.db!).filter((e) => e.type === "lane.deleted");
    expect(deleted).toHaveLength(10);
    expect(deleted[0].payload).toEqual({ id: w.lanes[1].id, projectId: w.project.id, name: "Ready" });
  });
});

describe("evidence type lifecycle", () => {
  it("adds a type with a threshold for eval_score only, refuses a duplicate name and an agent, and logs evidence_type.created", async () => {
    const w = await world();
    const res = await w.human("POST", "/api/v1/evidence-types", { name: "Strict score", kind: "eval_score", params: { threshold: 0.95 }, humanOnly: true });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ name: "Strict score", kind: "eval_score", params: { threshold: 0.95 }, humanOnly: true, needsAttachment: false });
    expect((await w.human("GET", "/api/v1/evidence-types")).json.map((t: any) => t.id)).toContain(res.json.id);

    const badThreshold = await w.human("POST", "/api/v1/evidence-types", { name: "Lint", kind: "custom", params: { threshold: 0.5 } });
    expect(badThreshold.status).toBe(400);
    const dup = await w.human("POST", "/api/v1/evidence-types", { name: "eval score", kind: "custom" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("duplicate_evidence_type");
    expect((await w.agent("POST", "/api/v1/evidence-types", { name: "Nope", kind: "custom" })).status).toBe(403);

    const ev = listEvents(w.app.ctx.db!).find((e) => e.type === "evidence_type.created");
    expect(ev!.payload).toEqual({ id: res.json.id, name: "Strict score", kind: "eval_score", params: { threshold: 0.95 }, humanOnly: true, needsAttachment: false });
  });

  it("refuses to delete a type a lane requires, naming the lanes, or one with evidence rows, counting them", async () => {
    const w = await world();
    const byLane = await w.human("DELETE", "/api/v1/evidence-types/et_eval_score");
    expect(byLane.status).toBe(409);
    expect(byLane.json.error.code).toBe("evidence_type_in_use");
    expect(byLane.json.error.message).toBe("Remove it from Ready for Production first");
    expect(byLane.json.error.details).toMatchObject({ lanes: [{ name: "Ready for Production", projectId: w.project.id }], evidenceCount: 0 });

    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "a" })).json;
    await w.human("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_test_run", payload: { passed: 1, failed: 0 } });
    const byEvidence = await w.human("DELETE", "/api/v1/evidence-types/et_test_run");
    expect(byEvidence.status).toBe(409);
    expect(byEvidence.json.error.code).toBe("evidence_type_in_use");
    expect(byEvidence.json.error.message).toBe("It is recorded on 1 evidence row");
    expect(byEvidence.json.error.details).toEqual({ lanes: [], evidenceCount: 1 });
  });

  it("deletes an unused type, human only, logging evidence_type.deleted", async () => {
    const w = await world();
    const created = (await w.human("POST", "/api/v1/evidence-types", { name: "Lint", kind: "custom" })).json;
    expect((await w.agent("DELETE", `/api/v1/evidence-types/${created.id}`)).status).toBe(403);
    expect((await w.human("DELETE", "/api/v1/evidence-types/missing")).status).toBe(404);
    const res = await w.human("DELETE", `/api/v1/evidence-types/${created.id}`);
    expect(res.status).toBe(200);
    expect((await w.human("GET", "/api/v1/evidence-types")).json.map((t: any) => t.id)).not.toContain(created.id);
    const ev = listEvents(w.app.ctx.db!).find((e) => e.type === "evidence_type.deleted");
    expect(ev!.payload).toEqual({ id: created.id, name: "Lint" });
  });
});

describe("ticket create and patch with the extended model", () => {
  it("lets an agent create a ticket with an epic, tags, and field values in scope", async () => {
    const w = await world();
    const epic = (await w.human("POST", "/api/v1/epics", { projectId: w.project.id, name: "Launch" })).json;
    const tag = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "backend" })).json;
    await w.human("POST", "/api/v1/fields", { projectId: w.project.id, name: "Points", key: "points", kind: "number" });

    const t = (await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Ship", epicId: epic.id, tagIds: [tag.id], fields: { points: 3 } })).json;
    expect(t.epicId).toBe(epic.id);
    expect(t.tagIds).toEqual([tag.id]);
    expect(t.fields).toEqual({ points: 3 });
  });

  it("refuses an epic from another project", async () => {
    const w = await world();
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    const foreignEpic = (await w.human("POST", "/api/v1/epics", { projectId: other.project.id, name: "Foreign" })).json;
    const res = await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "x", epicId: foreignEpic.id });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("wrong_project");
  });

  it("refuses an archived tag on create", async () => {
    const w = await world();
    const tag = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "stale" })).json;
    await w.human("POST", `/api/v1/tags/${tag.id}/archive`);
    const res = await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "x", tagIds: [tag.id] });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("validation");
  });

  it("forbids an agent from setting success criteria on create or patch", async () => {
    const w = await world();
    const created = await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "x", successCriteria: "- [ ] done" });
    expect(created.status).toBe(403);

    const t = (await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "y" })).json;
    const patched = await w.agent("PATCH", `/api/v1/tickets/${t.id}`, { successCriteria: "- [ ] done" });
    expect(patched.status).toBe(403);

    const asHuman = await w.human("PATCH", `/api/v1/tickets/${t.id}`, { successCriteria: "- [ ] done" });
    expect(asHuman.status).toBe(200);
  });

  it("enforces required fields for the human dialog but not for an agent", async () => {
    const w = await world();
    await w.human("POST", "/api/v1/fields", { projectId: w.project.id, name: "Points", key: "points", kind: "number", required: true });

    const asHuman = await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "no points" });
    expect(asHuman.status).toBe(400);
    expect(asHuman.json.error.code).toBe("validation");
    expect(asHuman.json.error.details.issues).toEqual([{ key: "points", message: "is required" }]);

    const asAgent = await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "no points either" });
    expect(asAgent.status).toBe(200);
  });

  it("rejects a bad select value on PATCH, requireAll false regardless of actor", async () => {
    const w = await world();
    const field = (await w.human("POST", "/api/v1/fields", {
      projectId: w.project.id, name: "Size", key: "size", kind: "select",
      options: [{ value: "s", label: "Small" }, { value: "l", label: "Large" }],
    })).json;
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "x" })).json;
    const res = await w.human("PATCH", `/api/v1/tickets/${t.id}`, { fields: { size: "xl" } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("validation");
    expect(res.json.error.details.issues).toEqual([{ key: "size", message: "must be one of the field's options" }]);
  });

  it("lists top-level changed keys in ticket.updated, and lets a patch clear the epic", async () => {
    const w = await world();
    const epic = (await w.human("POST", "/api/v1/epics", { projectId: w.project.id, name: "Launch" })).json;
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "x", epicId: epic.id })).json;
    await w.human("PATCH", `/api/v1/tickets/${t.id}`, { title: "y", epicId: null });

    const events = listEvents(w.app.ctx.db!);
    const updated = events.find((e) => e.type === "ticket.updated" && (e.payload as any).id === t.id);
    expect(updated!.payload).toMatchObject({ id: t.id, projectId: w.project.id, changed: ["title", "epicId"] });

    const refetched = (await w.human("GET", `/api/v1/tickets/${t.id}`)).json;
    expect(refetched.epicId).toBe(null);
  });
});

describe("links and the dependency gate", () => {
  it("blocks a done move until the blocker itself is done, and reports the blocker by key", async () => {
    const w = await world();
    const done = w.lanes.find((l: any) => l.name === "Done");
    const a = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "A" })).json;
    const b = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "B" })).json;

    const link = (await w.human("POST", `/api/v1/tickets/${a.id}/links`, { toId: b.id, kind: "blocks" })).json;
    expect(link).toMatchObject({ fromId: a.id, toId: b.id, kind: "blocks" });

    const gates = (await w.human("GET", `/api/v1/tickets/${b.id}/gates`)).json;
    expect(gates[done.id]).toContainEqual({ typeId: "blocked_by", name: `Blocked by ${a.key}`, need: 1, have: 0 });

    await w.human("POST", "/api/v1/evidence", { ticketId: a.id, typeId: "et_human_signoff", payload: {} });
    await w.human("POST", "/api/v1/evidence", { ticketId: b.id, typeId: "et_human_signoff", payload: {} });

    const blockedMove = await w.human("POST", `/api/v1/tickets/${b.id}/move`, { laneId: done.id });
    expect(blockedMove.status).toBe(422);
    expect(blockedMove.json.error.code).toBe("gate");
    expect(blockedMove.json.error.details.missing).toContainEqual({ typeId: "blocked_by", name: `Blocked by ${a.key}`, need: 1, have: 0 });

    const aMoved = await w.human("POST", `/api/v1/tickets/${a.id}/move`, { laneId: done.id });
    expect(aMoved.status).toBe(200);
    const nowAllowed = await w.human("POST", `/api/v1/tickets/${b.id}/move`, { laneId: done.id });
    expect(nowAllowed.status).toBe(200);
  });

  it("refuses a self link, a cycle, and a duplicate link", async () => {
    const w = await world();
    const a = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "A" })).json;
    const b = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "B" })).json;

    const selfLink = await w.human("POST", `/api/v1/tickets/${a.id}/links`, { toId: a.id, kind: "blocks" });
    expect(selfLink.status).toBe(400);
    expect(selfLink.json.error.code).toBe("validation");
    expect(selfLink.json.error.details.code).toBe("self_link");

    await w.human("POST", `/api/v1/tickets/${a.id}/links`, { toId: b.id, kind: "blocks" });

    const dup = await w.human("POST", `/api/v1/tickets/${a.id}/links`, { toId: b.id, kind: "blocks" });
    expect(dup.status).toBe(400);
    expect(dup.json.error.details.code).toBe("duplicate_link");

    const cycle = await w.human("POST", `/api/v1/tickets/${b.id}/links`, { toId: a.id, kind: "blocks" });
    expect(cycle.status).toBe(400);
    expect(cycle.json.error.details.code).toBe("link_cycle");
  });

  it("refuses a link between tickets in different projects", async () => {
    const w = await world();
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    const a = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "A" })).json;
    const b = (await w.human("POST", "/api/v1/tickets", { projectId: other.project.id, title: "B" })).json;
    const res = await w.human("POST", `/api/v1/tickets/${a.id}/links`, { toId: b.id, kind: "blocks" });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("wrong_project");
  });

  it("returns the linked tickets' key, title, and lane alongside the links", async () => {
    const w = await world();
    const a = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "A" })).json;
    const b = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "B" })).json;
    await w.human("POST", `/api/v1/tickets/${a.id}/links`, { toId: b.id, kind: "relates" });

    const res = await w.human("GET", `/api/v1/tickets/${a.id}/links`);
    expect(res.json.links).toHaveLength(1);
    expect(res.json.tickets).toEqual([{ id: b.id, key: b.key, title: b.title, laneId: b.laneId }]);
  });

  it("lets an agent link and unlink within scope, logging ticket.linked and ticket.unlinked", async () => {
    const w = await world();
    const a = (await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "A" })).json;
    const b = (await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "B" })).json;
    const link = (await w.agent("POST", `/api/v1/tickets/${a.id}/links`, { toId: b.id, kind: "relates" })).json;

    const res = await w.agent("DELETE", `/api/v1/tickets/${a.id}/links/${link.id}`);
    expect(res.status).toBe(200);

    const types = listEvents(w.app.ctx.db!).map((e) => e.type);
    expect(types).toContain("ticket.linked");
    expect(types).toContain("ticket.unlinked");
  });
});

describe("fields", () => {
  it("hides archived fields from an agent but shows them to the human", async () => {
    const w = await world();
    const field = (await w.human("POST", "/api/v1/fields", { projectId: w.project.id, name: "Points", key: "points", kind: "number" })).json;
    await w.human("POST", `/api/v1/fields/${field.id}/archive`);

    const asHuman = (await w.human("GET", `/api/v1/fields?projectId=${w.project.id}`)).json;
    const asAgent = (await w.agent("GET", `/api/v1/fields?projectId=${w.project.id}`)).json;
    expect(asHuman.map((f: any) => f.id)).toContain(field.id);
    expect(asAgent.map((f: any) => f.id)).not.toContain(field.id);
  });

  it("refuses a duplicate field key, and options on a PATCH unless the field is a select", async () => {
    const w = await world();
    const field = (await w.human("POST", "/api/v1/fields", { projectId: w.project.id, name: "Points", key: "points", kind: "number" })).json;
    const dup = await w.human("POST", "/api/v1/fields", { projectId: w.project.id, name: "Points 2", key: "points", kind: "number" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("duplicate_key");

    const res = await w.human("PATCH", `/api/v1/fields/${field.id}`, { options: [{ value: "a", label: "A" }] });
    expect(res.status).toBe(400);
  });
});

describe("scope enforcement on every new route", () => {
  it("keeps an out-of-scope agent out of epics, tags, fields, and links", async () => {
    const w = await world();
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    const epic = (await w.human("POST", "/api/v1/epics", { projectId: other.project.id, name: "E" })).json;
    const tag = (await w.human("POST", "/api/v1/tags", { projectId: other.project.id, name: "t" })).json;
    const field = (await w.human("POST", "/api/v1/fields", { projectId: other.project.id, name: "F", key: "f", kind: "text" })).json;
    const a = (await w.human("POST", "/api/v1/tickets", { projectId: other.project.id, title: "A" })).json;
    const b = (await w.human("POST", "/api/v1/tickets", { projectId: other.project.id, title: "B" })).json;
    const link = (await w.human("POST", `/api/v1/tickets/${a.id}/links`, { toId: b.id, kind: "relates" })).json;

    expect((await w.agent("GET", `/api/v1/epics?projectId=${other.project.id}`)).status).toBe(403);
    expect((await w.agent("POST", "/api/v1/epics", { projectId: other.project.id, name: "X" })).status).toBe(403);
    expect((await w.agent("PATCH", `/api/v1/epics/${epic.id}`, { name: "X" })).status).toBe(403);
    expect((await w.agent("GET", `/api/v1/tags?projectId=${other.project.id}`)).status).toBe(403);
    expect((await w.agent("POST", "/api/v1/tags", { projectId: other.project.id, name: "x" })).status).toBe(403);
    expect((await w.agent("POST", `/api/v1/tags/${tag.id}/archive`)).status).toBe(403);
    expect((await w.agent("GET", `/api/v1/fields?projectId=${other.project.id}`)).status).toBe(403);
    expect((await w.agent("POST", "/api/v1/fields", { projectId: other.project.id, name: "x", key: "x", kind: "text" })).status).toBe(403);
    expect((await w.agent("PATCH", `/api/v1/fields/${field.id}`, { name: "X" })).status).toBe(403);
    expect((await w.agent("POST", `/api/v1/fields/${field.id}/archive`)).status).toBe(403);
    expect((await w.agent("GET", `/api/v1/tickets/${a.id}/links`)).status).toBe(403);
    expect((await w.agent("POST", `/api/v1/tickets/${a.id}/links`, { toId: b.id, kind: "relates" })).status).toBe(403);
    expect((await w.agent("DELETE", `/api/v1/tickets/${a.id}/links/${link.id}`)).status).toBe(403);
  });
});

describe("event provenance", () => {
  it("gives every new event a projectId and keeps the chain valid", async () => {
    const w = await world();
    const epic = (await w.human("POST", "/api/v1/epics", { projectId: w.project.id, name: "Launch" })).json;
    await w.human("PATCH", `/api/v1/epics/${epic.id}`, { name: "Launch v2" });
    const tag = (await w.human("POST", "/api/v1/tags", { projectId: w.project.id, name: "backend" })).json;
    await w.human("POST", `/api/v1/tags/${tag.id}/archive`);
    const field = (await w.human("POST", "/api/v1/fields", { projectId: w.project.id, name: "Points", key: "points", kind: "number" })).json;
    await w.human("PATCH", `/api/v1/fields/${field.id}`, { name: "Story points" });
    await w.human("POST", `/api/v1/fields/${field.id}/archive`);
    const a = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "A" })).json;
    const b = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "B" })).json;
    const link = (await w.human("POST", `/api/v1/tickets/${a.id}/links`, { toId: b.id, kind: "relates" })).json;
    await w.human("DELETE", `/api/v1/tickets/${a.id}/links/${link.id}`);
    await w.human("PATCH", `/api/v1/tags/${tag.id}`, { color: "#f6c1b4" });
    const lane = (await w.human("POST", `/api/v1/projects/${w.project.id}/lanes`, { name: "Review" })).json;
    await w.human("PATCH", `/api/v1/lanes/${lane.id}`, { family: "coral" });
    await w.human("PUT", `/api/v1/projects/${w.project.id}/lanes/order`, { ids: [lane.id, ...w.lanes.map((l: any) => l.id)] });
    await w.human("DELETE", `/api/v1/lanes/${lane.id}`);
    const et = (await w.human("POST", "/api/v1/evidence-types", { name: "Lint", kind: "custom" })).json;
    await w.human("DELETE", `/api/v1/evidence-types/${et.id}`);

    const events = listEvents(w.app.ctx.db!);
    const newTypes = [
      "epic.created", "epic.updated", "tag.created", "tag.updated", "tag.archived", "field.created", "field.updated", "field.archived", "ticket.linked", "ticket.unlinked",
      "lane.created", "lane.updated", "lane.reordered", "lane.deleted",
    ];
    for (const ev of events) {
      if (newTypes.includes(ev.type)) expect((ev.payload as any).projectId).toBe(w.project.id);
    }
    expect(newTypes.every((t) => events.some((e) => e.type === t))).toBe(true);
    // Evidence types are global, so their events carry no projectId.
    const globalTypes = ["evidence_type.created", "evidence_type.deleted"];
    for (const t of globalTypes) {
      const ev = events.find((e) => e.type === t);
      expect(ev).toBeDefined();
      expect((ev!.payload as any).projectId).toBeUndefined();
    }
    expect(verifyChain(events).ok).toBe(true);
  });
});
