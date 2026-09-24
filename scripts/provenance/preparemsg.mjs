#!/usr/bin/env node
// git prepare-commit-msg hook: git's own, reliable signal for "this commit
// is an amend" (source === "commit" and the given sha resolves to current
// HEAD -- the same source/sha pair also covers `-c`/`-C <ref>`, which this
// deliberately does NOT treat as an amend when <ref> is not HEAD, since
// that leaves a normal commit with HEAD as its real parent). Runs after
// pre-commit and before commit-msg in git's hook sequence.
//
// IMPORTANT: by the time this hook runs, the tree git is about to commit
// is already fixed -- pre-commit is the only hook whose changes to the
// index/working tree actually make it into the resulting commit; staging
// something from prepare-commit-msg or commit-msg has no effect on the
// commit's content, only pre-commit's own staging does. (Verified directly:
// a file written and `git add`ed from prepare-commit-msg, even overwriting
// content pre-commit already staged, is absent from the finished commit.)
// So this hook cannot correct the manifest file itself -- that is why
// precommit.mjs records its own diff base unconditionally instead of
// trying to detect amends (see the comment there). What this hook DOES do:
// confirm the detection and record it on pending, purely for visibility --
// there is nothing to recompute or re-stage.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot, paths } from "./lib.mjs";

function pendingPath(root) {
  return path.join(paths(root).dir, "pending");
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function resolveOrNull(root, ref) {
  try {
    return git(root, ["rev-parse", "-q", "--verify", ref]).trim();
  } catch {
    return null;
  }
}

function main() {
  const [, , msgFile, source, commitRef] = process.argv;
  if (!msgFile) process.exit(0);

  const root = repoRoot(process.cwd());
  const pendingFile = pendingPath(root);
  if (!fs.existsSync(pendingFile)) process.exit(0); // skip case, or no session: nothing to annotate

  if (source !== "commit" || !commitRef) process.exit(0); // not an amend or -c/-C

  try {
    const headSha = resolveOrNull(root, "HEAD");
    const commitSha = resolveOrNull(root, commitRef);
    if (!headSha || !commitSha || commitSha !== headSha) process.exit(0); // -c/-C <other ref>, not an amend

    const pending = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
    fs.writeFileSync(pendingFile, JSON.stringify({ ...pending, amend: true, amendedFrom: headSha }), "utf8");
  } catch {
    // Best effort: this is purely informational, never worth blocking a
    // commit over.
  }

  process.exit(0);
}

main();
