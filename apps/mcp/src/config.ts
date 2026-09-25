import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENT_ACTIONS, type Scopes } from "@boomerang/core";

const bytesToHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const hexToBytes = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));

export type Env = Record<string, string | undefined>;

export interface McpConfig {
  /** Where Boomerang listens. */
  url: string;
  /** The name this agent registers under; the owner sees it on the Agents page. */
  name: string;
  /** The file holding this agent's own seed and registered id, and nothing else. */
  keyFile: string;
  /** The scopes to ask the owner for at approval: every agent action, on these projects. */
  scopes: Scopes;
}

export const DEFAULT_URL = "http://127.0.0.1:4400";

/** A name the server accepts (1 to 60 characters) that is also safe as a file name. */
export function defaultAgentName(hostname: string): string {
  const host = hostname.split(".")[0].replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return `${host || "agent"}-claude`.slice(0, 60);
}

const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "-");

export function loadConfig(env: Env, home: string, hostname: string): McpConfig {
  const url = (env.BOOMERANG_URL ?? DEFAULT_URL).replace(/\/+$/, "");
  const name = (env.BOOMERANG_AGENT_NAME ?? "").trim().slice(0, 60) || defaultAgentName(hostname);
  const keyFile = env.BOOMERANG_MCP_KEY_FILE || join(home, ".boomerang-mcp", `${safeFileName(name)}.json`);
  const projectList = (env.BOOMERANG_PROJECTS ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const scopes: Scopes = { projects: projectList.length > 0 ? projectList : "*", actions: [...AGENT_ACTIONS] };
  return { url, name, keyFile, scopes };
}

/** What the key file holds: the agent's own Ed25519 seed and the id the server gave it. */
export interface AgentKey {
  seed: Uint8Array;
  /** Null until registration succeeds, so a failed first run keeps the same key and retries. */
  id: string | null;
}

interface KeyFileShape { version: 1; seed: string; id: string | null }

const HEX_SEED = /^[0-9a-f]{64}$/;

function parseKeyFile(path: string, text: string): AgentKey {
  let parsed: Partial<KeyFileShape>;
  try {
    parsed = JSON.parse(text) as Partial<KeyFileShape>;
  } catch {
    throw new Error(`${path} is not valid JSON. Remove it to register a new key.`);
  }
  if (!parsed || typeof parsed.seed !== "string" || !HEX_SEED.test(parsed.seed) || (parsed.id !== null && typeof parsed.id !== "string")) {
    throw new Error(`${path} does not hold an agent key. Remove it to register a new key.`);
  }
  return { seed: hexToBytes(parsed.seed), id: parsed.id ?? null };
}

/** Writes the key with owner-only permissions: a new file is created at mode 600 and its
 *  directory at 700, and an existing file is set back to 600 in case it drifted. */
export function saveKey(path: string, key: AgentKey): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body: KeyFileShape = { version: 1, seed: bytesToHex(key.seed), id: key.id };
  writeFileSync(path, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Reads the key file, or generates a fresh seed and writes one when there is none yet. */
export function loadOrCreateKey(path: string, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): { key: AgentKey; created: boolean } {
  if (existsSync(path)) return { key: parseKeyFile(path, readFileSync(path, "utf8")), created: false };
  const key: AgentKey = { seed: random(32), id: null };
  saveKey(path, key);
  return { key, created: true };
}
