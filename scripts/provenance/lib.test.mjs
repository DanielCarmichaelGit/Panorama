import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  sha256,
  canonical,
  repoRoot,
  paths,
  startSession,
  appendEntry,
  readSession,
  verifySession,
  stagedDiff,
  commitDiff,
  writeManifest,
  parseTrailers,
  verifyCommit,
} from "./lib.mjs";

function git(root, args) {
  // Stderr piped (not inherited): git and gpg both write routine chatter
  // there (trustdb checks, "fatal:" on an expected failure we catch), and
  // it must not leak into the test run's own output.
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provenance-test-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.name", "Test User"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  const root = repoRoot(dir);
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return root;
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function commitFile(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

// Writes a manifest for the session's current state, stages it, builds a
// commit message with the three trailers, and commits. Split out from
// recordAndCommit so a test can drive several commits through one session.
let msgCounter = 0;
function commitSessionState(root, id, { subject = "chore: commit", corruptDiffTrailer = false } = {}) {
  const { diff, files } = stagedDiff(root);
  const diffHash = sha256(diff);

  appendEntry(root, id, { type: "commit", diffHash, files });

  const entries = readSession(root, id);
  const verified = verifySession(entries);
  assert.equal(verified.ok, true, "session should verify before commit");

  const start = entries[0];
  const manifest = {
    sessionId: id,
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
  git(root, ["add", manifestPath]);

  const trailerDiffHash = corruptDiffTrailer ? "0".repeat(64) : diffHash;
  const message = [
    subject,
    "",
    `Provenance-Manifest: sha256:${manifestHash} ${manifestPath}`,
    `Provenance-Head: sha256:${verified.head}`,
    `Provenance-Diff: sha256:${trailerDiffHash}`,
    "",
  ].join("\n");

  git(root, ["add", "-A"]);
  msgCounter += 1;
  const msgFile = path.join(root, ".git", `COMMIT_EDITMSG_TEST_${msgCounter}`);
  fs.writeFileSync(msgFile, message, "utf8");
  git(root, ["commit", "-q", "-F", msgFile]);
  fs.rmSync(msgFile, { force: true });

  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  return { sha, id, manifestPath, manifestHash, diffHash, head: verified.head, count: verified.count, files };
}

// Full pipeline used by several tests: start a session, prompt, tool, edit a
// file, stage it, commit with trailers built from the library helpers.
function recordAndCommit(root, { subject = "feat: add a.txt", corruptDiffTrailer = false } = {}) {
  const { id } = startSession(root, { actor: "tester", tool: "cli", intent: "add a file" });
  appendEntry(root, id, { type: "prompt", text: "please add a.txt" });
  appendEntry(root, id, {
    type: "tool",
    tool: "Write",
    input: { file_path: "a.txt", content: "hello" },
    files: ["a.txt"],
  });

  writeFile(root, "a.txt", "hello\n");
  git(root, ["add", "a.txt"]);

  return commitSessionState(root, id, { subject, corruptDiffTrailer });
}

test("canonical sorts keys at every depth", () => {
  const a = canonical({ b: 1, a: { d: 2, c: 3 } });
  const b = canonical({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
});

test("canonical drops undefined values", () => {
  assert.equal(canonical({ a: 1, b: undefined }), '{"a":1}');
});

test("sha256 is deterministic hex", () => {
  const h = sha256("hello");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, sha256("hello"));
});

test("a session of start, prompt, tool verifies", (t) => {
  const root = makeRepo(t);
  const { id } = startSession(root, { actor: "tester", tool: "cli", intent: "do a thing" });
  appendEntry(root, id, { type: "prompt", text: "hello there" });
  appendEntry(root, id, { type: "tool", tool: "Edit", input: { file_path: "x.txt" }, files: ["x.txt"] });

  const entries = readSession(root, id);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].type, "start");
  assert.equal(entries[1].type, "prompt");
  assert.equal(entries[1].text, "hello there");
  assert.equal(entries[2].type, "tool");
  assert.equal(entries[2].input, undefined, "raw tool input must never be stored");
  assert.ok(entries[2].inputHash);

  const verified = verifySession(entries);
  assert.equal(verified.ok, true);
  assert.equal(verified.count, 3);
  assert.equal(verified.head, entries[2].hash);
});

// M3: a caller cannot smuggle its own seq/ts/prev through `fields` (a
// "note" or "commit" entry spreads its rest fields close to verbatim) and
// shift the chain out from under appendEntry's own bookkeeping.
test("appendEntry ignores a caller-supplied seq, ts, or prev", (t) => {
  const root = makeRepo(t);
  const { id, entry: start } = startSession(root, { actor: "tester", tool: "cli", intent: "do a thing" });

  const entry = appendEntry(root, id, {
    type: "note",
    text: "hello",
    seq: 999,
    ts: "1999-01-01T00:00:00.000Z",
    prev: "f".repeat(64),
  });

  assert.equal(entry.seq, 2, "seq must be the library's own next value, not the caller's 999");
  assert.equal(entry.prev, start.hash, "prev must be the real previous hash, not the caller's forgery");
  assert.notEqual(entry.ts, "1999-01-01T00:00:00.000Z");

  const verified = verifySession(readSession(root, id));
  assert.equal(verified.ok, true, "the chain must still verify");
  assert.equal(verified.count, 2);
});

// A caller-supplied `hash` was not protected by appendEntry's field order
// (only seq/ts/prev were): entryData itself must drop it, for every entry
// type that passes fields through close to verbatim ("note", "commit",
// "end"). Left unhandled, a forged `hash` field leaks into the content
// that gets hashed at write time but is stripped by destructuring before
// verifySession recomputes it at read time -- an asymmetry that made the
// chain always look broken rather than cleanly rejecting the bad input.
test("appendEntry drops a caller-supplied hash for every pass-through entry type", (t) => {
  const root = makeRepo(t);
  const { id } = startSession(root, { actor: "tester", tool: "cli", intent: "do a thing" });

  appendEntry(root, id, { type: "note", text: "one", hash: "forged-note".padEnd(64, "0") });
  appendEntry(root, id, { type: "commit", diffHash: "a".repeat(64), files: [], hash: "forged-commit".padEnd(64, "0") });
  appendEntry(root, id, { type: "end", hash: "forged-end".padEnd(64, "0") });

  const entries = readSession(root, id);
  assert.equal(entries.length, 4);
  for (const e of entries.slice(1)) {
    assert.doesNotMatch(e.hash, /forged/, "no forged hash should ever appear as the stored hash");
  }

  const verified = verifySession(entries);
  assert.equal(verified.ok, true, `chain should verify cleanly; got: ${JSON.stringify(verified)}`);
  assert.equal(verified.count, 4);
});

test("a tampered entry breaks verification at its seq", (t) => {
  const root = makeRepo(t);
  const { id } = startSession(root, { actor: "tester", tool: "cli", intent: "do a thing" });
  appendEntry(root, id, { type: "prompt", text: "hello there" });
  appendEntry(root, id, { type: "tool", tool: "Edit", input: { file_path: "x.txt" }, files: ["x.txt"] });

  const entries = readSession(root, id);
  entries[1].text = "tampered text";

  const verified = verifySession(entries);
  assert.equal(verified.ok, false);
  assert.equal(verified.brokenAt, 2);
});

test("stagedDiff ignores .provenance", (t) => {
  const root = makeRepo(t);
  writeFile(root, "tracked.txt", "hello\n");
  writeFile(root, ".provenance/manifests/whatever.json", "{}");
  git(root, ["add", "-A"]);

  const { diff, files } = stagedDiff(root);
  assert.ok(diff.includes("tracked.txt"));
  assert.ok(!diff.includes(".provenance"));
  assert.deepEqual(files, ["tracked.txt"]);
});

// Fix round 2: commitDiff accepts an explicit base instead of always
// deriving the parent from sha itself. verifyCommit uses this once a
// manifest's own recorded base has been proven, from git history, to be
// either sha's real parent or a sibling of sha (see the fix-round-2
// section of the report for why this exists: only pre-commit's own
// staging affects the tree, so an amend's manifest is written unconditionally
// against whatever HEAD was, not against a detected "real" parent).
test("commitDiff diffs against an explicit base instead of sha's real parent", (t) => {
  const root = makeRepo(t);
  writeFile(root, "a.txt", "one\n");
  const firstSha = commitFile(root, "chore: first");

  writeFile(root, "a.txt", "two\n");
  const secondSha = commitFile(root, "chore: second");

  const againstRealParent = commitDiff(root, secondSha);
  assert.ok(againstRealParent.diff.includes("-one"));
  assert.ok(againstRealParent.diff.includes("+two"));

  const againstFirst = commitDiff(root, secondSha, firstSha);
  assert.ok(againstFirst.diff.includes("-one"));
  assert.ok(againstFirst.diff.includes("+two"));
  // Same result here since firstSha IS secondSha's real parent; the two
  // calls diverge only when an explicit base differs from the real parent
  // (the sibling/amend case), covered end to end in cli.test.mjs.
  assert.equal(againstRealParent.diff, againstFirst.diff);
});

// The C1-style binding a manifest.base must satisfy: an unrelated commit
// (no parent/child/sibling relationship to sha at all) must not be
// accepted as a diff base, however the manifest tries to hash together
// with it -- otherwise a fabricated base could make an unrelated,
// possibly much larger real diff read as small and innocuous.
test("verifyCommit rejects a manifest whose base is unrelated to the commit", (t) => {
  const root = makeRepo(t);
  recordAndCommit(root); // establishes an initial commit to branch the orphan off from
  const mainBranch = git(root, ["branch", "--show-current"]).trim();

  // An entirely separate, unrelated commit, sharing no history with the
  // session's commits at all.
  git(root, ["checkout", "-q", "--orphan", "unrelated"]);
  writeFile(root, "z.txt", "nothing to do with this session\n");
  const unrelatedSha = commitFile(root, "chore: unrelated orphan commit");
  git(root, ["checkout", "-q", mainBranch]);

  const { id } = startSession(root, { actor: "tester", tool: "cli", intent: "second file" });
  appendEntry(root, id, { type: "prompt", text: "add b.txt" });
  writeFile(root, "b.txt", "hello\n");
  git(root, ["add", "b.txt"]);
  const { diff, files } = stagedDiff(root);
  const diffHash = sha256(diff);
  appendEntry(root, id, { type: "commit", diffHash, files });
  const entries = readSession(root, id);
  const verified = verifySession(entries);

  // Craft a manifest that claims the unrelated orphan commit as its base.
  const manifest = {
    sessionId: id,
    actor: "tester",
    tool: "cli",
    intent: "second file",
    head: verified.head,
    count: verified.count,
    diffHash,
    files,
    base: unrelatedSha,
    ts: new Date().toISOString(),
  };
  const { path: manifestPath, hash: manifestHash } = writeManifest(root, manifest);
  git(root, ["add", manifestPath]);
  const message = [
    "feat: add b.txt",
    "",
    `Provenance-Manifest: sha256:${manifestHash} ${manifestPath}`,
    `Provenance-Head: sha256:${verified.head}`,
    `Provenance-Diff: sha256:${diffHash}`,
    "",
  ].join("\n");
  const msgFile = path.join(root, ".git", "COMMIT_EDITMSG_UNRELATED_BASE");
  fs.writeFileSync(msgFile, message, "utf8");
  git(root, ["commit", "-q", "-F", msgFile]);
  fs.rmSync(msgFile, { force: true });

  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  const report = verifyCommit(root, sha);
  assert.equal(report.manifestOk, false);
  assert.ok(report.problems.some((p) => p.includes("base")), `expected a base problem, got: ${report.problems}`);
});

test("writeManifest hash is stable across key order", (t) => {
  const root = makeRepo(t);
  const base = {
    sessionId: "s_20260101T000000_abcdef",
    actor: "tester",
    tool: "cli",
    intent: "do a thing",
    head: "a".repeat(64),
    count: 3,
    diffHash: "b".repeat(64),
    files: ["a.txt", "b.txt"],
    ts: "2026-01-01T00:00:00.000Z",
  };
  const reordered = {
    ts: base.ts,
    files: base.files,
    diffHash: base.diffHash,
    count: base.count,
    head: base.head,
    intent: base.intent,
    tool: base.tool,
    actor: base.actor,
    sessionId: base.sessionId,
  };

  const h1 = writeManifest(root, base).hash;
  const h2 = writeManifest(root, reordered).hash;
  assert.equal(h1, h2);
});

test("verifyCommit reports recorded, manifestOk, diffOk, filesOk, transcript matches", (t) => {
  const root = makeRepo(t);
  const { sha } = recordAndCommit(root);

  const report = verifyCommit(root, sha);
  assert.equal(report.recorded, true);
  assert.equal(report.manifestOk, true);
  assert.equal(report.diffOk, true);
  assert.equal(report.filesOk, true);
  assert.equal(report.transcript, "matches");
  assert.equal(report.problems.length, 0);
});

test("earlier commit still verifies after the manifest file is edited later", (t) => {
  const root = makeRepo(t);
  const { sha, manifestPath } = recordAndCommit(root);

  // Corrupt the manifest file in a later commit; the earlier commit's
  // manifest must be read from the commit tree, not the working tree.
  const fullPath = path.join(root, manifestPath);
  const original = fs.readFileSync(fullPath, "utf8");
  fs.writeFileSync(fullPath, original.replace("tester", "someone-else"), "utf8");
  commitFile(root, "chore: corrupt manifest on purpose");

  const report = verifyCommit(root, sha);
  assert.equal(report.recorded, true);
  assert.equal(report.manifestOk, true);
  assert.equal(report.diffOk, true);
  assert.equal(report.filesOk, true);
});

test("a commit without trailers reports recorded: false", (t) => {
  const root = makeRepo(t);
  writeFile(root, "plain.txt", "no provenance here\n");
  const sha = commitFile(root, "chore: plain commit with no session");

  const report = verifyCommit(root, sha);
  assert.equal(report.recorded, false);
  assert.ok(report.problems.length > 0);
});

test("deleting the local session file gives transcript: unavailable", (t) => {
  const root = makeRepo(t);
  const { sha, id } = recordAndCommit(root);

  const { sessions } = paths(root);
  fs.rmSync(path.join(sessions, `${id}.jsonl`), { force: true });

  const report = verifyCommit(root, sha);
  assert.equal(report.transcript, "unavailable");
});

test("a diff hash mismatch is reported when the trailer is altered", (t) => {
  const root = makeRepo(t);
  const { sha } = recordAndCommit(root, { corruptDiffTrailer: true });

  const report = verifyCommit(root, sha);
  assert.equal(report.diffOk, false);
  assert.ok(report.problems.some((p) => p.toLowerCase().includes("diff")));
});

// C1: a fraudulent commit reuses an earlier commit's manifest (still
// present, unchanged, in the tree) instead of writing its own, and forges
// a genuinely correct Provenance-Diff for its own real change. Nothing
// about the reused manifest's own hash is wrong, so the pre-fix checks
// (recorded, the old manifestOk, diffOk, filesOk) all pass; only binding
// the manifest to *this* commit catches it.
test("verifyCommit rejects a commit that reuses an earlier commit's manifest", (t) => {
  const root = makeRepo(t);
  const first = recordAndCommit(root); // writes a.txt, manifest M1, commit 1

  // A second, session-less commit edits the same file (so the file list
  // still lines up with M1's) and points its trailers at M1 verbatim,
  // except for a Provenance-Diff that is honestly computed for this new
  // commit's real diff.
  writeFile(root, "a.txt", "hello again\n");
  git(root, ["add", "a.txt"]);
  const { diff } = stagedDiff(root);
  const diffHash = sha256(diff);

  const message = [
    "feat: sneak in a change",
    "",
    `Provenance-Manifest: sha256:${first.manifestHash} ${first.manifestPath}`,
    `Provenance-Head: sha256:${first.head}`,
    `Provenance-Diff: sha256:${diffHash}`,
    "",
  ].join("\n");
  const msgFile = path.join(root, ".git", "COMMIT_EDITMSG_REUSE");
  fs.writeFileSync(msgFile, message, "utf8");
  git(root, ["commit", "-q", "-F", msgFile]);
  fs.rmSync(msgFile, { force: true });

  const sha2 = git(root, ["rev-parse", "HEAD"]).trim();
  const report = verifyCommit(root, sha2);

  assert.equal(report.manifestOk, false, "a reused manifest must not read as ok");
  assert.ok(report.problems.length > 0, "the reuse probe must report problems");
});

// C2: a session that produces two commits must have BOTH verify as
// "matches", not just the last one (the transcript check must compare the
// entry at the manifest's own count, not the session's current head).
test("two commits from one session both verify transcript matches", (t) => {
  const root = makeRepo(t);
  const first = recordAndCommit(root, { subject: "feat: add a.txt" });

  appendEntry(root, first.id, { type: "prompt", text: "now add b.txt" });
  appendEntry(root, first.id, {
    type: "tool",
    tool: "Write",
    input: { file_path: "b.txt", content: "world" },
    files: ["b.txt"],
  });
  writeFile(root, "b.txt", "world\n");
  git(root, ["add", "b.txt"]);
  const second = commitSessionState(root, first.id, { subject: "feat: add b.txt" });

  const report1 = verifyCommit(root, first.sha);
  const report2 = verifyCommit(root, second.sha);

  assert.equal(report1.transcript, "matches", `commit 1 problems: ${report1.problems.join(", ")}`);
  assert.equal(report2.transcript, "matches", `commit 2 problems: ${report2.problems.join(", ")}`);
});

// C2: a session file truncated below what its manifest claims must never
// read as "matches" (verifySession alone can't catch this: a truncated
// prefix can still be an internally self-consistent chain).
test("a session file truncated below the manifest's count never verifies as matches", (t) => {
  const root = makeRepo(t);
  const { sha, id } = recordAndCommit(root);

  const { sessions } = paths(root);
  const file = path.join(sessions, `${id}.jsonl`);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.ok(lines.length >= 2, "need at least two entries to truncate meaningfully");
  fs.writeFileSync(file, `${lines.slice(0, lines.length - 1).join("\n")}\n`, "utf8");

  const report = verifyCommit(root, sha);
  assert.notEqual(report.transcript, "matches");
  assert.ok(["mismatch", "unavailable"].includes(report.transcript));
});

// C2: verifySession must reject a non-monotonic seq even when every entry
// is otherwise perfectly self-consistent (correct prev linkage, correct
// hash for its own content) -- a forged chain that skips an entry can
// still pass a check that only looks at hash and prev linkage.
test("verifySession rejects a non-monotonic seq in an otherwise consistent chain", () => {
  const startEntry = {
    seq: 1,
    type: "start",
    ts: "2026-01-01T00:00:00.000Z",
    actor: "a",
    tool: "t",
    intent: "i",
    prev: "0".repeat(64),
  };
  const start = { ...startEntry, hash: sha256(startEntry.prev + canonical(startEntry)) };

  // Jumps straight to seq 3, skipping seq 2, but is otherwise consistent:
  // its own hash is correctly computed and its prev correctly points at
  // the previous entry's hash.
  const skipEntry = { seq: 3, type: "note", ts: "2026-01-01T00:00:01.000Z", text: "x", prev: start.hash };
  const skip = { ...skipEntry, hash: sha256(skipEntry.prev + canonical(skipEntry)) };

  const verified = verifySession([start, skip]);
  assert.equal(verified.ok, false);
  assert.equal(verified.brokenAt, 3);
});

// I5: a real merge commit (two divergent branches, no fast-forward) never
// carries a manifest -- nobody wrote one for "merge these two branches" --
// and must not be treated as an ordinary unrecorded commit.
test("verifyCommit reports a merge commit as its own state, not recorded or failed", (t) => {
  const root = makeRepo(t);
  writeFile(root, "base.txt", "base\n");
  commitFile(root, "chore: base commit");

  git(root, ["checkout", "-q", "-b", "feature"]);
  writeFile(root, "feature.txt", "feature\n");
  commitFile(root, "chore: feature commit");

  git(root, ["checkout", "-q", "-"]);
  writeFile(root, "main.txt", "main\n");
  commitFile(root, "chore: main commit");

  git(root, ["merge", "-q", "--no-ff", "-m", "Merge branch 'feature'", "feature"]);
  const mergeSha = git(root, ["rev-parse", "HEAD"]).trim();

  const report = verifyCommit(root, mergeSha);
  assert.equal(report.merge, true);
  assert.equal(report.recorded, null);
  assert.equal(report.transcript, "merge");
  assert.equal(report.problems.length, 0, `expected no problems, got: ${report.problems.join(", ")}`);
});

function hasGpg() {
  try {
    execFileSync("gpg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// I1: a cryptographically bad signature ("B", not merely unsigned) must be
// a problem in its own right so `verify` fails on it, independent of the
// four provenance booleans. Built by signing a real commit for real, then
// rebuilding a commit object that reuses that exact signature over
// DIFFERENT content -- the one reliable way to produce git's own "B"
// verdict rather than "N" (no signature) or "E" (can't check, no key).
test(
  "verifyCommit flags a cryptographically bad signature as a problem",
  { skip: hasGpg() ? false : "gpg is not installed" },
  (t) => {
    const root = makeRepo(t);
    const gnupgHome = fs.mkdtempSync(path.join(os.tmpdir(), "provenance-gnupg-"));
    fs.chmodSync(gnupgHome, 0o700);
    const savedGnupgHome = process.env.GNUPGHOME;
    process.env.GNUPGHOME = gnupgHome;
    t.after(() => {
      try {
        execFileSync("gpgconf", ["--homedir", gnupgHome, "--kill", "gpg-agent"], { stdio: "ignore" });
      } catch {
        // best effort
      }
      if (savedGnupgHome === undefined) delete process.env.GNUPGHOME;
      else process.env.GNUPGHOME = savedGnupgHome;
      fs.rmSync(gnupgHome, { recursive: true, force: true });
    });

    execFileSync(
      "gpg",
      ["--batch", "--quick-generate-key", "--passphrase", "", "Test Signer <signer@example.com>", "default", "default"],
      { stdio: "ignore" }
    );
    const keyListing = execFileSync("gpg", ["--list-secret-keys", "--with-colons"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const keyId = keyListing.split("\n").find((l) => l.startsWith("sec:")).split(":")[4];

    git(root, ["config", "user.signingkey", keyId]);
    git(root, ["config", "gpg.program", "gpg"]);

    writeFile(root, "a.txt", "hi\n");
    git(root, ["add", "a.txt"]);
    execFileSync("git", ["-c", "commit.gpgsign=true", "commit", "-q", "-S", "-m", "signed commit"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"], // gpg writes trustdb chatter to stderr; keep output pristine
    });
    const sha = git(root, ["rev-parse", "HEAD"]).trim();
    assert.equal(git(root, ["log", "-1", "--format=%G?", sha]).trim(), "G", "setup: the real commit should verify");

    const raw = git(root, ["cat-file", "-p", sha]);
    const lines = raw.split("\n");
    const authorLine = lines.find((l) => l.startsWith("author "));
    const committerLine = lines.find((l) => l.startsWith("committer "));
    const sigStart = lines.findIndex((l) => l.startsWith("gpgsig"));
    const sigEnd = lines.findIndex((l) => l.includes("END PGP SIGNATURE"));
    const gpgsigBlock = lines.slice(sigStart, sigEnd + 1).join("\n");

    writeFile(root, "b.txt", "different content entirely\n");
    git(root, ["add", "b.txt"]);
    const tamperedTree = git(root, ["write-tree"]).trim();

    const tamperedObj = [
      `tree ${tamperedTree}`,
      authorLine,
      committerLine,
      gpgsigBlock,
      "",
      "tampered commit, reused signature",
      "",
    ].join("\n");
    const badSha = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
      cwd: root,
      encoding: "utf8",
      input: tamperedObj,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    assert.equal(
      git(root, ["log", "-1", "--format=%G?", badSha]).trim(),
      "B",
      "setup: the tampered commit's signature should fail verification"
    );

    const report = verifyCommit(root, badSha);
    assert.equal(report.signature, "bad");
    assert.ok(report.problems.some((p) => p.toLowerCase().includes("signature")));
  }
);

test("parseTrailers extracts all three trailers", () => {
  const message = [
    "feat: something",
    "",
    "Provenance-Manifest: sha256:" + "a".repeat(64) + " .provenance/manifests/s_x-1.json",
    "Provenance-Head: sha256:" + "b".repeat(64),
    "Provenance-Diff: sha256:" + "c".repeat(64),
    "",
  ].join("\n");
  const trailers = parseTrailers(message);
  assert.equal(trailers.manifest.hash, "a".repeat(64));
  assert.equal(trailers.manifest.path, ".provenance/manifests/s_x-1.json");
  assert.equal(trailers.head, "b".repeat(64));
  assert.equal(trailers.diff, "c".repeat(64));
});
