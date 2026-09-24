import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "validation", message: "Invalid request", details: err.issues } });
    if ((err as any).statusCode === 400) return reply.status(400).send({ error: { code: "bad_json", message: "Body is not valid JSON" } });
    // @fastify/multipart throws its own errors (FilesLimitError, FieldsLimitError, ...) with a
    // statusCode instead of going through HttpError. Map those to the same shaped body.
    if ((err as any).statusCode === 413) return reply.status(413).send({ error: { code: "too_large", message: (err as Error).message } });
    if ((err as any).statusCode === 415) return reply.status(415).send({ error: { code: "unsupported_type", message: (err as Error).message } });
    app.log.error(err);
    return reply.status(500).send({ error: { code: "internal", message: "Unexpected error" } });
  });
}

export const notFoundBody = { error: { code: "not_found", message: "No such route" } };
