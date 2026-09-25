import type { FastifyInstance } from "fastify";
import { CreateEpicInput, CreateTagInput, FieldDefinitionInput, LinkInput, UpdateEpicInput, UpdateFieldInput, UpdateTagInput } from "@boomerang/core";
import {
  addLink,
  archiveTag,
  createEpic,
  createField,
  createTag,
  getEpic,
  getField,
  getProject,
  getTag,
  getTicket,
  listEpics,
  listFields,
  listLinks,
  listTags,
  removeLink,
  updateEpic,
  updateField,
  updateTag,
  type DB,
} from "@boomerang/db";
import { getDb, requireCan } from "../auth";
import { changedKeys } from "../changed";
import type { Ctx } from "../context";
import { HttpError } from "../errors";
import { loadTicket, makeLog } from "./common";

// Human-only routes check the action before touching the store, so an agent is told 403
// whether or not the id it named exists; a human still gets 404 on a missing id.
export function modelRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const log = makeLog(ctx);
  const loadProject = (db: DB, projectId: string) => {
    if (!getProject(db, projectId)) throw new HttpError(404, "not_found", "No such project");
  };

  // Epics

  app.get("/api/v1/epics", async (req: any) => {
    const db = getDb(ctx); const projectId = String(req.query.projectId ?? "");
    loadProject(db, projectId);
    requireCan(req, "read", projectId);
    return listEpics(db, projectId);
  });

  app.post("/api/v1/epics", async (req) => {
    const db = getDb(ctx); const input = CreateEpicInput.parse(req.body);
    requireCan(req, "epic.edit", input.projectId);
    loadProject(db, input.projectId);
    return db.transaction(() => {
      const epic = createEpic(db, input, iso());
      log(db, req, "epic.created", { id: epic.id, projectId: epic.projectId, name: epic.name, family: epic.family, color: epic.color });
      return epic;
    })();
  });

  app.patch("/api/v1/epics/:id", async (req: any) => {
    requireCan(req, "epic.edit");
    const db = getDb(ctx); const epic = getEpic(db, req.params.id);
    if (!epic) throw new HttpError(404, "not_found", "No such epic");
    const patch = UpdateEpicInput.parse(req.body);
    return db.transaction(() => {
      const out = updateEpic(db, epic.id, patch, iso());
      log(db, req, "epic.updated", { id: epic.id, projectId: epic.projectId, changed: changedKeys(epic, patch), patch });
      return out;
    })();
  });

  // Tags

  app.get("/api/v1/tags", async (req: any) => {
    const db = getDb(ctx); const projectId = String(req.query.projectId ?? "");
    loadProject(db, projectId);
    requireCan(req, "read", projectId);
    return listTags(db, projectId);
  });

  app.post("/api/v1/tags", async (req) => {
    const db = getDb(ctx); const input = CreateTagInput.parse(req.body);
    requireCan(req, "tag.edit", input.projectId);
    loadProject(db, input.projectId);
    return db.transaction(() => {
      let tag;
      try {
        tag = createTag(db, input, iso());
      } catch (e) {
        if ((e as Error).message === "duplicate_tag") throw new HttpError(409, "duplicate_tag", "That tag name is already used in this project");
        throw e;
      }
      log(db, req, "tag.created", { id: tag.id, projectId: tag.projectId, name: tag.name, family: tag.family, color: tag.color });
      return tag;
    })();
  });

  app.patch("/api/v1/tags/:id", async (req: any) => {
    requireCan(req, "tag.edit");
    const db = getDb(ctx); const tag = getTag(db, req.params.id);
    if (!tag) throw new HttpError(404, "not_found", "No such tag");
    const patch = UpdateTagInput.parse(req.body);
    return db.transaction(() => {
      let out;
      try {
        out = updateTag(db, tag.id, patch);
      } catch (e) {
        if ((e as Error).message === "duplicate_tag") throw new HttpError(409, "duplicate_tag", "That tag name is already used in this project");
        throw e;
      }
      log(db, req, "tag.updated", { id: tag.id, projectId: tag.projectId, changed: changedKeys(tag, patch), patch });
      return out;
    })();
  });

  app.post("/api/v1/tags/:id/archive", async (req: any) => {
    requireCan(req, "tag.edit");
    const db = getDb(ctx); const tag = getTag(db, req.params.id);
    if (!tag) throw new HttpError(404, "not_found", "No such tag");
    return db.transaction(() => {
      const out = archiveTag(db, tag.id);
      log(db, req, "tag.archived", { id: tag.id, projectId: tag.projectId });
      return out;
    })();
  });

  // Ticket links

  app.get("/api/v1/tickets/:id/links", async (req: any) => {
    const db = getDb(ctx); const t = loadTicket(db, req.params.id); requireCan(req, "read", t.projectId);
    const links = listLinks(db, t.id);
    const otherIds = [...new Set(links.map((l) => (l.fromId === t.id ? l.toId : l.fromId)))];
    const tickets = otherIds
      .map((id) => getTicket(db, id))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ id: x.id, key: x.key, title: x.title, laneId: x.laneId }));
    return { links, tickets };
  });

  app.post("/api/v1/tickets/:id/links", async (req: any) => {
    const db = getDb(ctx); const t = loadTicket(db, req.params.id); requireCan(req, "ticket.update", t.projectId);
    const input = LinkInput.parse(req.body);
    if (input.toId !== t.id) {
      const other = loadTicket(db, input.toId);
      if (other.projectId !== t.projectId) throw new HttpError(400, "wrong_project", "That ticket belongs to another project");
    }
    return db.transaction(() => {
      let link;
      try {
        link = addLink(db, { projectId: t.projectId, fromId: t.id, toId: input.toId, kind: input.kind }, iso());
      } catch (e) {
        const code = (e as Error).message;
        if (code === "self_link" || code === "link_cycle" || code === "duplicate_link") {
          throw new HttpError(400, "validation", "That link is not allowed", { code });
        }
        throw e;
      }
      log(db, req, "ticket.linked", { projectId: t.projectId, id: link.id, fromId: link.fromId, toId: link.toId, kind: link.kind });
      return link;
    })();
  });

  app.delete("/api/v1/tickets/:id/links/:linkId", async (req: any) => {
    const db = getDb(ctx); const t = loadTicket(db, req.params.id); requireCan(req, "ticket.update", t.projectId);
    const link = listLinks(db, t.id).find((l) => l.id === req.params.linkId);
    if (!link) throw new HttpError(404, "not_found", "No such link");
    // A blocks link is a gate: an agent may add one but only the owner may take one away,
    // or an agent could unblock its own ticket by deleting the link that holds it.
    if (link.kind === "blocks") requireCan(req, "link.remove");
    return db.transaction(() => {
      removeLink(db, link.id);
      log(db, req, "ticket.unlinked", { projectId: t.projectId, id: link.id, fromId: link.fromId, toId: link.toId, kind: link.kind });
      return { ok: true };
    })();
  });

  // Field definitions

  app.get("/api/v1/fields", async (req: any) => {
    const db = getDb(ctx); const projectId = String(req.query.projectId ?? "");
    loadProject(db, projectId);
    requireCan(req, "read", projectId);
    return listFields(db, projectId, { includeArchived: req.actor.kind === "human" });
  });

  app.post("/api/v1/fields", async (req) => {
    const db = getDb(ctx); const input = FieldDefinitionInput.parse(req.body);
    requireCan(req, "field.edit", input.projectId);
    loadProject(db, input.projectId);
    return db.transaction(() => {
      let field;
      try {
        field = createField(db, input, iso());
      } catch (e) {
        if ((e as Error).message === "duplicate_key") throw new HttpError(409, "duplicate_key", "That field key is already used in this project");
        throw e;
      }
      log(db, req, "field.created", { id: field.id, projectId: field.projectId, name: field.name, key: field.key, kind: field.kind });
      return field;
    })();
  });

  app.patch("/api/v1/fields/:id", async (req: any) => {
    requireCan(req, "field.edit");
    const db = getDb(ctx); const field = getField(db, req.params.id);
    if (!field) throw new HttpError(404, "not_found", "No such field");
    const patch = UpdateFieldInput.parse(req.body);
    if (patch.options !== undefined && field.kind !== "select") {
      throw new HttpError(400, "validation", "Only a select field may have options");
    }
    return db.transaction(() => {
      const out = updateField(db, field.id, patch);
      log(db, req, "field.updated", { id: field.id, projectId: field.projectId, changed: changedKeys(field, patch), patch });
      return out;
    })();
  });

  app.post("/api/v1/fields/:id/archive", async (req: any) => {
    requireCan(req, "field.edit");
    const db = getDb(ctx); const field = getField(db, req.params.id);
    if (!field) throw new HttpError(404, "not_found", "No such field");
    return db.transaction(() => {
      const out = updateField(db, field.id, { archived: true });
      log(db, req, "field.archived", { id: field.id, projectId: field.projectId });
      return out;
    })();
  });
}
