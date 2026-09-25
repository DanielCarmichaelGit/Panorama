import { ApiError } from "./api";

/** The message to show for a failed write: the server's own sentence for an ApiError, else the fallback. */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error && e.message ? e.message : fallback;
}
