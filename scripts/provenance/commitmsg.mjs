#!/usr/bin/env node
// git commit-msg hook: append the three provenance trailers using what
// precommit.mjs left in .provenance/pending. Absent pending file means the
// skip case (PROVENANCE_SKIP=1): leave the message untouched.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot, paths } from "./lib.mjs";

function pendingPath(root) {
  return path.join(paths(root).dir, "pending");
}

const TRAILER_LINE_RE = /^Provenance-(Manifest|Head|Diff):/;

// I2: `git commit --amend` starts the message from the PREVIOUS commit's
// message, old trailers included. Strip any existing provenance trailer
// lines before appending the current ones, so an amend refreshes them
// instead of duplicating them or leaving the old, now-stale ones in place
// pointing at a manifest this commit no longer matches.
function stripProvenanceTrailers(message) {
  const kept = message.split("\n").filter((line) => !TRAILER_LINE_RE.test(line));
  return kept.join("\n").replace(/\n{3,}$/, "\n\n");
}

function main() {
  const msgFile = process.argv[2];
  if (!msgFile) {
    process.exit(0);
  }

  const root = repoRoot(process.cwd());
  const pending = pendingPath(root);
  if (!fs.existsSync(pending)) {
    process.exit(0);
  }

  const { path: manifestPath, hash, head, diffHash, tree } = JSON.parse(fs.readFileSync(pending, "utf8"));

  // I3: a pending file is only valid for the staged snapshot precommit.mjs
  // wrote it for. If the currently staged tree has since changed (this
  // pending is a leftover from an aborted, different commit attempt),
  // discard it rather than stamp trailers describing someone else's diff
  // onto this commit.
  if (tree) {
    const currentTree = execFileSync("git", ["write-tree"], { cwd: root, encoding: "utf8" }).trim();
    if (currentTree !== tree) {
      fs.unlinkSync(pending);
      process.exit(0);
    }
  }

  let message = stripProvenanceTrailers(fs.readFileSync(msgFile, "utf8"));

  if (!message.endsWith("\n")) message += "\n";
  if (!message.endsWith("\n\n")) message += "\n";
  message +=
    `Provenance-Manifest: sha256:${hash} ${manifestPath}\n` +
    `Provenance-Head: sha256:${head}\n` +
    `Provenance-Diff: sha256:${diffHash}\n`;
  fs.writeFileSync(msgFile, message, "utf8");

  fs.unlinkSync(pending);
  process.exit(0);
}

main();
