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
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
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

  const { diff, files } = stagedDiff(root);
  const diffHash = sha256(diff);

  appendEntry(root, id, { type: "commit", diffHash, files });

  const entries = readSession(root, id);
  const verified = verifySession(entries);
  assert.equal(verified.ok, true, "session should verify before commit");

  const manifest = {
    sessionId: id,
    actor: "tester",
    tool: "cli",
    intent: "add a file",
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
  const msgFile = path.join(root, ".git", "COMMIT_EDITMSG_TEST");
  fs.writeFileSync(msgFile, message, "utf8");
  git(root, ["commit", "-q", "-F", msgFile]);
  fs.rmSync(msgFile, { force: true });

  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  return { sha, id, manifestPath, manifestHash, diffHash, head: verified.head, files };
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
