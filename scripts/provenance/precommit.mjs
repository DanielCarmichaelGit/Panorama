#!/usr/bin/env node
// git pre-commit hook: refuse a commit with no open session, otherwise
// write and stage the manifest for the current session and hand its path,
// hashes, and staged tree hash to commitmsg.mjs through .provenance/pending.
//
// The diff is always computed against HEAD, and the manifest records that
// HEAD as its own `base`. For an ordinary commit this is exactly the
// commit's real git parent, so nothing about verification changes. For
// `git commit --amend`, HEAD at pre-commit time is still the commit about
// to be replaced, not the amended commit's real (grandparent) parent --
// pre-commit has no reliable way to know this in advance (prepare-commit-
// msg does, via git's own source/sha arguments, but runs after pre-commit,
// and by then the tree git will commit is already fixed; nothing staged
// from a later hook makes it into the commit). Recording `base` unconditionally,
// rather than trying to guess the eventual real parent, means the manifest
// is always correct by construction: it describes the change introduced
// since whatever HEAD was at this exact recording, which verifyCommit
// accepts once it can prove, from git history itself, that base is either
// sha's real parent or a sibling of sha (see isValidDiffBase in lib.mjs).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  repoRoot,
  paths,
  currentSession,
  stagedDiff,
  sha256,
  appendEntry,
  readSession,
  verifySession,
  writeManifest,
} from "./lib.mjs";

function pendingPath(root) {
  return path.join(paths(root).dir, "pending");
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

function currentHeadOrNull(root) {
  try {
    return execFileSync("git", ["rev-parse", "-q", "--verify", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null; // unborn HEAD: this is the repository's first commit.
  }
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

  const base = currentHeadOrNull(root);
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
    base,
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
