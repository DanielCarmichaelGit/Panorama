import { describe, expect, it } from "vitest";
import { ARGON_FAST, deriveKeys, verifyChain } from "@panorama/core";
import { listEvents } from "@panorama/db";
import { client, setupApp } from "./test/helpers";

async function world() {
  const s = await setupApp();
  const { project, lanes } = (await s.human("POST", "/api/v1/projects", { name: "Panorama", key: "PAN" })).json;
  const ak = await deriveKeys("agent-secret-xyz", "11".repeat(16), ARGON_FAST);
  const id = (await s.app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker", publicKey: ak.publicKeyHex } })).json().id;
  await s.human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: [project.id], actions: ["read", "ticket.create", "ticket.update", "ticket.move", "flag.set", "evidence.add"] } });
  return { ...s, project, lanes, agent: client(s.app, ak.seed, id), agentId: id };
}

describe("tickets", () => {
  it("runs the milestone story: agent creates and moves, lane flags it, human clears it", async () => {
    const w = await world();
    const t = (await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "Ship the thing" })).json;
    expect(t).toMatchObject({ key: "PAN-1", assigneeId: w.agentId });
    const rfp = w.lanes.find((l: any) => l.name === "Ready for Production");
    expect((await w.agent("POST", "/api/v1/evidence", { ticketId: t.id, typeId: "et_eval_score", payload: { score: 0.95 } })).json.result).toBe("pass");
    const moved = (await w.agent("POST", `/api/v1/tickets/${t.id}/move`, { laneId: rfp.id })).json;
    expect(moved.flags).toEqual(["needs_human"]);
    expect((await w.human("GET", `/api/v1/queue?projectId=${w.project.id}`)).json.needsHuman.map((x: any) => x.id)).toEqual([t.id]);
    expect((await w.agent("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "needs_human", on: false })).status).toBe(403);
    expect((await w.human("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "needs_human", on: false })).json.flags).toEqual([]);
    const types = listEvents(w.app.ctx.db!).map((e) => e.type);
    expect(types).toEqual(["system.setup", "project.created", "agent.registered", "agent.approved", "ticket.created", "evidence.added", "ticket.moved", "ticket.flag_set", "ticket.flag_cleared"]);
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
  it("scopes GET /api/v1/tickets without a projectId, and forbids an out-of-scope projectId", async () => {
    const w = await world();
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    await w.human("POST", "/api/v1/tickets", { projectId: other.project.id, title: "not mine" });
    const mine = (await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "mine" })).json;
    const listed = await w.agent("GET", "/api/v1/tickets");
    expect(listed.status).toBe(200);
    expect(listed.json.map((x: any) => x.id)).toEqual([mine.id]);
    expect((await w.agent("GET", `/api/v1/tickets?projectId=${other.project.id}`)).status).toBe(403);
  });
  it("forbids an out-of-scope agent from reading, patching, moving, flagging, or archiving a ticket that belongs to another project", async () => {
    const w = await world();
    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: other.project.id, title: "not mine" })).json;
    expect((await w.agent("GET", `/api/v1/tickets/${t.id}`)).status).toBe(403);
    expect((await w.agent("PATCH", `/api/v1/tickets/${t.id}`, { title: "x" })).status).toBe(403);
    expect((await w.agent("POST", `/api/v1/tickets/${t.id}/move`, { laneId: other.lanes[1].id })).status).toBe(403);
    expect((await w.agent("POST", `/api/v1/tickets/${t.id}/flags`, { flag: "blocked", on: true })).status).toBe(403);
    expect((await w.agent("POST", `/api/v1/tickets/${t.id}/archive`)).status).toBe(403);
  });
  it("assigns an agent that moves a human-created, unassigned ticket", async () => {
    const w = await world();
    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "unassigned" })).json;
    expect(t.assigneeId).toBe(null);
    const inProgress = w.lanes.find((l: any) => l.name === "In Progress");
    const moved = (await w.agent("POST", `/api/v1/tickets/${t.id}/move`, { laneId: inProgress.id })).json;
    expect(moved.assigneeId).toBe(w.agentId);
  });
  it("puts a new ticket on the project's default board, reports boardId in ticket.created, and rejects a board from another project", async () => {
    const w = await world();
    const boards = (await w.human("GET", `/api/v1/projects/${w.project.id}/boards`)).json;
    expect(boards).toHaveLength(1);
    expect(boards[0].name).toBe("Panorama");
    expect(boards[0].family).toBe("stone");

    const t = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "on default board" })).json;
    expect(t.boardId).toBe(boards[0].id);

    const other = (await w.human("POST", "/api/v1/projects", { name: "Other", key: "OTH" })).json;
    const otherBoards = (await w.human("GET", `/api/v1/projects/${other.project.id}/boards`)).json;
    const wrongBoard = await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "x", boardId: otherBoards[0].id });
    expect(wrongBoard.status).toBe(400);
    expect(wrongBoard.json.error.code).toBe("wrong_project");

    const types = listEvents(w.app.ctx.db!).map((e) => e.type);
    const created = w.app.ctx.db!.prepare("select payload from events where type = 'ticket.created' and json_extract(payload, '$.title') = 'on default board'").get() as { payload: string };
    expect(JSON.parse(created.payload)).toMatchObject({ boardId: boards[0].id, projectId: w.project.id });
    expect(types).toContain("ticket.created");
  });

  it("creates a second board and lets a ticket land there; GET /tickets filters by boardId", async () => {
    const w = await world();
    const boards = (await w.human("GET", `/api/v1/projects/${w.project.id}/boards`)).json;
    const second = (await w.human("POST", "/api/v1/boards", { projectId: w.project.id, name: "Growth", family: "sky" })).json;
    expect(second).toMatchObject({ projectId: w.project.id, name: "Growth", family: "sky", position: 1 });

    const onSecond = (await w.human("POST", "/api/v1/tickets", { projectId: w.project.id, title: "on growth", boardId: second.id })).json;
    expect(onSecond.boardId).toBe(second.id);

    const filtered = (await w.human("GET", `/api/v1/tickets?projectId=${w.project.id}&boardId=${second.id}`)).json;
    expect(filtered.map((t: any) => t.id)).toEqual([onSecond.id]);

    const defaultBoardTickets = (await w.human("GET", `/api/v1/tickets?projectId=${w.project.id}&boardId=${boards[0].id}`)).json;
    expect(defaultBoardTickets.map((t: any) => t.id)).not.toContain(onSecond.id);
  });

  it("keeps board creation human only", async () => {
    const w = await world();
    const asAgent = await w.agent("POST", "/api/v1/boards", { projectId: w.project.id, name: "Nope" });
    expect(asAgent.status).toBe(403);
    const asHuman = await w.human("POST", "/api/v1/boards", { projectId: w.project.id, name: "Yes" });
    expect(asHuman.status).toBe(200);
    expect(asHuman.json.name).toBe("Yes");
  });

  it("restricts who a PATCH can set as the assignee", async () => {
    const w = await world();
    const t = (await w.agent("POST", "/api/v1/tickets", { projectId: w.project.id, title: "assignable" })).json;
    const otherKeys = await deriveKeys("other-secret", "22".repeat(16), ARGON_FAST);
    const otherId = (await w.app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "other", publicKey: otherKeys.publicKeyHex } })).json().id;

    const agentSetsOther = await w.agent("PATCH", `/api/v1/tickets/${t.id}`, { assigneeId: otherId });
    expect(agentSetsOther.status).toBe(403);
    expect(agentSetsOther.json.error.code).toBe("forbidden");

    expect((await w.agent("PATCH", `/api/v1/tickets/${t.id}`, { assigneeId: w.agentId })).json.assigneeId).toBe(w.agentId);
    expect((await w.agent("PATCH", `/api/v1/tickets/${t.id}`, { assigneeId: null })).json.assigneeId).toBe(null);

    expect((await w.human("PATCH", `/api/v1/tickets/${t.id}`, { assigneeId: otherId })).json.assigneeId).toBe(otherId);
    const badActor = await w.human("PATCH", `/api/v1/tickets/${t.id}`, { assigneeId: "no-such-actor" });
    expect(badActor.status).toBe(400);
    expect(badActor.json.error.code).toBe("validation");
  });
});
