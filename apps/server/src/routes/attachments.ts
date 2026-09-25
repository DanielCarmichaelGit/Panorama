import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import { addAttachment, appendEvent, getAttachment, getTicket, type DB } from "@panorama/db";
import { getDb, requireCan } from "../auth";
import { record } from "../bus";
import type { Ctx } from "../context";
import { HttpError } from "../errors";
import { filePath, readFile, storeFile } from "../files";

// Anything not on this list is refused outright: attachments accept common document,
// text and image formats plus a generic binary fallback, and nothing else.
const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "text/plain", "text/markdown", "text/html",
  "application/json", "application/pdf", "application/zip", "application/octet-stream",
]);

// Of those, only these are ever served back with their own content-type. html and svg can
// carry script, so they are always served as application/octet-stream instead of themselves.
const SERVE_AS_IS = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/pdf", "application/json", "text/plain", "text/markdown",
]);

// The image types a browser may render inline: the ones served with their own content-type.
// svg is an image but is served as octet-stream (it can carry script), so it is not one.
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const MAX_FILENAME = 200;

export function attachmentRoutes(app: FastifyInstance, ctx: Ctx): void {
  const iso = () => ctx.now().toISOString();
  const loadTicket = (db: DB, id: string) => {
    const t = getTicket(db, id);
    if (!t || t.archived) throw new HttpError(404, "not_found", "No such ticket");
    return t;
  };

  app.post("/api/v1/attachments", async (req: any) => {
    const db = getDb(ctx);
    // req.files() rather than the req.file() convenience wrapper, so a second file part can be
    // detected below: req.file() would silently return only the first part.
    const filesIter = req.files();
    const first = await filesIter.next();
    if (first.done || !first.value) throw new HttpError(400, "validation", "No file part in the upload");
    const part = first.value;

    // Fields declared before the file part in the multipart body (as our client always does)
    // are available as soon as the first file part resolves, before its bytes are read: check
    // the ticket and the actor's permission on it before paying for buffering up to 50 MiB, so
    // an actor without attachment.add on the project cannot force repeated large buffering.
    const ticketId = String(part.fields?.ticketId?.value ?? "");
    if (!ticketId) throw new HttpError(400, "validation", "ticketId is required");
    const t = loadTicket(db, ticketId);
    requireCan(req, "attachment.add", t.projectId);

    const mime = String(part.mimetype ?? "").toLowerCase();
    if (!ALLOWED_MIME.has(mime)) throw new HttpError(415, "unsupported_type", `Attachments of type ${mime || "unknown"} are not accepted`);

    let bytes: Buffer;
    try {
      bytes = await part.toBuffer();
    } catch {
      throw new HttpError(413, "too_large", "Attachment exceeds the size limit");
    }
    if (part.file?.truncated) throw new HttpError(413, "too_large", "Attachment exceeds the size limit");

    // Busboy enforces `files: 1` on the underlying stream: once the first file is drained,
    // asking the iterator for a second one surfaces its FilesLimitError (statusCode 413),
    // which the global error handler maps to the same shaped too_large body.
    const second = await filesIter.next();
    if (!second.done) throw new HttpError(413, "too_large", "Only one file may be uploaded");

    const filename = basename(String(part.filename ?? "file")).slice(0, MAX_FILENAME) || "file";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = randomUUID();

    await storeFile(ctx.dataDir, ctx.fileKey, id, bytes);
    try {
      return db.transaction(() => {
        const a = addAttachment(db, { id, ticketId: t.id, actorId: req.actor.id, filename, mime, size: bytes.length, sha256, createdAt: iso() });
        const ev = appendEvent(db, { actorId: req.actor.id, type: "attachment.added", payload: { id: a.id, ticketId: t.id, projectId: t.projectId, filename, mime, size: bytes.length }, signature: req.sig, now: iso() });
        record(req, ev);
        return a;
      })();
    } catch (e) {
      rmSync(filePath(ctx.dataDir, id), { force: true });
      throw e;
    }
  });

  const loadReadable = (db: DB, req: any, id: string) => {
    const att = getAttachment(db, id);
    if (!att) throw new HttpError(404, "not_found", "No such attachment");
    const t = getTicket(db, att.ticketId);
    if (!t) throw new HttpError(404, "not_found", "No such attachment");
    requireCan(req, "read", t.projectId);
    return att;
  };

  /** What a file field needs to render its value: the name, and whether it can preview inline. */
  app.get("/api/v1/attachments/:id/meta", async (req: any) => {
    const att = loadReadable(getDb(ctx), req, req.params.id);
    return { id: att.id, ticketId: att.ticketId, filename: att.filename, mime: att.mime, size: att.size, isImage: IMAGE_MIME.has(att.mime) };
  });

  app.get("/api/v1/attachments/:id", async (req: any, reply) => {
    const db = getDb(ctx);
    const att = loadReadable(db, req, req.params.id);

    const bytes = await readFile(ctx.dataDir, ctx.fileKey, att.id);
    const contentType = SERVE_AS_IS.has(att.mime) ? att.mime : "application/octet-stream";
    const safeName = att.filename.replace(/[^A-Za-z0-9._-]/g, "") || "file";
    reply
      .header("content-type", contentType)
      .header("content-length", bytes.length)
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename="${safeName}"`)
      .send(bytes);
  });
}
