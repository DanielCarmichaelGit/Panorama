#!/usr/bin/env node
import { homedir, hostname } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BoomerangClient } from "./client";
import { loadConfig, loadOrCreateKey } from "./config";
import { describeError } from "./errors";
import { buildServer } from "./tools";

// stdout is the MCP channel, so every line meant for a person goes to stderr.
const log = (line: string) => process.stderr.write(`boomerang-mcp: ${line}\n`);

const config = loadConfig(process.env, homedir(), hostname());
let client: BoomerangClient;
try {
  const { key, created } = loadOrCreateKey(config.keyFile);
  client = new BoomerangClient(config, key);
  if (created) log(`Generated a new key for agent ${config.name} in ${config.keyFile}`);
} catch (e) {
  log((e as Error).message);
  process.exit(1);
}

// Registration is attempted once at start and again on the first tool call if it did not
// take (server down, locked, or not set up yet): the tools are exposed either way.
try {
  const id = await client.ensureRegistered();
  log(`Agent ${config.name} is ${id} at ${config.url}. Approve it on the Agents page if you have not yet.`);
} catch (e) {
  log(describeError(e, { name: config.name, url: config.url, keyFile: config.keyFile }));
}

const server = buildServer(client);
await server.connect(new StdioServerTransport());
