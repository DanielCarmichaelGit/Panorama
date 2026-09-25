import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CanvasDocSchema, canvasToRule, type CanvasDoc, type Rule, type RuleBody } from "@boomerang/core";
import { createRule, deleteRule, getProject, getRule, listRuleRuns, listRules, updateRule, type DB } from "@boomerang/db";
import { getDb, requireCan } from "../auth";
import { changedKeys } from "../changed";
import type { Ctx } from "../context";
import { dryRun } from "../engine/dryRun";
import { HttpError } from "../errors";
import { nextRunAfter, reconcileTriggers } from "../workers/scheduler";
import { loadTicket, makeLog } from "./common";

const CreateRuleInput = z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(80), enabled: z.boolean().optional(), canvas: CanvasDocSchema }).strict();
const UpdateRuleInput = z
  .object({ name: z.string().trim().min(1).max(80).optional(), enabled: z.boolean().optional(), canvas: CanvasDocSchema.optional() })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "empty patch");
const TestRuleInput = z.object({ ticketId: z.string().min(1) }).strict();

/**
 * The canvas is the drawing; the engine runs what it serialises to. A drawing the engine
 * cannot run is refused here with the offending nodes named, whatever the client checked. A
 * schedule is also put to the scheduler's own parser: core's shape check admits a cron
 * string croner rejects (a minute of 99), and a rule that would never fire is not a rule,
 * so that comes back as `invalid:<scheduleNodeId>` like any other bad node.
 */
function compile(canvas: CanvasDoc, now: Date): RuleBody {
  const r = canvasToRule(canvas);
  if ("errors" in r) throw new HttpError(400, "canvas_invalid", "That canvas cannot run as a rule", { errors: r.errors });
  if (r.rule.event.type === "schedule") {
    try {
      nextRunAfter(r.rule.event.cron, r.rule.event.timezone, now);
    } catch {
      const nodeId = canvas.nodes.find((n) => n.kind === "schedule")?.id ?? "schedule";
      throw new HttpError(400, "canvas_invalid", "That schedule cannot run", { errors: [{ name: `invalid:${nodeId}`, code: "invalid", nodeId }] });
    }
  }
  return r.rule;
}

// Writes are human only (rule.edit) and check the action before touching the store, so an
// agent is told 403 whether or not the id it named exists; a human still gets 404. Every
// write reconciles triggers at once, so a schedule rule is live (or gone) as the reply goes
// out rather than on the scheduler's next tick.
export function rulesRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const log = makeLog(ctx);
  const loadRule = (db: DB, id: string): Rule => {
    const rule = getRule(db, id);
    if (!rule) throw new HttpError(404, "not_found", "No such rule");
    return rule;
  };

  app.get("/api/v1/rules", async (req: any) => {
    const db = getDb(ctx); const projectId = String(req.query.projectId ?? "");
    if (!getProject(db, projectId)) throw new HttpError(404, "not_found", "No such project");
    requireCan(req, "read", projectId);
    return listRules(db, projectId);
  });

  app.post("/api/v1/rules", async (req) => {
    requireCan(req, "rule.edit");
    const db = getDb(ctx); const input = CreateRuleInput.parse(req.body);
    if (!getProject(db, input.projectId)) throw new HttpError(404, "not_found", "No such project");
    const body = compile(input.canvas, ctx.now());
    return db.transaction(() => {
      const rule = createRule(db, { projectId: input.projectId, name: input.name, enabled: input.enabled, ...body, canvas: input.canvas }, iso());
      reconcileTriggers(db, ctx.now());
      log(db, req, "rule.created", { id: rule.id, projectId: rule.projectId, name: rule.name, enabled: rule.enabled, event: rule.event });
      return rule;
    })();
  });

  app.patch("/api/v1/rules/:id", async (req: any) => {
    requireCan(req, "rule.edit");
    const db = getDb(ctx); const rule = loadRule(db, req.params.id);
    const input = UpdateRuleInput.parse(req.body);
    const body = input.canvas ? compile(input.canvas, ctx.now()) : {};
    const patch = { name: input.name, enabled: input.enabled, canvas: input.canvas, ...body };
    const changed = changedKeys(rule, patch);
    return db.transaction(() => {
      const out = updateRule(db, rule.id, patch, iso());
      reconcileTriggers(db, ctx.now());
      log(db, req, "rule.updated", { id: rule.id, projectId: rule.projectId, changed });
      return out;
    })();
  });

  app.delete("/api/v1/rules/:id", async (req: any) => {
    requireCan(req, "rule.edit");
    const db = getDb(ctx); const rule = loadRule(db, req.params.id);
    return db.transaction(() => {
      deleteRule(db, rule.id);
      reconcileTriggers(db, ctx.now());
      log(db, req, "rule.deleted", { id: rule.id, projectId: rule.projectId, name: rule.name });
      return { ok: true };
    })();
  });

  /** A dry run: what this rule would do to that ticket, and what the gate would say. Writes nothing. */
  app.post("/api/v1/rules/:id/test", async (req: any) => {
    const db = getDb(ctx); const rule = loadRule(db, req.params.id);
    requireCan(req, "read", rule.projectId);
    const { ticketId } = TestRuleInput.parse(req.body);
    const ticket = loadTicket(db, ticketId);
    if (ticket.projectId !== rule.projectId) throw new HttpError(400, "wrong_project", "That ticket belongs to another project");
    return dryRun(db, rule, ticket, req.actor.kind);
  });

  app.get("/api/v1/rules/:id/runs", async (req: any) => {
    const db = getDb(ctx); const rule = loadRule(db, req.params.id);
    requireCan(req, "read", rule.projectId);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const before = req.query.before ? String(req.query.before) : undefined;
    return listRuleRuns(db, rule.id, { limit, before });
  });
}
