#!/usr/bin/env node
// git pre-commit hook: refuse a commit with no open session, otherwise
// write and stage the manifest for the current session and hand its path,
// hashes, and staged tree hash to commitmsg.mjs through .provenance/pending.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  repoRoot,
  paths,
  currentSession,
  stagedDiff,
  stagedDiffAgainst,
  sha256,
  appendEntry,
  readSession,
  verifySession,
  writeManifest,
} from "./lib.mjs";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function pendingPath(root) {
  return path.join(paths(root).dir, "pending");
}

// At pre-commit time HEAD is still whatever commit is about to be
// replaced (for a normal commit, that IS the new commit's parent; for
// `git commit --amend`, the new commit's real parent is HEAD's own
// parent). Git gives hooks no direct amend signal at this point in the
// hook sequence (prepare-commit-msg, which does get one, runs after
// pre-commit) -- the reliable indirect signal is the invoking git
// process's own command line, inspected through its pid.
function isAmend() {
  try {
    const cmd = execFileSync("ps", ["-o", "command=", "-p", String(process.ppid)], { encoding: "utf8" });
    return /--amend\b/.test(cmd);
  } catch {
    return false; // ps unavailable or the pid is already gone: assume not.
  }
}

function amendDiffBase(root) {
  try {
    return execFileSync("git", ["rev-parse", "-q", "--verify", "HEAD^"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return EMPTY_TREE; // amending a root commit: it has no parent either.
  }
}

// I3: a pending file only means anything for the exact commit precommit.mjs
// just wrote it for. If that attempt is later aborted (the editor is
// cancelled, --no-verify skips commit-msg, ...) and a DIFFERENT commit
// follows, a leftover pending must never stamp trailers onto it. Whenever
// this hook is about to let a commit through without writing a fresh
// pending, clear any stale one first.
function clearPending(root) {
  const p = pendingPath(root);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function main() {
  const root = repoRoot(process.cwd());

  if (process.env.PROVENANCE_SKIP === "1") {
    console.warn("provenance: PROVENANCE_SKIP=1, committing without a recorded session");
    clearPending(root);
    process.exit(0);
  }

  const sessionId = currentSession(root);
  if (!sessionId) {
    clearPending(root);
    console.error(
      'provenance: no session is open. Run `pnpm provenance start "<intent>"` first, ' +
        "or set PROVENANCE_SKIP=1 to bypass (the commit will verify as unrecorded)."
    );
    process.exit(1);
  }

  const { diff, files } = isAmend() ? stagedDiffAgainst(root, amendDiffBase(root)) : stagedDiff(root);
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

  // I3: the staged tree hash, captured AFTER staging the manifest, so
  // commitmsg.mjs can confirm at its own turn that it is still looking at
  // the same staged snapshot this pending file was written for.
  const tree = execFileSync("git", ["write-tree"], { cwd: root, encoding: "utf8" }).trim();

  fs.mkdirSync(paths(root).dir, { recursive: true });
  fs.writeFileSync(
    pendingPath(root),
    JSON.stringify({ path: manifestPath, hash: manifestHash, head: verified.head, diffHash, tree }),
    "utf8"
  );

  process.exit(0);
}

main();
