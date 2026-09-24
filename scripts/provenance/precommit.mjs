#!/usr/bin/env node
// git pre-commit hook: refuse a commit with no open session, otherwise
// write and stage the manifest for the current session and hand its path
// and hashes to commitmsg.mjs through .provenance/pending.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot, paths, currentSession, stagedDiff, sha256, appendEntry, readSession, verifySession, writeManifest } from "./lib.mjs";

function pendingPath(root) {
  return path.join(paths(root).dir, "pending");
}

function main() {
  const root = repoRoot(process.cwd());

  if (process.env.PROVENANCE_SKIP === "1") {
    console.warn("provenance: PROVENANCE_SKIP=1, committing without a recorded session");
    process.exit(0);
  }

  const sessionId = currentSession(root);
  if (!sessionId) {
    console.error(
      'provenance: no session is open. Run `pnpm provenance start "<intent>"` first, ' +
        "or set PROVENANCE_SKIP=1 to bypass (the commit will verify as unrecorded)."
    );
    process.exit(1);
  }

  const { diff, files } = stagedDiff(root);
  const diffHash = sha256(diff);

  appendEntry(root, sessionId, { type: "commit", diffHash, files });

  const entries = readSession(root, sessionId);
  const verified = verifySession(entries);
  if (!verified.ok) {
    console.error(`provenance: local session chain is broken at seq ${verified.brokenAt}; refusing to commit`);
    process.exit(1);
  }

  const start = entries[0];
  const manifest = {
    sessionId,
    actor: start.actor,
    tool: start.tool,
    intent: start.intent,
    head: verified.head,
    count: verified.count,
    diffHash,
    files,
    ts: new Date().toISOString(),
  };
  const { path: manifestPath, hash: manifestHash } = writeManifest(root, manifest);
  execFileSync("git", ["add", manifestPath], { cwd: root });

  fs.mkdirSync(paths(root).dir, { recursive: true });
  fs.writeFileSync(
    pendingPath(root),
    JSON.stringify({ path: manifestPath, hash: manifestHash, head: verified.head, diffHash }),
    "utf8"
  );

  process.exit(0);
}

main();
