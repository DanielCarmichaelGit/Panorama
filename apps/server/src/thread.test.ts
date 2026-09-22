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
  it("appends comments verbatim (sanitisation happens at the render boundary), refuses foreign attachments, and reports the thread", async () => {
    const w = await world();
    const raw = "# Done\n\n<script>alert(1)</script><b>bold</b> &lt;script&gt;alert(2)&lt;/script&gt;";
    const c = (await w.agent("POST", "/api/v1/comments", { ticketId: w.t.id, body: raw })).json;
    expect(c.body).toBe(raw);
    expect((await w.agent("POST", "/api/v1/comments", { ticketId: w.t.id, body: "x", attachmentIds: ["missing"] })).json.error.code).toBe("validation");
    const th = (await w.human("GET", `/api/v1/tickets/${w.t.id}/thread`)).json;
    expect(th.comments.map((x: any) => x.body)).toEqual([raw]);
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
