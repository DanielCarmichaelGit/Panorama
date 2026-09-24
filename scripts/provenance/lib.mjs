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

// M2: stdin ignored, stdout piped and captured, stderr piped and captured
// (never inherited to our own stderr). Without this, an expected failure
// such as `rev-parse <root-commit>^` prints git's own "fatal:" line
// straight to the process, even though we catch and handle it.
function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
  // "note", "commit", "end", and any future type pass their fields through
  // close to verbatim, so this is the one place a caller could otherwise
  // smuggle hash/prev/seq/ts in. Drop them here, at the source, rather
  // than relying only on appendEntry's field order to override three of
  // the four (hash was not covered by that at all).
  const { hash, prev, seq, ts, ...safe } = rest;
  return safe;
}

export function appendEntry(root, id, fields, now = new Date()) {
  const file = sessionFile(root, id);
  const last = readLastEntry(file);
  const { type, ...rest } = fields;
  const data = entryData(type, rest);

  // M3: seq, ts, and prev are the library's to set, not the caller's.
  // Spreading `data` first and these fixed fields last means a caller
  // cannot smuggle its own seq/ts/prev through `fields` and shift the
  // chain.
  const seq = last.seq + 1;
  const prev = last.hash;
  const ts = now.toISOString();
  const withoutHash = { ...data, seq, type, ts, prev };
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
  let expectedSeq = 1;
  for (const entry of entries) {
    const { hash, ...withoutHash } = entry;
    // C2: seq must climb by exactly one from 1. A forged chain that drops
    // an entry can still be internally consistent (correct prev linkage,
    // correct hash for its own content); only checking seq catches a
    // skipped or duplicated entry that hash/prev linkage alone would miss.
    if (withoutHash.seq !== expectedSeq) return { ok: false, brokenAt: entry.seq };
    if (withoutHash.prev !== prevHash) return { ok: false, brokenAt: entry.seq };
    const expected = sha256(withoutHash.prev + canonical(withoutHash));
    if (expected !== hash) return { ok: false, brokenAt: entry.seq };
    prevHash = hash;
    expectedSeq += 1;
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

// A root commit has no parent; "sha^" fails (git() now pipes that "fatal:"
// line to a captured stderr rather than leaking it, per M2).
function parentOf(root, sha) {
  try {
    return git(root, ["rev-parse", `${sha}^`]).trim();
  } catch {
    return EMPTY_TREE;
  }
}

function resolveOrNull(root, ref) {
  try {
    return git(root, ["rev-parse", "-q", "--verify", `${ref}^{commit}`]).trim();
  } catch {
    return null;
  }
}

// commitDiff diffs a commit against an explicit base when given one,
// otherwise against its real git parent (unchanged default behavior).
// verifyCommit passes a manifest's own recorded `base` here once that
// base has been structurally validated (see isValidDiffBase) -- for an
// ordinary commit this is always the same as the real parent, so nothing
// changes; it only differs for `git commit --amend` (see preparemsg.mjs).
export function commitDiff(root, sha, base) {
  const parent = base ?? parentOf(root, sha);
  const diff = git(root, ["diff", "--no-color", parent, sha, ...DIFF_PATHSPEC]);
  const out = git(root, ["diff", "--name-only", parent, sha, ...DIFF_PATHSPEC]);
  const files = out.trim().split("\n").filter(Boolean);
  return { diff, files };
}

// A manifest's `base` is trustworthy as a diff comparison point only when
// it is structurally provable from git history itself, not merely
// asserted: either it IS sha's real parent (the ordinary case), or it is
// a sibling of sha -- some other commit sharing sha's real parent, which
// is exactly the git-verifiable shape `git commit --amend` produces (the
// pre-amend commit and the amended commit share one parent). An arbitrary,
// unrelated commit fails both checks.
function isValidDiffBase(root, base, sha) {
  const baseSha = resolveOrNull(root, base);
  if (!baseSha) return false;
  const realParent = parentOf(root, sha);
  if (baseSha === realParent) return true;
  return parentOf(root, baseSha) === realParent;
}

// C1: files this commit ADDED (not modified, not merely present because an
// earlier commit added them). Used to bind a manifest to the one commit
// that legitimately created it, not to any later commit that merely
// references its still-tracked path and hash.
function addedFiles(root, sha) {
  const parent = parentOf(root, sha);
  const out = git(root, ["diff", "--name-only", "--diff-filter=A", parent, sha]);
  return out.trim().split("\n").filter(Boolean);
}

function parentCount(root, sha) {
  const parents = git(root, ["log", "-1", "--format=%P", sha]).trim();
  return parents ? parents.split(/\s+/).length : 0;
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

// I5: a merge commit is exempt from provenance (nothing wrote a manifest
// for "merge these two branches"). It gets its own report shape: neither
// recorded nor failed, so it never trips the CLI's problems-based exit
// code, and never shows the ordinary provenance columns as if a manifest
// were expected.
function verifyMergeCommit(root, sha) {
  const subject = git(root, ["log", "-1", "--format=%s", sha]).trim();
  const sigCode = git(root, ["log", "-1", "--format=%G?", sha]).trim();
  const signature = mapSignature(sigCode);
  return {
    sha,
    subject,
    recorded: null,
    manifestOk: null,
    diffOk: null,
    filesOk: null,
    signature,
    transcript: "merge",
    problems: [],
    merge: true,
  };
}

export function verifyCommit(root, sha) {
  if (parentCount(root, sha) > 1) return verifyMergeCommit(root, sha);

  const subject = git(root, ["log", "-1", "--format=%s", sha]).trim();
  const message = git(root, ["log", "-1", "--format=%B", sha]);
  const trailers = parseTrailers(message);
  const problems = [];

  const recorded = Boolean(trailers.manifest && trailers.head && trailers.diff);
  if (!recorded) problems.push("missing provenance trailers");

  // C1: a manifest that merely hashes correctly is not enough. An old,
  // still-tracked manifest from an earlier commit hashes correctly too.
  // Bind it to THIS commit: its path must be a real manifest path, it
  // must have been ADDED by this commit (not carried forward unchanged
  // from one that already used it), and its own head must match what
  // actually happened here.
  //
  // Fetched before the diff below because an amended commit's manifest
  // carries its own `base` (see preparemsg.mjs): at pre-commit time HEAD
  // is still the commit about to be replaced, not the amended commit's
  // real parent, so precommit.mjs always records the diff relative to
  // whatever HEAD was at that moment ("the change introduced by this
  // specific recording"), not necessarily the commit's total diff from
  // its real git parent. `base` is trusted only once proven, from git
  // history itself, to be either sha's real parent or a sibling of sha
  // (isValidDiffBase) -- an ordinary commit's base is always its real
  // parent, so this changes nothing for the overwhelming majority of
  // commits, and never lets a manifest claim an unrelated base.
  let manifestObj = null;
  let manifestOk = false;
  if (trailers.manifest) {
    if (!trailers.manifest.path.startsWith(".provenance/manifests/")) {
      problems.push("manifest path is outside .provenance/manifests/");
    } else {
      try {
        const content = git(root, ["show", `${sha}:${trailers.manifest.path}`]);
        manifestObj = JSON.parse(content);

        const hashOk = sha256(canonical(manifestObj)) === trailers.manifest.hash;
        if (!hashOk) problems.push("manifest hash does not match trailer");

        const headOk = manifestObj.head === trailers.head;
        if (!headOk) problems.push("manifest head does not match the Provenance-Head trailer");

        const addedOk = addedFiles(root, sha).includes(trailers.manifest.path);
        if (!addedOk) {
          problems.push("manifest was not added by this commit (it may be reused from an earlier one)");
        }

        manifestOk = hashOk && headOk && addedOk;
      } catch {
        problems.push("manifest file not found in commit");
      }
    }
  }

  let diffBase;
  if (manifestObj && manifestObj.base) {
    if (isValidDiffBase(root, manifestObj.base, sha)) {
      diffBase = manifestObj.base;
    } else {
      // Not fatal on its own (the diff below falls back to the real
      // parent, same as an unrecorded commit), but a manifest claiming an
      // unrelated base is itself suspicious and worth surfacing.
      problems.push("manifest base is not sha's real parent or a sibling of sha");
      manifestOk = false;
    }
  }
  const { diff, files } = commitDiff(root, sha, diffBase);
  const diffHash = sha256(diff);
  let diffOk = false;
  if (trailers.diff) {
    diffOk = diffHash === trailers.diff;
    if (!diffOk) problems.push("diff hash does not match trailer");
  }

  if (manifestObj) {
    const diffBoundOk = manifestObj.diffHash === diffHash;
    if (!diffBoundOk) problems.push("manifest diffHash does not match this commit's actual diff");
    manifestOk = manifestOk && diffBoundOk;
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
  // I1: a cryptographically bad signature is a problem in its own right,
  // independent of the four provenance booleans above.
  if (signature === "bad") problems.push("commit signature does not verify");

  // C2: compare the entry the manifest actually points at (the count-th
  // entry, at the time of that commit), not the session's CURRENT head.
  // A session that goes on to make a second commit has a head that moves
  // past what the first commit's manifest recorded; comparing against the
  // live head would wrongly call the first commit's transcript a mismatch.
  // Requiring entries.length >= manifest.count also catches a session file
  // truncated below what the manifest claims, which an internally
  // consistent (but short) chain would otherwise pass.
  let transcript = "unavailable";
  if (manifestObj) {
    const entries = readSession(root, manifestObj.sessionId);
    if (entries.length > 0) {
      const verified = verifySession(entries);
      const atCount = entries.length >= manifestObj.count ? entries[manifestObj.count - 1] : null;
      if (verified.ok && atCount && atCount.hash === manifestObj.head) {
        transcript = "matches";
      } else {
        transcript = "mismatch";
        problems.push("local transcript does not match the recorded head");
      }
    }
  }

  return { sha, subject, recorded, manifestOk, diffOk, filesOk, signature, transcript, problems, merge: false };
}

export function verifyRange(root, range) {
  const args = range ? ["log", "--format=%H", range] : ["log", "--format=%H", "-20"];
  const out = git(root, args).trim();
  const shas = out ? out.split("\n").reverse() : [];
  return shas.map((sha) => verifyCommit(root, sha));
}
