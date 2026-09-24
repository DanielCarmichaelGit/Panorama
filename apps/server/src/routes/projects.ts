import type { FastifyInstance } from "fastify";
import { CreateBoardInput, CreateProjectInput } from "@panorama/core";
import { appendEvent, createBoard, createProject, getProject, listBoards, listLanes, listProjects } from "@panorama/db";
import { getDb, inScope, requireCan } from "../auth";
import { record } from "../bus";
import type { Ctx } from "../context";
import { HttpError } from "../errors";

export function projectRoutes(app: FastifyInstance, ctx: Ctx): void {
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
