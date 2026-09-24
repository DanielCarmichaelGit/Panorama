import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_ACTIONS, ARGON_FAST, deriveKeys, randomHex, signRequest, type AgentAction } from "@panorama/core";
import { buildApp } from "../app";

export const tempDir = () => mkdtempSync(join(tmpdir(), "pan-srv-"));
export const humanKeys = () => deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST);
const id8 = () => randomHex(4);

export function client(app: any, seed: Uint8Array, actorId: string) {
  return async (method: string, url: string, body?: unknown, raw?: { body: Buffer; contentType: string }) => {
    if (raw) {
      // Binary bodies are not signed byte for byte: signRequest hashes a UTF-8 string, so a
      // multipart upload signs the empty string instead (see the auth.ts multipart rule).
      const headers: Record<string, string> = { ...(await signRequest(seed, actorId, method, url, "")), "content-type": raw.contentType };
      const res = await app.inject({ method, url, payload: raw.body, headers });
      return { status: res.statusCode, json: res.body ? res.json() : null };
    }
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = { ...(await signRequest(seed, actorId, method, url, payload)) };
    if (payload) headers["content-type"] = "application/json";
    const res = await app.inject({ method, url, payload: payload || undefined, headers });
    return { status: res.statusCode, json: res.body ? res.json() : null };
  };
}

/** Builds a multipart/form-data body by hand: text fields first, then one file part. */
export function multipart(fields: Record<string, string>, file: { name: string; mime: string; bytes: Buffer }): { body: Buffer; contentType: string } {
  const boundary = `panorama-${randomHex(16)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
  parts.push(file.bytes);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function setupApp(encryption = true) {
  const dir = tempDir();
  const app = await buildApp({ dataDir: dir, allowFastKdf: true });
  const keys = await humanKeys();
  const human = client(app, keys.seed, "human");
  const res = await human("POST", "/api/v1/setup", { publicKey: keys.publicKeyHex, kdfSalt: "00".repeat(16), argon: ARGON_FAST, encryption, dbKey: encryption ? keys.dbKeyHex : null });
  if (res.status !== 200) throw new Error(`setup failed: ${JSON.stringify(res.json)}`);
  return { app, human, keys, dir };
}

export async function agentIn(s: { app: any; human: any }, projectId: string, actions: AgentAction[] = [...AGENT_ACTIONS]) {
  const ak = await deriveKeys("agent-secret-" + randomHex(4), "11".repeat(16), ARGON_FAST);
  const id = (await s.app.inject({ method: "POST", url: "/api/v1/agents/register", payload: { name: "worker-" + id8(), publicKey: ak.publicKeyHex } })).json().id;
  await s.human("POST", `/api/v1/agents/${id}/approve`, { scopes: { projects: [projectId], actions } });
  return { agent: client(s.app, ak.seed, id), agentId: id };
}
