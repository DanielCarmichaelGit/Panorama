import { signRequest } from "@panorama/core";
import { session } from "./session";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, seedOverride?: Uint8Array): Promise<T> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const seed = seedOverride ?? session.getSeed();
  const headers: Record<string, string> = seed ? { ...(await signRequest(seed, "human", method, path, payload)) } : {};
  if (payload) headers["content-type"] = "application/json";
  const res = await fetch(path, { method, headers, body: payload || undefined });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error ?? { code: "network", message: `Request failed (${res.status})` };
    if (res.status === 423 || e.code === "bad_signature") session.clear();
    throw new ApiError(res.status, e.code, e.message, e.details);
  }
  return json as T;
}
