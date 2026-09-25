import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Attachment, Comment, Epic, Evidence, EvidenceType, FieldDefinition, Lane, Project, Tag, Ticket, TicketLink } from "@boomerang/core";
import type { BoomerangClient } from "./client";
import { BoomerangError, describeError, ToolRefusal, type GateEntry } from "./errors";
import { HOWTO, HOWTO_URI } from "./howto";

// TODO(milestone 3, task 6): boomerang_start_timer, boomerang_stop_timer and boomerang_report_cost
// join this list once the server has POST /tickets/:id/timer/start, .../timer/stop and .../cost.

// The server's limits, mirrored here so an oversized or unwanted upload is refused before it
// is decoded or sent: apps/server/src/app.ts allows one 50 MiB file per upload and
// apps/server/src/routes/attachments.ts accepts exactly these media types.
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENT_BASE64 = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
export const ALLOWED_MIME = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "text/plain", "text/markdown", "text/html",
  "application/json", "application/pdf", "application/zip", "application/octet-stream",
] as const;
/** An evidence payload rides in a 1 MiB JSON body on the server; 64 KB is plenty for one. */
export const MAX_PAYLOAD_CHARS = 64 * 1024;

const FieldValueInput = z.union([z.string(), z.number(), z.boolean(), z.null(), z.object({ attachmentId: z.string().min(1) }).strict()]);
const AttachmentInput = z
  .object({
    filename: z.string().min(1).max(200),
    mime: z.enum(ALLOWED_MIME),
    base64: z.string().min(1).max(MAX_ATTACHMENT_BASE64, `The attachment is larger than ${MAX_ATTACHMENT_BYTES} bytes`),
  })
  .strict();
const PayloadInput = z.record(z.unknown()).refine((p) => JSON.stringify(p).length <= MAX_PAYLOAD_CHARS, `The payload is larger than ${MAX_PAYLOAD_CHARS} characters`);
const ticketRef = z.string().min(1).describe("Ticket id or key such as DEMO-3");
const projectRef = z.string().min(1).describe("Project id, key or name");
const none = z.object({}).strict();

interface ProjectModel {
  project: Project;
  lanes: Lane[];
  arcs: Epic[];
  tags: Tag[];
  fields: FieldDefinition[];
  evidenceTypes: EvidenceType[];
}

const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const sameName = (a: string, b: string) => asciiLower(a.trim()) === asciiLower(b.trim());
const nameList = (items: { name: string }[]) => (items.length ? items.map((i) => i.name).join(", ") : "none");

/** Finds one of a project's things by id first, then by name ignoring case. */
function resolve<T extends { id: string; name: string }>(items: T[], ref: string, what: string, hint = ""): T {
  const found = items.find((i) => i.id === ref) ?? items.find((i) => sameName(i.name, ref));
  if (!found) throw new ToolRefusal(`No ${what} named ${ref}${hint ? ` ${hint}` : ""}. Available: ${nameList(items)}`);
  return found;
}

const text = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });

export function buildServer(client: BoomerangClient): McpServer {
  const server = new McpServer({ name: "boomerang", version: "0.1.0" });
  const cfg = client.config;
  const errorCtx = { name: cfg.name, url: cfg.url, keyFile: cfg.keyFile };

  /** Runs a tool body and turns anything it throws into a tool error the agent can read. */
  const run = async (body: () => Promise<unknown>): Promise<CallToolResult> => {
    try {
      return text(await body());
    } catch (e) {
      return { content: [{ type: "text", text: describeError(e, errorCtx) }], isError: true };
    }
  };

  const loadProject = async (projectId: string): Promise<ProjectModel> => {
    const projects = await client.call<Project[]>("GET", "/api/v1/projects");
    const project = projects.find((p) => p.id === projectId) ?? projects.find((p) => sameName(p.key, projectId) || sameName(p.name, projectId));
    if (!project) throw new ToolRefusal(`No project ${projectId} in this agent's scope. Available: ${projects.map((p) => `${p.name} (${p.id})`).join(", ") || "none"}`);
    const q = `?projectId=${encodeURIComponent(project.id)}`;
    const [lanes, arcs, tags, fields, evidenceTypes] = await Promise.all([
      client.call<Lane[]>("GET", `/api/v1/projects/${project.id}/lanes`),
      client.call<Epic[]>("GET", `/api/v1/epics${q}`),
      client.call<Tag[]>("GET", `/api/v1/tags${q}`),
      client.call<FieldDefinition[]>("GET", `/api/v1/fields${q}`),
      client.call<EvidenceType[]>("GET", "/api/v1/evidence-types"),
    ]);
    return { project, lanes, arcs: arcs.filter((a) => !a.archived), tags: tags.filter((t) => !t.archived), fields, evidenceTypes };
  };

  /** A ticket by id, or by its key such as DEMO-3. */
  const loadTicket = async (ref: string): Promise<Ticket> => {
    try {
      return await client.call<Ticket>("GET", `/api/v1/tickets/${encodeURIComponent(ref)}`);
    } catch (e) {
      if (!(e instanceof BoomerangError) || e.status !== 404 || !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(ref)) throw e;
    }
    const projects = await client.call<Project[]>("GET", "/api/v1/projects");
    for (const p of projects) {
      const tickets = await client.call<Ticket[]>("GET", `/api/v1/tickets?projectId=${encodeURIComponent(p.id)}`);
      const hit = tickets.find((t) => sameName(t.key, ref));
      if (hit) return hit;
    }
    throw new ToolRefusal(`No ticket ${ref}`);
  };

  const summary = (t: Ticket, m: ProjectModel) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    lane: m.lanes.find((l) => l.id === t.laneId)?.name ?? t.laneId,
    arc: m.arcs.find((a) => a.id === t.epicId)?.name ?? null,
    tags: t.tagIds.map((id) => m.tags.find((x) => x.id === id)?.name ?? id),
    flags: t.flags,
    assigneeId: t.assigneeId,
    updatedAt: t.updatedAt,
  });

  const fullView = async (t: Ticket, m: ProjectModel) => {
    const [gates, links, thread] = await Promise.all([
      client.call<Record<string, GateEntry[]>>("GET", `/api/v1/tickets/${t.id}/gates`),
      client.call<{ links: TicketLink[]; tickets: { id: string; key: string; title: string; laneId: string }[] }>("GET", `/api/v1/tickets/${t.id}/links`),
      client.call<{ comments: Comment[]; evidence: Evidence[]; attachments: Attachment[]; actors: { id: string; name: string; kind: string }[] }>("GET", `/api/v1/tickets/${t.id}/thread`),
    ]);
    const typeName = (id: string) => m.evidenceTypes.find((e) => e.id === id)?.name ?? id;
    const actorName = (id: string) => thread.actors.find((a) => a.id === id)?.name ?? id;
    const other = (l: TicketLink) => links.tickets.find((x) => x.id === (l.fromId === t.id ? l.toId : l.fromId));
    return {
      ...summary(t, m),
      project: { id: m.project.id, key: m.project.key, name: m.project.name },
      description: typeof t.metadata.description === "string" ? t.metadata.description : null,
      successCriteria: t.successCriteria,
      fields: m.fields.filter((f) => !f.archived).map((f) => ({ key: f.key, name: f.name, kind: f.kind, required: f.required, value: t.fields[f.key] ?? null })),
      metadata: t.metadata,
      startDate: t.startDate,
      dueDate: t.dueDate,
      createdAt: t.createdAt,
      links: links.links.map((l) => ({
        id: l.id,
        kind: l.kind,
        direction: l.fromId === t.id ? "out" : "in",
        reads: l.kind === "blocks" ? (l.fromId === t.id ? `${t.key} blocks ${other(l)?.key ?? l.toId}` : `${other(l)?.key ?? l.fromId} blocks ${t.key}`) : `${t.key} relates to ${other(l)?.key ?? "?"}`,
        other: other(l) ? { id: other(l)!.id, key: other(l)!.key, title: other(l)!.title, lane: m.lanes.find((x) => x.id === other(l)!.laneId)?.name ?? null } : null,
      })),
      attachments: thread.attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, commentId: a.commentId, by: actorName(a.actorId), createdAt: a.createdAt })),
      evidence: thread.evidence.map((e) => ({ id: e.id, type: typeName(e.typeId), typeId: e.typeId, result: e.result, by: actorName(e.actorId), payload: e.payload, attachmentId: e.attachmentId, createdAt: e.createdAt })),
      comments: thread.comments.slice(-10).map((c) => ({ id: c.id, by: actorName(c.actorId), body: c.body, attachmentIds: c.attachmentIds, createdAt: c.createdAt })),
      commentCount: thread.comments.length,
      gates: m.lanes.map((l) => {
        const missing = gates[l.id] ?? [];
        return {
          lane: l.name,
          laneId: l.id,
          current: l.id === t.laneId,
          isDone: l.isDone,
          setsNeedsHuman: l.setsNeedsHuman,
          canEnter: missing.length === 0,
          missing: missing.map((x) => ({ typeId: x.typeId, name: x.name, need: x.need, have: x.have, description: x.description ?? null })),
        };
      }),
    };
  };

  const ticketAndModel = async (ref: string) => {
    const t = await loadTicket(ref);
    return { t, m: await loadProject(t.projectId) };
  };

  const resolveTags = (m: ProjectModel, tags: string[]) =>
    tags.map((ref) => resolve(m.tags, ref, "tag", "in this project (tags are created by the owner in Settings)").id);

  /** Decodes a base64 file and uploads it to the ticket; shared by the upload and evidence tools. */
  const uploadBase64 = async (ticketId: string, a: z.infer<typeof AttachmentInput>): Promise<Attachment> => {
    const bytes = new Uint8Array(Buffer.from(a.base64, "base64"));
    if (bytes.length === 0) throw new ToolRefusal("The attachment is empty");
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new ToolRefusal(`The attachment is larger than ${MAX_ATTACHMENT_BYTES} bytes`);
    return client.upload<Attachment>(ticketId, { filename: a.filename, mime: a.mime, bytes });
  };

  server.registerTool(
    "boomerang_status",
    {
      title: "Boomerang status",
      description: "Whether the server is set up and unlocked, and whether this agent's key is registered and approved. Call this first.",
      inputSchema: none,
    },
    () =>
      run(async () => {
        const status = await client.open<{ state: string }>("GET", "/api/v1/status");
        const agent: Record<string, unknown> = { name: cfg.name, id: client.agentId, approval: "unknown", keyFile: cfg.keyFile, requestedScopes: cfg.scopes };
        let message: string;
        if (status.state === "uninitialized") {
          message = "Boomerang has not been set up yet. The owner sets a password on first visit.";
        } else if (status.state === "locked") {
          message = "Boomerang is locked. Ask the owner to unlock it.";
        } else {
          try {
            const me = await client.call<{ id: string; status: string; lastSeen: string | null; currentTicketId: string | null }>("GET", "/api/v1/me");
            agent.id = me.id;
            agent.approval = me.status;
            agent.currentTicketId = me.currentTicketId;
            message = `Agent ${cfg.name} is approved. Read boomerang://howto, then call boomerang_next_ticket.`;
          } catch (e) {
            if (!(e instanceof BoomerangError) || !["pending", "revoked", "unknown_actor"].includes(e.code)) throw e;
            agent.id = client.agentId;
            agent.approval = e.code === "unknown_actor" ? "unknown" : e.code;
            message = describeError(e, errorCtx);
          }
        }
        return { url: cfg.url, server: status, agent, message };
      })
  );

  server.registerTool(
    "boomerang_projects",
    { title: "List projects", description: "The projects this agent may work in.", inputSchema: none },
    () => run(() => client.call<Project[]>("GET", "/api/v1/projects"))
  );

  server.registerTool(
    "boomerang_lanes",
    {
      title: "List lanes",
      description: "A project's lanes in order, with what each requires on entry and whether entering flags the ticket for a human.",
      inputSchema: z.object({ projectId: projectRef }).strict(),
    },
    ({ projectId }) =>
      run(async () => {
        const m = await loadProject(projectId);
        return m.lanes.map((l) => ({
          id: l.id,
          name: l.name,
          position: l.position,
          isDone: l.isDone,
          setsNeedsHuman: l.setsNeedsHuman,
          requires: l.evidenceRequirements.map((r) => ({ typeId: r.typeId, type: m.evidenceTypes.find((e) => e.id === r.typeId)?.name ?? r.typeId, count: r.count, description: r.description ?? null })),
        }));
      })
  );

  server.registerTool(
    "boomerang_evidence_types",
    { title: "List evidence types", description: "Every evidence type, with the payload shape each takes and whether it needs an attachment or a human.", inputSchema: none },
    () =>
      run(async () => {
        const types = await client.call<EvidenceType[]>("GET", "/api/v1/evidence-types");
        const payloadShape: Record<string, string> = {
          test_run: "{ passed: number, failed: number, output?: string }",
          pr_link: "{ url: string, title?: string }",
          eval_score: "{ score: number between 0 and 1, note?: string }",
          screenshot: "{ note?: string } plus an attachment",
          human_signoff: "{ note?: string }, human only",
          file: "{ note?: string } plus an attachment",
          custom: "{ result: 'pass' | 'fail' | 'info', note?: string }",
        };
        return types.map((t) => ({ id: t.id, name: t.name, kind: t.kind, params: t.params, humanOnly: t.humanOnly, needsAttachment: t.needsAttachment, payload: payloadShape[t.kind] ?? "{}" }));
      })
  );

  server.registerTool(
    "boomerang_next_ticket",
    {
      title: "Next ticket",
      description: "The oldest unassigned ticket waiting in the project's Ready lane (or its first lane when there is no Ready), skipping tickets flagged needs_human. With claim true it tries to assign the ticket to this agent; check assigneeId in the answer.",
      inputSchema: z.object({ projectId: projectRef, claim: z.boolean().optional().describe("Assign the ticket to this agent (default false)") }).strict(),
    },
    ({ projectId, claim }) =>
      run(async () => {
        const m = await loadProject(projectId);
        const lane = m.lanes.find((l) => sameName(l.name, "Ready")) ?? m.lanes.find((l) => !l.isDone) ?? m.lanes[0];
        const tickets = await client.call<Ticket[]>("GET", `/api/v1/tickets?projectId=${encodeURIComponent(m.project.id)}&laneId=${encodeURIComponent(lane.id)}`);
        const waiting = tickets.filter((t) => !t.archived && !t.assigneeId && !t.flags.includes("needs_human")).sort((a, b) => a.number - b.number);
        if (waiting.length === 0) return { ticket: null, message: `Nothing is waiting in ${lane.name} for ${m.project.name}` };
        let t = waiting[0];
        if (claim) t = await client.call<Ticket>("PATCH", `/api/v1/tickets/${t.id}`, { assigneeId: client.agentId });
        return { ticket: await fullView(t, m), claimed: !!claim && t.assigneeId === client.agentId, waiting: waiting.length };
      })
  );

  server.registerTool(
    "boomerang_ticket",
    {
      title: "Get ticket",
      description: "A ticket in full: lane, arc, tags, fields, success criteria, links, attachments, evidence, recent comments, and a gate summary for every lane saying what is still missing and what it should show.",
      inputSchema: z.object({ ticketId: ticketRef }).strict(),
    },
    ({ ticketId }) =>
      run(async () => {
        const { t, m } = await ticketAndModel(ticketId);
        return fullView(t, m);
      })
  );

  server.registerTool(
    "boomerang_search_tickets",
    {
      title: "Search tickets",
      description: "Tickets in a project filtered by text (title, key or success criteria), lane, arc, tag or flag. Each filter is optional.",
      inputSchema: z
        .object({
          projectId: projectRef,
          text: z.string().optional(),
          lane: z.string().optional().describe("Lane id or name"),
          arc: z.string().optional().describe("Arc id or name"),
          tag: z.string().optional().describe("Tag id or name"),
          flag: z.string().optional().describe("A flag such as needs_human"),
        })
        .strict(),
    },
    ({ projectId, text: q, lane, arc, tag, flag }) =>
      run(async () => {
        const m = await loadProject(projectId);
        const params = new URLSearchParams({ projectId: m.project.id });
        if (lane) params.set("laneId", resolve(m.lanes, lane, "lane", "in this project").id);
        if (flag) params.set("flag", flag);
        const arcId = arc ? resolve(m.arcs, arc, "arc", "in this project").id : null;
        const tagId = tag ? resolve(m.tags, tag, "tag", "in this project").id : null;
        const needle = q ? asciiLower(q) : null;
        const tickets = (await client.call<Ticket[]>("GET", `/api/v1/tickets?${params}`))
          .filter((t) => !t.archived)
          .filter((t) => !arcId || t.epicId === arcId)
          .filter((t) => !tagId || t.tagIds.includes(tagId))
          .filter((t) => !needle || asciiLower(`${t.key} ${t.title} ${t.successCriteria}`).includes(needle));
        return tickets.map((t) => summary(t, m));
      })
  );

  server.registerTool(
    "boomerang_create_ticket",
    {
      title: "Create ticket",
      description: "Creates a ticket assigned to this agent. Lane, arc and tags are named as the owner named them; a description is kept in the ticket's metadata. Success criteria are the owner's to write.",
      inputSchema: z
        .object({
          projectId: projectRef,
          title: z.string().min(1).max(200),
          description: z.string().max(20000).optional(),
          lane: z.string().optional().describe("Lane id or name (default the first lane)"),
          arc: z.string().optional().describe("Arc id or name"),
          tags: z.array(z.string()).max(20).optional().describe("Tag ids or names"),
          fields: z.record(FieldValueInput).optional().describe("Field values by field key"),
        })
        .strict(),
    },
    ({ projectId, title, description, lane, arc, tags, fields }) =>
      run(async () => {
        const m = await loadProject(projectId);
        const body: Record<string, unknown> = { projectId: m.project.id, title };
        if (lane) body.laneId = resolve(m.lanes, lane, "lane", "in this project").id;
        if (arc) body.epicId = resolve(m.arcs, arc, "arc", "in this project").id;
        if (tags) body.tagIds = resolveTags(m, tags);
        if (fields) body.fields = fields;
        if (description !== undefined) body.metadata = { description };
        const t = await client.call<Ticket>("POST", "/api/v1/tickets", body);
        return fullView(t, m);
      })
  );

  server.registerTool(
    "boomerang_update_ticket",
    {
      title: "Update ticket",
      description: "Changes a ticket's title, description, fields, tags or arc. Fields merge into the existing values; tags replace the list. Success criteria are the owner's to write.",
      inputSchema: z
        .object({
          ticketId: ticketRef,
          title: z.string().min(1).max(200).optional(),
          description: z.string().max(20000).nullable().optional(),
          fields: z.record(FieldValueInput).optional(),
          tags: z.array(z.string()).max(20).optional().describe("Tag ids or names; replaces the ticket's tags"),
          arc: z.string().nullable().optional().describe("Arc id or name, or null to clear"),
        })
        .strict(),
    },
    ({ ticketId, title, description, fields, tags, arc }) =>
      run(async () => {
        const { t, m } = await ticketAndModel(ticketId);
        const patch: Record<string, unknown> = {};
        if (title !== undefined) patch.title = title;
        if (fields !== undefined) patch.fields = fields;
        if (tags !== undefined) patch.tagIds = resolveTags(m, tags);
        if (arc !== undefined) patch.epicId = arc === null ? null : resolve(m.arcs, arc, "arc", "in this project").id;
        if (description !== undefined) {
          // The server replaces metadata whole, so the record is re-read right before the
          // PATCH and only description changes in it. A write by someone else between that
          // read and this PATCH would still be lost; the window is one round trip.
          const { description: _old, ...rest } = (await client.call<Ticket>("GET", `/api/v1/tickets/${t.id}`)).metadata;
          patch.metadata = description === null ? rest : { ...rest, description };
        }
        if (Object.keys(patch).length === 0) throw new ToolRefusal("Nothing to change: give at least one of title, description, fields, tags or arc");
        const out = await client.call<Ticket>("PATCH", `/api/v1/tickets/${t.id}`, patch);
        return fullView(out, m);
      })
  );

  server.registerTool(
    "boomerang_set_flag",
    {
      title: "Set flag",
      description: "Raises or lowers a flag on a ticket, such as needs_human when the owner must look. Only the owner can clear needs_human once it is set.",
      inputSchema: z
        .object({
          ticketId: ticketRef,
          flag: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "A flag is lower case letters, digits and underscores"),
          on: z.boolean(),
        })
        .strict(),
    },
    ({ ticketId, flag, on }) =>
      run(async () => {
        const { t, m } = await ticketAndModel(ticketId);
        const out = await client.call<Ticket>("POST", `/api/v1/tickets/${t.id}/flags`, { flag, on });
        return { ...(await fullView(out, m)), message: `${out.key} ${on ? "is now flagged" : "is no longer flagged"} ${flag}` };
      })
  );

  server.registerTool(
    "boomerang_comment",
    {
      title: "Add comment",
      description: "Posts a markdown comment on a ticket. Attachments named in attachmentIds must have been uploaded to this ticket by this agent and not yet used by a comment.",
      inputSchema: z.object({ ticketId: ticketRef, body: z.string().min(1).max(20000).describe("Markdown"), attachmentIds: z.array(z.string().min(1)).max(20).optional() }).strict(),
    },
    ({ ticketId, body, attachmentIds }) =>
      run(async () => {
        const t = await loadTicket(ticketId);
        return client.call<Comment>("POST", "/api/v1/comments", { ticketId: t.id, body, ...(attachmentIds ? { attachmentIds } : {}) });
      })
  );

  server.registerTool(
    "boomerang_upload_attachment",
    {
      title: "Upload attachment",
      description: `Uploads one file (base64, up to ${MAX_ATTACHMENT_BYTES} bytes, one of ${ALLOWED_MIME.join(", ")}) to a ticket and returns its id for boomerang_comment or a file field.`,
      inputSchema: z.object({ ticketId: ticketRef, filename: z.string().min(1).max(200), mime: z.enum(ALLOWED_MIME), base64: AttachmentInput.shape.base64 }).strict(),
    },
    ({ ticketId, filename, mime, base64 }) =>
      run(async () => {
        const t = await loadTicket(ticketId);
        const a = await uploadBase64(t.id, { filename, mime, base64 });
        return { id: a.id, ticketId: a.ticketId, filename: a.filename, mime: a.mime, size: a.size, sha256: a.sha256 };
      })
  );

  server.registerTool(
    "boomerang_add_evidence",
    {
      title: "Add evidence",
      description: "Records evidence on a ticket. The type is an evidence type id or name (boomerang_evidence_types lists them with their payload shapes). An attachment, when given, is uploaded first and linked to the evidence.",
      inputSchema: z
        .object({
          ticketId: ticketRef,
          type: z.string().min(1).describe("Evidence type id or name, such as et_test_run or Test run"),
          payload: PayloadInput.describe("The payload for that type's kind"),
          commentId: z.string().min(1).optional().describe("A comment on this ticket the evidence belongs to"),
          attachment: AttachmentInput.optional().describe("A file to upload and attach"),
        })
        .strict(),
    },
    ({ ticketId, type, payload, commentId, attachment }) =>
      run(async () => {
        const { t, m } = await ticketAndModel(ticketId);
        const et = resolve(m.evidenceTypes, type, "evidence type");
        if (et.humanOnly) throw new ToolRefusal(`${et.name} is human only: leave a comment asking the owner for it`);
        const attachmentId = attachment ? (await uploadBase64(t.id, attachment)).id : undefined;
        const e = await client.call<Evidence>("POST", "/api/v1/evidence", { ticketId: t.id, typeId: et.id, payload, ...(commentId ? { commentId } : {}), ...(attachmentId ? { attachmentId } : {}) });
        return { ...e, type: et.name };
      })
  );

  server.registerTool(
    "boomerang_move",
    {
      title: "Move ticket",
      description: "Moves a ticket into a lane by id or name. A gated lane refuses the move until its evidence is on the ticket; the error lists each missing requirement, what it should show, and any ticket that blocks this one.",
      inputSchema: z.object({ ticketId: ticketRef, lane: z.string().min(1).describe("Lane id or name") }).strict(),
    },
    ({ ticketId, lane }) =>
      run(async () => {
        const { t, m } = await ticketAndModel(ticketId);
        const target = resolve(m.lanes, lane, "lane", "in this project");
        const out = await client.call<Ticket>("POST", `/api/v1/tickets/${t.id}/move`, { laneId: target.id });
        const view = await fullView(out, m);
        return { ...view, message: `${out.key} is now in ${target.name}${out.flags.includes("needs_human") ? " and is flagged needs_human: the owner must look before it moves on" : ""}` };
      })
  );

  server.registerTool(
    "boomerang_link",
    {
      title: "Link tickets",
      description: "Links this ticket to another in the same project: blocks (this ticket must be done before the other may enter a done lane) or relates. Only the owner can remove a blocks link.",
      inputSchema: z
        .object({
          ticketId: z.string().min(1).describe("The ticket the link starts from, by id or key"),
          toId: z.string().min(1).describe("The other ticket, by id or key"),
          kind: z.enum(["blocks", "relates"]),
        })
        .strict(),
    },
    ({ ticketId, toId, kind }) =>
      run(async () => {
        const [from, to] = await Promise.all([loadTicket(ticketId), loadTicket(toId)]);
        const link = await client.call<TicketLink>("POST", `/api/v1/tickets/${from.id}/links`, { toId: to.id, kind });
        return { ...link, reads: kind === "blocks" ? `${from.key} blocks ${to.key}` : `${from.key} relates to ${to.key}` };
      })
  );

  server.registerTool(
    "boomerang_heartbeat",
    { title: "Heartbeat", description: "Tells Boomerang this agent is still here; the owner sees it as last seen on the Agents page. Call it every few minutes while working.", inputSchema: none },
    () =>
      run(async () => {
        const me = await client.call<{ id: string; lastSeen: string | null; currentTicketId: string | null }>("GET", "/api/v1/me");
        return { ok: true, id: me.id, lastSeen: me.lastSeen, currentTicketId: me.currentTicketId };
      })
  );

  server.registerResource("howto", HOWTO_URI, { title: "How to work in Boomerang", description: "The loop an agent follows and the gate rules", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: HOWTO }],
  }));

  return server;
}
