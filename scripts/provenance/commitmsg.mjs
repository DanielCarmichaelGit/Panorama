#!/usr/bin/env node
// git commit-msg hook: append the three provenance trailers using what
// precommit.mjs left in .provenance/pending. Absent pending file means the
// skip case (PROVENANCE_SKIP=1): leave the message untouched.

import fs from "node:fs";
import path from "node:path";
import { repoRoot, paths } from "./lib.mjs";

function pendingPath(root) {
  return path.join(paths(root).dir, "pending");
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

  const { path: manifestPath, hash, head, diffHash } = JSON.parse(fs.readFileSync(pending, "utf8"));
  let message = fs.readFileSync(msgFile, "utf8");

  if (!message.includes("Provenance-Manifest:")) {
    if (!message.endsWith("\n")) message += "\n";
    if (!message.endsWith("\n\n")) message += "\n";
    message +=
      `Provenance-Manifest: sha256:${hash} ${manifestPath}\n` +
      `Provenance-Head: sha256:${head}\n` +
      `Provenance-Diff: sha256:${diffHash}\n`;
    fs.writeFileSync(msgFile, message, "utf8");
  }

  fs.unlinkSync(pending);
  process.exit(0);
}

main();
