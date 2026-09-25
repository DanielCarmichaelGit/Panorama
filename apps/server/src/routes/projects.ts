import type { FastifyInstance } from "fastify";
import { CreateBoardInput, CreateLaneInput, CreateProjectInput, LaneOrderInput, UpdateLaneInput } from "@boomerang/core";
import { appendEvent, createBoard, createLane, createProject, deleteLane, getLane, getProject, listBoards, listLanes, listProjects, reorderLanes, updateLane, type DB } from "@boomerang/db";
import { getDb, inScope, requireCan } from "../auth";
import { record } from "../bus";
import { changedKeys } from "../changed";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

// Case-insensitive on ASCII letters only, the same rule SQLite's lower() applies to the tag
// index, so "Review" and "review" clash but two names differing in a non-ASCII letter do not.
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

export function projectRoutes(app: FastifyInstance, ctx: Ctx): void {
  const log = (db: DB, req: any, type: string, payload: unknown) => {
    const ev = appendEvent(db, { actorId: req.actor.id, type, payload, signature: req.sig, now: ctx.now().toISOString() });
    record(req, ev);
    return ev;
  };
  const loadProject = (db: DB, id: string) => {
    if (!getProject(db, id)) throw new HttpError(404, "not_found", "No such project");
  };
  const isOnlyDoneLane = (db: DB, lane: { id: string; projectId: string }) =>
    !listLanes(db, lane.projectId).some((l) => l.isDone && l.id !== lane.id);
  const loadLane = (db: DB, id: string) => {
    const lane = getLane(db, id);
    if (!lane) throw new HttpError(404, "not_found", "No such lane");
    return lane;
  };

  app.get("/api/v1/projects", async (req) => {
    requireCan(req, "read");
    return listProjects(getDb(ctx)).filter((p) => inScope(req.actor, p.id));
  });
  app.post("/api/v1/projects", async (req) => {
    requireCan(req, "project.create");
    const db = getDb(ctx); const input = CreateProjectInput.parse(req.body);
    if (listProjects(db).some((p) => p.key === input.key)) throw new HttpError(409, "duplicate_key", "That project key is taken");
    return db.transaction(() => {
      const out = createProject(db, input, ctx.now().toISOString());
      const ev = appendEvent(db, { actorId: req.actor.id, type: "project.created", payload: { id: out.project.id, key: input.key, name: input.name }, signature: req.sig, now: ctx.now().toISOString() });
      record(req, ev);
      return out;
    })();
  });
  app.get("/api/v1/projects/:id/lanes", async (req: any) => {
    const db = getDb(ctx);
    if (!getProject(db, req.params.id)) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "read", req.params.id);
    return listLanes(db, req.params.id);
  });

  // Lane lifecycle (milestone 2c): lanes are added, reordered, and removed, never renamed.

  app.post("/api/v1/projects/:id/lanes", async (req: any) => {
    const db = getDb(ctx); const projectId = String(req.params.id);
    loadProject(db, projectId);
    requireCan(req, "lane.edit", projectId);
    const input = CreateLaneInput.parse(req.body);
    return db.transaction(() => {
      if (listLanes(db, projectId).some((l) => asciiLower(l.name) === asciiLower(input.name))) {
        throw new HttpError(400, "validation", `A lane named ${input.name} already exists in this project`, { name: input.name });
      }
      const lane = createLane(db, { projectId, ...input }, ctx.now().toISOString());
      log(db, req, "lane.created", { id: lane.id, projectId, name: lane.name, family: lane.family, setsNeedsHuman: lane.setsNeedsHuman, isDone: lane.isDone, position: lane.position });
      return lane;
    })();
  });

  app.patch("/api/v1/lanes/:id", async (req: any) => {
    const db = getDb(ctx); const lane = loadLane(db, req.params.id);
    requireCan(req, "lane.edit", lane.projectId);
    const patch = UpdateLaneInput.parse(req.body);
    return db.transaction(() => {
      // A project always keeps one done lane: the gate on Done and the queue both lean on it.
      if (patch.isDone === false && lane.isDone && isOnlyDoneLane(db, lane)) {
        throw new HttpError(400, "validation", "A project needs one done lane", { laneId: lane.id });
      }
      const out = updateLane(db, lane.id, patch);
      log(db, req, "lane.updated", { id: lane.id, projectId: lane.projectId, changed: changedKeys(lane, patch), patch });
      return out;
    })();
  });

  app.put("/api/v1/projects/:id/lanes/order", async (req: any) => {
    const db = getDb(ctx); const projectId = String(req.params.id);
    loadProject(db, projectId);
    requireCan(req, "lane.edit", projectId);
    const { ids } = LaneOrderInput.parse(req.body);
    return db.transaction(() => {
      let lanes;
      try {
        lanes = reorderLanes(db, projectId, ids);
      } catch (e) {
        if ((e as Error).message === "lane_set_mismatch") throw new HttpError(400, "validation", "The order must list every lane of this project exactly once");
        throw e;
      }
      log(db, req, "lane.reordered", { projectId, ids });
      return lanes;
    })();
  });

  app.delete("/api/v1/lanes/:id", async (req: any) => {
    const db = getDb(ctx); const lane = loadLane(db, req.params.id);
    requireCan(req, "lane.edit", lane.projectId);
    return db.transaction(() => {
      if (listLanes(db, lane.projectId).length === 1) throw new HttpError(409, "last_lane", "A project keeps at least one lane");
      if (lane.isDone && isOnlyDoneLane(db, lane)) throw new HttpError(409, "last_done_lane", "Add another done lane first");
      const { deleted, ticketCount } = deleteLane(db, lane.id);
      if (!deleted) throw new HttpError(409, "lane_in_use", `Move its ${ticketCount} ${ticketCount === 1 ? "ticket" : "tickets"} first`, { ticketCount });
      log(db, req, "lane.deleted", { id: lane.id, projectId: lane.projectId, name: lane.name });
      return { ok: true };
    })();
  });

  app.get("/api/v1/projects/:id/boards", async (req: any) => {
    const db = getDb(ctx);
    if (!getProject(db, req.params.id)) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "read", req.params.id);
    return listBoards(db, req.params.id);
  });
  app.post("/api/v1/boards", async (req) => {
    const db = getDb(ctx); const input = CreateBoardInput.parse(req.body);
    if (!getProject(db, input.projectId)) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "board.create", input.projectId);
    return db.transaction(() => {
      const board = createBoard(db, input, ctx.now().toISOString());
      const ev = appendEvent(db, { actorId: req.actor.id, type: "board.created", payload: { id: board.id, projectId: board.projectId, name: board.name }, signature: req.sig, now: ctx.now().toISOString() });
      record(req, ev);
      return board;
    })();
  });
}
