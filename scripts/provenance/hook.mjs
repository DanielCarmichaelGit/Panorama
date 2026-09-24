#!/usr/bin/env node
// Claude Code hook adapter. Reads one JSON hook payload from stdin and
// appends an entry to the current provenance session, starting one if none
// is open. Must always exit 0 and print nothing to stdout: a hook that
// fails or is noisy would block the agent it is watching. Errors go to
// .provenance/hook.log instead.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { repoRoot, paths, currentSession, startSession, appendEntry } from "./lib.mjs";

const TOOL_NAMES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"]);

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function actorFromGit(root) {
  try {
    return execFileSync("git", ["config", "user.name"], { cwd: root, encoding: "utf8" }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function logError(root, err) {
  try {
    const dir = paths(root).dir;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "hook.log"), `${new Date().toISOString()} ${err && err.stack ? err.stack : err}\n`, "utf8");
  } catch {
    // Logging must never throw past this hook either.
  }
}

function run() {
  const raw = readStdinSync();
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return; // No valid payload: nothing to record.
  }

  // M1: this hook's own repository, resolved from where this file
  // physically lives, not from anything a payload claims. A payload's cwd
  // is trusted input only insofar as it is checked against this.
  const root = repoRoot(path.dirname(fileURLToPath(import.meta.url)));

  // A payload whose cwd resolves to some other repository is not this
  // hook's business -- ignore it rather than recording into (or worse,
  // resolving into) a repository this hook does not belong to.
  if (event.cwd) {
    let eventRoot;
    try {
      eventRoot = repoRoot(event.cwd);
    } catch {
      eventRoot = null;
    }
    if (eventRoot !== root) {
      logError(
        root,
        new Error(
          `ignoring payload whose cwd (${event.cwd}) resolves to ${eventRoot ?? "no git repository"}, ` +
            `not this hook's own repository (${root})`
        )
      );
      return;
    }
  }

  let sessionId = currentSession(root);
  if (!sessionId) {
    const intent =
      event.hook_event_name === "UserPromptSubmit"
        ? (event.prompt || "").slice(0, 120) || "unstated"
        : "unstated";
    sessionId = startSession(root, { actor: actorFromGit(root), tool: "claude-code", intent }).id;
  }

  if (event.hook_event_name === "UserPromptSubmit") {
    appendEntry(root, sessionId, { type: "prompt", text: event.prompt || "" });
  } else if (event.hook_event_name === "PostToolUse" && TOOL_NAMES.has(event.tool_name)) {
    const files = event.tool_input && event.tool_input.file_path ? [event.tool_input.file_path] : undefined;
    appendEntry(root, sessionId, { type: "tool", tool: event.tool_name, input: event.tool_input, files });
  }
}

try {
  run();
} catch (err) {
  try {
    // Best-effort fallback for logging: resolve from this file's own
    // location again, same as run() does, since anything else (like the
    // process cwd) is exactly the untrusted input M1 exists to not rely on.
    logError(repoRoot(path.dirname(fileURLToPath(import.meta.url))), err);
  } catch {
    // Truly nowhere to log this; never let it surface past the hook.
  }
}

process.exit(0);
