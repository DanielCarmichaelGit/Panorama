#!/usr/bin/env node
// pnpm provenance <start|note|prompt|tool|status|end|install|verify>
// See docs/provenance.md and docs/superpowers/specs/2026-09-24-provenance-design.md.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  repoRoot,
  currentSession,
  setCurrent,
  startSession,
  appendEntry,
  readSession,
  verifySession,
  stagedDiff,
  verifyRange,
} from "./lib.mjs";

function readStdin() {
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

function requireSession(root) {
  const id = currentSession(root);
  if (!id) {
    console.error('provenance: no session is open. Run `pnpm provenance start "<intent>"` first.');
    process.exit(1);
  }
  return id;
}

function cmdStart(root, args) {
  const intent = args.join(" ").trim();
  if (!intent) {
    console.error('provenance: usage: pnpm provenance start "<intent>"');
    process.exit(1);
  }
  const actor = actorFromGit(root);
  const tool = process.env.PROVENANCE_TOOL || "cli";
  const { id } = startSession(root, { actor, tool, intent });
  console.log(`provenance: started session ${id}`);
}

function cmdNote(root, args) {
  const id = requireSession(root);
  const text = args.join(" ").trim();
  if (!text) {
    console.error('provenance: usage: pnpm provenance note "<text>"');
    process.exit(1);
  }
  appendEntry(root, id, { type: "note", text });
  console.log("provenance: note recorded");
}

function cmdPrompt(root) {
  const id = requireSession(root);
  const text = readStdin();
  appendEntry(root, id, { type: "prompt", text });
  console.log("provenance: prompt recorded");
}

function cmdTool(root, args) {
  const id = requireSession(root);
  const [name, ...files] = args;
  if (!name) {
    console.error("provenance: usage: pnpm provenance tool <name> [files...]");
    process.exit(1);
  }
  const raw = readStdin();
  let input;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = { raw };
  }
  appendEntry(root, id, { type: "tool", tool: name, input, files });
  console.log("provenance: tool call recorded");
}

function cmdEnd(root) {
  const id = requireSession(root);
  appendEntry(root, id, { type: "end" });
  setCurrent(root, null);
  console.log(`provenance: ended session ${id}`);
}

function cmdStatus(root, args) {
  const json = args.includes("--json");
  const id = currentSession(root);
  if (!id) {
    if (json) console.log(JSON.stringify({ session: null }));
    else console.log("provenance: no session is open");
    return;
  }

  const entries = readSession(root, id);
  const verified = verifySession(entries);
  const { files } = stagedDiff(root);
  const result = {
    session: id,
    count: entries.length,
    chainOk: verified.ok,
    head: verified.ok ? verified.head : null,
    stagedFiles: files,
  };

  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(`provenance: session ${id}`);
  console.log(`  entries: ${result.count}`);
  console.log(`  chain: ${verified.ok ? "ok" : `broken at seq ${verified.brokenAt}`}`);
  console.log(`  head: ${result.head ?? "n/a"}`);
  console.log(`  staged files: ${files.length ? files.join(", ") : "(none)"}`);
}

function cmdInstall(root) {
  execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { cwd: root });

  const hooksDir = path.join(root, ".githooks");
  for (const name of ["pre-commit", "commit-msg"]) {
    const file = path.join(hooksDir, name);
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
  }

  console.log("provenance: set core.hooksPath to .githooks (local to this repository)");
  console.log("provenance: made .githooks/pre-commit and .githooks/commit-msg executable");
}

// Table columns fit within 100 characters: 7+8+8+4+5+11+11 plus 6
// three-character separators is 72.
const TABLE_COLUMNS = ["SHA", "RECORDED", "MANIFEST", "DIFF", "FILES", "SIGNATURE", "TRANSCRIPT"];
const TABLE_WIDTHS = [7, 8, 8, 4, 5, 11, 11];

function formatRow(cells) {
  return cells.map((c, i) => String(c).padEnd(TABLE_WIDTHS[i])).join(" | ").trimEnd();
}

// I5: a merge commit's report carries null for the four provenance
// booleans (exempt, not failing) -- show "-" rather than misreading null
// as a falsy "no"/"x".
function formatTable(reports) {
  const rows = reports.map((r) =>
    r.merge
      ? [r.sha.slice(0, 7), "merge", "-", "-", "-", r.signature, r.transcript]
      : [
          r.sha.slice(0, 7),
          r.recorded ? "yes" : "no",
          r.manifestOk ? "ok" : "x",
          r.diffOk ? "ok" : "x",
          r.filesOk ? "ok" : "x",
          r.signature,
          r.transcript,
        ]
  );
  const lines = [formatRow(TABLE_COLUMNS), formatRow(TABLE_WIDTHS.map((w) => "-".repeat(w)))];
  for (const row of rows) lines.push(formatRow(row));
  return lines.join("\n");
}

function defaultRange(root) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"], {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return "origin/main..HEAD";
  } catch {
    return null; // verifyRange falls back to the last 20 commits.
  }
}

function cmdVerify(root, args) {
  const json = args.includes("--json");
  const range = args.find((a) => !a.startsWith("--")) || defaultRange(root);

  const reports = verifyRange(root, range);
  // I1: problems is the authoritative list of what is wrong with a commit.
  // The four booleans alone miss failure modes that don't touch them (a
  // transcript mismatch, a bad signature) -- problems catches all of it,
  // and a merge commit's report carries none, so it never fails the range.
  const failed = reports.some((r) => r.problems.length > 0);

  if (json) {
    console.log(JSON.stringify(reports, null, 2));
  } else if (reports.length === 0) {
    console.log("provenance: no commits in range");
  } else {
    console.log(formatTable(reports));
  }

  process.exit(failed ? 1 : 0);
}

function main() {
  const [, , command, ...rest] = process.argv;
  const root = repoRoot(process.cwd());

  switch (command) {
    case "start":
      return cmdStart(root, rest);
    case "note":
      return cmdNote(root, rest);
    case "prompt":
      return cmdPrompt(root);
    case "tool":
      return cmdTool(root, rest);
    case "status":
      return cmdStatus(root, rest);
    case "end":
      return cmdEnd(root);
    case "install":
      return cmdInstall(root);
    case "verify":
      return cmdVerify(root, rest);
    default:
      console.error("provenance: usage: pnpm provenance <start|note|prompt|tool|status|end|install|verify>");
      process.exit(1);
  }
}

main();
