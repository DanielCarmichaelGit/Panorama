import { publicKeyFromSeed, signRequest } from "@boomerang/core";
import type { AgentKey, McpConfig } from "./config";
import { readKey, saveKey } from "./config";
import { BoomerangError } from "./errors";

type Json = Record<string, unknown> | unknown[] | null;

/**
 * A thin signed client of the REST API. Every call is signed the way scripts/demo-agent.ts
 * signs: the agent's seed over method, path (query included), the body's hash, a timestamp
 * and a nonce. Multipart uploads sign the empty string, as the server's auth rule says.
 */
export class BoomerangClient {
  readonly key: AgentKey;
  private registering: Promise<string> | null = null;

  constructor(readonly config: McpConfig, key: AgentKey, private readonly fetchImpl: typeof fetch = fetch) {
    this.key = key;
  }

  get agentId(): string | null {
    return this.key.id;
  }

  private async send(method: string, path: string, init: { body?: BodyInit; headers: Record<string, string> }): Promise<{ status: number; json: Json }> {
    const res = await this.fetchImpl(this.config.url + path, { method, headers: init.headers, body: init.body });
    const text = await res.text();
    let json: Json = null;
    if (text) {
      try {
        json = JSON.parse(text) as Json;
      } catch {
        throw new BoomerangError(res.status, "bad_response", `Boomerang answered ${res.status} with something that is not JSON`);
      }
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new BoomerangError(res.status, err?.code ?? "http_" + res.status, err?.message ?? `Boomerang answered ${res.status}`, err?.details);
    }
    return { status: res.status, json };
  }

  /** An unsigned call to one of the open routes (status, register). */
  async open<T>(method: string, path: string, body?: unknown): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = payload ? { "content-type": "application/json" } : {};
    return (await this.send(method, path, { body: payload, headers })).json as T;
  }

  /** A signed call as this agent. Registers first when the key has no id yet. */
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const id = await this.ensureRegistered();
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = { ...(await signRequest(this.key.seed, id, method, path, payload)) };
    if (payload) headers["content-type"] = "application/json";
    return (await this.send(method, path, { body: payload || undefined, headers })).json as T;
  }

  /** Uploads one file to a ticket. The ticketId field goes first, before the file, as the server requires. */
  async upload<T>(ticketId: string, file: { filename: string; mime: string; bytes: Uint8Array }): Promise<T> {
    const id = await this.ensureRegistered();
    const path = "/api/v1/attachments";
    const form = new FormData();
    form.append("ticketId", ticketId);
    // A copy into a fresh ArrayBuffer: Blob refuses a view over a SharedArrayBuffer by type.
    form.append("file", new Blob([new Uint8Array(file.bytes).buffer as ArrayBuffer], { type: file.mime }), file.filename);
    const headers: Record<string, string> = { ...(await signRequest(this.key.seed, id, "POST", path, "")) };
    return (await this.send("POST", path, { body: form, headers })).json as T;
  }

  /**
   * Registers this key when it has no id yet and remembers the id in the key file. Concurrent
   * callers share the one registration in flight, so a burst of tool calls sends one POST.
   */
  async ensureRegistered(): Promise<string> {
    if (this.key.id) return this.key.id;
    this.registering ??= this.register().finally(() => {
      this.registering = null;
    });
    return this.registering;
  }

  private async register(): Promise<string> {
    const publicKey = await publicKeyFromSeed(this.key.seed);
    let id: string;
    try {
      id = (await this.open<{ id: string }>("POST", "/api/v1/agents/register", { name: this.config.name, publicKey })).id;
    } catch (e) {
      if (!(e instanceof BoomerangError) || e.code !== "duplicate_key") throw e;
      // Another process holding the same key file may have registered it since this one read
      // the file (two Claude Code sessions starting at once): the id is in the file by now.
      const fresh = readKey(this.config.keyFile);
      if (!fresh?.id) {
        throw new BoomerangError(409, "duplicate_key", `This key is already registered but ${this.config.keyFile} holds no id. Ask the owner to revoke agent ${this.config.name} on the Agents page, then point BOOMERANG_MCP_KEY_FILE at a new path to register a fresh key.`);
      }
      id = fresh.id;
    }
    this.key.id = id;
    saveKey(this.config.keyFile, this.key);
    return id;
  }
}
