// Contribution provenance library: hashing, session files, manifests, and
// verification. Plain Node ES module, no dependencies beyond node: built-ins
// and git. See docs/superpowers/specs/2026-09-24-provenance-design.md.

import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ZERO_HASH = "0".repeat(64);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Same rule as packages/core/src/canonical.ts, reimplemented here so this
// library never imports TypeScript: keys sorted at every depth, no
// whitespace, undefined values dropped.
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

export function repoRoot(cwd = process.cwd()) {
  return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
}

export function paths(root) {
  const dir = path.join(root, ".provenance");
  return {
    dir,
    sessions: path.join(dir, "sessions"),
    manifests: path.join(dir, "manifests"),
    current: path.join(dir, "current"),
  };
}

export function currentSession(root) {
  const { current } = paths(root);
  if (!fs.existsSync(current)) return null;
  const id = fs.readFileSync(current, "utf8").trim();
  return id || null;
}

export function setCurrent(root, id) {
  const { dir, current } = paths(root);
  if (id === null || id === undefined) {
    if (fs.existsSync(current)) fs.unlinkSync(current);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(current, `${id}\n`, "utf8");
}

function sessionId(now) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `s_${stamp}_${randomBytes(3).toString("hex")}`;
}

function sessionFile(root, id) {
  return path.join(paths(root).sessions, `${id}.jsonl`);
}

function readLastEntry(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  const lines = text.split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

export function startSession(root, { actor, tool, intent }, now = new Date()) {
  const id = sessionId(now);
  const { sessions } = paths(root);
  fs.mkdirSync(sessions, { recursive: true });

  const ts = now.toISOString();
  const withoutHash = { seq: 1, type: "start", ts, actor, tool, intent, prev: ZERO_HASH };
  const hash = sha256(withoutHash.prev + canonical(withoutHash));
  const entry = { ...withoutHash, hash };

  fs.writeFileSync(sessionFile(root, id), `${JSON.stringify(entry)}\n`, "utf8");
  setCurrent(root, id);
  return { id, entry };
}

// Builds the type-specific fields that get hashed into an entry. Raw tool
// input is never stored, only its hash; prompt text is stored locally
// alongside its hash (session files are never committed).
function entryData(type, rest) {
  if (type === "prompt") {
    const text = rest.text ?? "";
    return { text, textHash: sha256(text) };
  }
  if (type === "tool") {
    return {
      tool: rest.tool,
      inputHash: sha256(canonical(rest.input ?? null)),
      files: rest.files ?? [],
    };
  }
  return rest;
}

export function appendEntry(root, id, fields, now = new Date()) {
  const file = sessionFile(root, id);
  const last = readLastEntry(file);
  const { type, ...rest } = fields;

  const seq = last.seq + 1;
  const prev = last.hash;
  const ts = now.toISOString();
  const data = entryData(type, rest);

  const withoutHash = { seq, type, ts, prev, ...data };
  const hash = sha256(prev + canonical(withoutHash));
  const entry = { ...withoutHash, hash };

  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export function readSession(root, id) {
  const file = sessionFile(root, id);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function verifySession(entries) {
  if (entries.length === 0) return { ok: false, brokenAt: 0 };
  let prevHash = ZERO_HASH;
  for (const entry of entries) {
    const { hash, ...withoutHash } = entry;
    if (withoutHash.prev !== prevHash) return { ok: false, brokenAt: entry.seq };
    const expected = sha256(withoutHash.prev + canonical(withoutHash));
    if (expected !== hash) return { ok: false, brokenAt: entry.seq };
    prevHash = hash;
  }
  return { ok: true, head: prevHash, count: entries.length };
}

const DIFF_PATHSPEC = ["--", ".", ":!.provenance"];

export function stagedDiff(root) {
  const diff = git(root, ["diff", "--cached", "--no-color", ...DIFF_PATHSPEC]);
  const out = git(root, ["diff", "--cached", "--name-only", ...DIFF_PATHSPEC]);
  const files = out.trim().split("\n").filter(Boolean);
  return { diff, files };
}

export function commitDiff(root, sha) {
  let parent;
  try {
    // A root commit has no parent; "sha^" fails, and git writes a "fatal:"
    // line to stderr even though we handle the failure. Pipe stderr away so
    // this expected case stays quiet.
    parent = execFileSync("git", ["rev-parse", `${sha}^`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    parent = EMPTY_TREE;
  }
  const diff = git(root, ["diff", "--no-color", parent, sha, ...DIFF_PATHSPEC]);
  const out = git(root, ["diff", "--name-only", parent, sha, ...DIFF_PATHSPEC]);
  const files = out.trim().split("\n").filter(Boolean);
  return { diff, files };
}

export function writeManifest(root, m) {
  const { manifests } = paths(root);
  fs.mkdirSync(manifests, { recursive: true });

  const hash = sha256(canonical(m));
  const relPath = path.posix.join(".provenance", "manifests", `${m.sessionId}-${m.count}.json`);
  fs.writeFileSync(path.join(root, relPath), `${JSON.stringify(m, null, 2)}\n`, "utf8");

  return { path: relPath, hash };
}

const TRAILER_RE = {
  manifest: /^Provenance-Manifest: sha256:([0-9a-f]{64}) (\S+)$/m,
  head: /^Provenance-Head: sha256:([0-9a-f]{64})$/m,
  diff: /^Provenance-Diff: sha256:([0-9a-f]{64})$/m,
};

export function parseTrailers(message) {
  const result = {};
  const manifestMatch = message.match(TRAILER_RE.manifest);
  if (manifestMatch) result.manifest = { hash: manifestMatch[1], path: manifestMatch[2] };
  const headMatch = message.match(TRAILER_RE.head);
  if (headMatch) result.head = headMatch[1];
  const diffMatch = message.match(TRAILER_RE.diff);
  if (diffMatch) result.diff = diffMatch[1];
  return result;
}

function mapSignature(code) {
  switch (code) {
    case "G":
      return "signed";
    case "N":
      return "unsigned";
    case "U":
    case "X":
    case "Y":
    case "R":
      return "unknown-key";
    case "B":
    case "E":
      return "bad";
    default:
      return "unsigned";
  }
}

export function verifyCommit(root, sha) {
  const subject = git(root, ["log", "-1", "--format=%s", sha]).trim();
  const message = git(root, ["log", "-1", "--format=%B", sha]);
  const trailers = parseTrailers(message);
  const problems = [];

  const recorded = Boolean(trailers.manifest && trailers.head && trailers.diff);
  if (!recorded) problems.push("missing provenance trailers");

  let manifestObj = null;
  let manifestOk = false;
  if (trailers.manifest) {
    try {
      const content = git(root, ["show", `${sha}:${trailers.manifest.path}`]);
      manifestObj = JSON.parse(content);
      manifestOk = sha256(canonical(manifestObj)) === trailers.manifest.hash;
      if (!manifestOk) problems.push("manifest hash does not match trailer");
    } catch {
      problems.push("manifest file not found in commit");
    }
  }

  const { diff, files } = commitDiff(root, sha);
  const diffHash = sha256(diff);
  let diffOk = false;
  if (trailers.diff) {
    diffOk = diffHash === trailers.diff;
    if (!diffOk) problems.push("diff hash does not match trailer");
  }

  let filesOk = false;
  if (manifestObj) {
    const manifestFiles = [...(manifestObj.files ?? [])].sort();
    const actualFiles = [...files].sort();
    filesOk = JSON.stringify(manifestFiles) === JSON.stringify(actualFiles);
    if (!filesOk) problems.push("manifest file list does not match the commit's diff");
  }

  const sigCode = git(root, ["log", "-1", "--format=%G?", sha]).trim();
  const signature = mapSignature(sigCode);

  let transcript = "unavailable";
  if (manifestObj) {
    const entries = readSession(root, manifestObj.sessionId);
    if (entries.length > 0) {
      const verified = verifySession(entries);
      if (verified.ok && verified.head === manifestObj.head) {
        transcript = "matches";
      } else {
        transcript = "mismatch";
        problems.push("local transcript does not match the recorded head");
      }
    }
  }

  return { sha, subject, recorded, manifestOk, diffOk, filesOk, signature, transcript, problems };
}

export function verifyRange(root, range) {
  const args = range ? ["log", "--format=%H", range] : ["log", "--format=%H", "-20"];
  const out = git(root, args).trim();
  const shas = out ? out.split("\n").reverse() : [];
  return shas.map((sha) => verifyCommit(root, sha));
}
