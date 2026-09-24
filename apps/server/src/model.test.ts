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

    const events = listEvents(w.app.ctx.db!);
    const newTypes = ["epic.created", "epic.updated", "tag.created", "tag.archived", "field.created", "field.updated", "field.archived", "ticket.linked", "ticket.unlinked"];
    for (const ev of events) {
      if (newTypes.includes(ev.type)) expect((ev.payload as any).projectId).toBe(w.project.id);
    }
    expect(newTypes.every((t) => events.some((e) => e.type === t))).toBe(true);
    expect(verifyChain(events).ok).toBe(true);
  });
});
