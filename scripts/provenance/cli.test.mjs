import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot, readSession, paths } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = repoRoot(HERE);

function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe", ...opts });
}

function cli(root, args, opts = {}) {
  return execFileSync("node", [path.join(root, "scripts", "provenance", "cli.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    ...opts,
  });
}

function hook(root, payload, opts = {}) {
  return execFileSync("node", [path.join(root, "scripts", "provenance", "hook.mjs")], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    input: JSON.stringify(payload),
    ...opts,
  });
}

// Fresh repo with a real copy of this project's provenance scripts and git
// hook shims, so the CLI and hooks behave exactly as they would in a clone.
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provenance-cli-test-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.name", "Test User"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  const scriptsDir = path.join(dir, "scripts", "provenance");
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const file of fs.readdirSync(path.join(PROJECT_ROOT, "scripts", "provenance"))) {
    if (file.endsWith(".test.mjs")) continue;
    fs.copyFileSync(path.join(PROJECT_ROOT, "scripts", "provenance", file), path.join(scriptsDir, file));
  }

  const hooksDir = path.join(dir, ".githooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const file of fs.readdirSync(path.join(PROJECT_ROOT, ".githooks"))) {
    const src = path.join(PROJECT_ROOT, ".githooks", file);
    const dest = path.join(hooksDir, file);
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
  }

  fs.writeFileSync(path.join(dir, "README.md"), "test repo\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "chore: initial commit"]);

  const root = repoRoot(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return root;
}

test("install sets core.hooksPath and is safe to run repeatedly", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);
  cli(root, ["install"]);
  const hooksPath = git(root, ["config", "--local", "core.hooksPath"]).trim();
  assert.equal(hooksPath, ".githooks");

  // Fix round 2: install must also wire up prepare-commit-msg (the third
  // hook, used for reliable amend detection).
  for (const name of ["pre-commit", "prepare-commit-msg", "commit-msg"]) {
    const mode = fs.statSync(path.join(root, ".githooks", name)).mode & 0o777;
    assert.equal(mode, 0o755, `expected ${name} to be executable, got mode ${mode.toString(8)}`);
  }
});

test("install never touches global git config", (t) => {
  const root = makeRepo(t);
  const globalBefore = (() => {
    try {
      return git(root, ["config", "--global", "core.hooksPath"]).trim();
    } catch {
      return null;
    }
  })();
  cli(root, ["install"]);
  const globalAfter = (() => {
    try {
      return git(root, ["config", "--global", "core.hooksPath"]).trim();
    } catch {
      return null;
    }
  })();
  assert.equal(globalAfter, globalBefore);
});

test("a commit with no open session is refused and names the start command", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);
  fs.writeFileSync(path.join(root, "a.txt"), "hello\n");
  git(root, ["add", "a.txt"]);

  assert.throws(
    () => git(root, ["commit", "-q", "-m", "feat: add a"]),
    (err) => {
      assert.equal(err.status, 1);
      assert.match(String(err.stderr), /pnpm provenance start/);
      return true;
    }
  );
});

test("with a session open the commit succeeds and verify reports it recorded and matching", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);
  cli(root, ["start", "add", "a", "file"]);
  cli(root, ["prompt"], { input: "please add a.txt" });

  fs.writeFileSync(path.join(root, "a.txt"), "hello\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "feat: add a.txt"]);

  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  const changedFiles = git(root, ["show", "--name-only", "--format=", sha]).trim().split("\n");
  assert.ok(changedFiles.some((f) => f.startsWith(".provenance/manifests/")));

  const out = cli(root, ["verify", `${sha}~1..${sha}`]);
  const dataLine = out.split("\n").find((l) => l.startsWith(sha.slice(0, 7)));
  assert.ok(dataLine, `expected a row for ${sha.slice(0, 7)} in:\n${out}`);
  assert.match(dataLine, /yes/);
  assert.match(dataLine, /matches/);
});

test("PROVENANCE_SKIP=1 commits without trailers and verify reports it unrecorded", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);

  fs.writeFileSync(path.join(root, "b.txt"), "hi\n");
  git(root, ["add", "b.txt"]);
  git(root, ["commit", "-q", "-m", "chore: skip session"], {
    env: { ...process.env, PROVENANCE_SKIP: "1" },
  });

  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  assert.throws(
    () => cli(root, ["verify", `${sha}~1..${sha}`]),
    (err) => {
      assert.equal(err.status, 1);
      const dataLine = err.stdout.split("\n").find((l) => l.startsWith(sha.slice(0, 7)));
      assert.ok(dataLine, `expected a row for ${sha.slice(0, 7)} in:\n${err.stdout}`);
      assert.match(dataLine, / no /);
      return true;
    }
  );
});

test("verify reports an invalid range as a one-line error with exit 2, not a stack trace", (t) => {
  const root = makeRepo(t);

  assert.throws(
    () => cli(root, ["verify", "not-a-real-range..HEAD"]),
    (err) => {
      assert.equal(err.status, 2);
      assert.doesNotMatch(String(err.stderr), /at TestContext|at Object|\.js:\d+:\d+/, "must not be a stack trace");
      const lines = String(err.stderr).trim().split("\n");
      assert.equal(lines.length, 1, `expected one line, got:\n${err.stderr}`);
      assert.match(lines[0], /invalid range/);
      return true;
    }
  );
});

test("hook.mjs starts a session from the first UserPromptSubmit and records the prompt", (t) => {
  const root = makeRepo(t);
  const out = hook(root, {
    hook_event_name: "UserPromptSubmit",
    prompt: "please refactor the widget loader to be faster and cleaner across the board",
    session_id: "abc123",
    cwd: root,
  });
  assert.equal(out, "");

  const id = fs.readFileSync(paths(root).current, "utf8").trim();
  const entries = readSession(root, id);
  assert.equal(entries[0].type, "start");
  assert.equal(
    entries[0].intent,
    "please refactor the widget loader to be faster and cleaner across the board".slice(0, 120)
  );
  assert.equal(entries[1].type, "prompt");
  assert.equal(entries[1].text, "please refactor the widget loader to be faster and cleaner across the board");
});

test("hook.mjs PostToolUse Edit appends a tool entry with the file path and no input text", (t) => {
  const root = makeRepo(t);
  hook(root, { hook_event_name: "UserPromptSubmit", prompt: "start working", cwd: root });

  const out = hook(root, {
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: "a.txt", old_string: "x", new_string: "y" },
    tool_response: { ok: true },
    cwd: root,
  });
  assert.equal(out, "");

  const id = fs.readFileSync(paths(root).current, "utf8").trim();
  const entries = readSession(root, id);
  const toolEntry = entries.find((e) => e.type === "tool");
  assert.ok(toolEntry, "expected a tool entry");
  assert.deepEqual(toolEntry.files, ["a.txt"]);
  assert.equal(toolEntry.input, undefined);
  assert.equal(toolEntry.text, undefined);
  assert.ok(toolEntry.inputHash);
});

// I1: exit code must be driven by `problems`, not only the four booleans.
// A transcript mismatch alone (session truncated locally after a
// perfectly good commit) must still fail `verify`.
test("verify exits 1 on a transcript-only problem even when the four booleans are true", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);
  cli(root, ["start", "add", "a", "file"]);
  cli(root, ["prompt"], { input: "please add a.txt" });

  fs.writeFileSync(path.join(root, "a.txt"), "hello\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "feat: add a.txt"]);
  const sha = git(root, ["rev-parse", "HEAD"]).trim();

  const id = fs.readFileSync(paths(root).current, "utf8").trim();
  const sessionFile = path.join(paths(root).sessions, `${id}.jsonl`);
  const lines = fs.readFileSync(sessionFile, "utf8").trim().split("\n");
  assert.ok(lines.length >= 2);
  fs.writeFileSync(sessionFile, `${lines.slice(0, lines.length - 1).join("\n")}\n`, "utf8");

  assert.throws(
    () => cli(root, ["verify", `${sha}~1..${sha}`]),
    (err) => {
      assert.equal(err.status, 1);
      return true;
    }
  );
});

// I2: `git commit --amend --no-edit` starts from the PREVIOUS full message,
// old trailers included. The amended commit must end with exactly one set
// of (fresh) trailers, and must verify cleanly.
test("amending a provenance commit refreshes its trailers instead of duplicating them", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);
  cli(root, ["start", "add and then amend a file"]);
  cli(root, ["prompt"], { input: "please add a.txt" });

  fs.writeFileSync(path.join(root, "a.txt"), "hello\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "feat: add a.txt"]);

  cli(root, ["note", "actually let me fix a typo"]);
  fs.writeFileSync(path.join(root, "a.txt"), "hello world\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "--amend", "--no-edit"]);

  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  const message = git(root, ["log", "-1", "--format=%B", sha]);
  const manifestLines = message.split("\n").filter((l) => l.startsWith("Provenance-Manifest:"));
  assert.equal(manifestLines.length, 1, `expected exactly one manifest trailer, got:\n${message}`);

  const out = cli(root, ["verify", `${sha}~1..${sha}`]);
  const dataLine = out.split("\n").find((l) => l.startsWith(sha.slice(0, 7)));
  assert.ok(dataLine, `expected a row for ${sha.slice(0, 7)} in:\n${out}`);
  assert.match(dataLine, /yes/);
  // Fix round 2: manifest/diff/files must all read ok, not merely "recorded".
  assert.match(dataLine, /yes\s+\|\s+ok\s+\|\s+ok\s+\|\s+ok\s+\|/, `expected all-ok row, got:\n${dataLine}`);
});

// Fix round 2 (I2 regression): a commit whose MESSAGE happens to mention
// "--amend" is not an amend. The pre-fix ps-based detection substring-
// matched the parent process's command line, so `git commit -m "docs:
// explain the --amend flag"` (the literal flag text living inside a -m
// value) was misread as an amend and its diff base was wrongly shifted,
// permanently failing MANIFEST/DIFF/FILES.
test("an ordinary commit whose message contains --amend verifies ok", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);
  cli(root, ["start", "explain the amend flag"]);

  fs.writeFileSync(path.join(root, "a.txt"), "docs\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "docs: explain the --amend flag"]);

  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  const out = cli(root, ["verify", `${sha}~1..${sha}`]);
  const dataLine = out.split("\n").find((l) => l.startsWith(sha.slice(0, 7)));
  assert.ok(dataLine, `expected a row for ${sha.slice(0, 7)} in:\n${out}`);
  assert.match(dataLine, /yes\s+\|\s+ok\s+\|\s+ok\s+\|\s+ok\s+\|/, `expected all-ok row, got:\n${dataLine}`);
});

// Fix round 2: a commit created by `git cherry-pick` with no session open.
// git does not run the pre-commit hook at all for cherry-pick's (or plain
// rebase's) own replay mechanism -- confirmed directly: a pre-commit hook
// that unconditionally exits 1 still lets a cherry-pick through. Since
// precommit.mjs is the only thing that can refuse or record a commit, and
// it never runs here, the honest, correct outcome is the same as
// PROVENANCE_SKIP=1: the commit lands, carries no trailers, and `verify`
// reports it plainly as unrecorded -- never a false "ok".
test("a cherry-picked commit with no session lands unrecorded, never falsely ok", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);

  git(root, ["checkout", "-q", "-b", "feature"]);
  fs.writeFileSync(path.join(root, "feature.txt"), "feature work\n");
  git(root, ["add", "feature.txt"]);
  git(root, ["commit", "-q", "-m", "feat: feature work", "--no-verify"]);
  const featureSha = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["checkout", "-q", "-"]);

  git(root, ["cherry-pick", featureSha]);
  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  const message = git(root, ["log", "-1", "--format=%B", sha]);
  assert.ok(!message.includes("Provenance-Manifest:"), "a cherry-picked commit must carry no trailers");

  assert.throws(
    () => cli(root, ["verify", `${sha}~1..${sha}`]),
    (err) => {
      assert.equal(err.status, 1);
      const dataLine = err.stdout.split("\n").find((l) => l.startsWith(sha.slice(0, 7)));
      assert.ok(dataLine, `expected a row for ${sha.slice(0, 7)} in:\n${err.stdout}`);
      assert.match(dataLine, / no /, "must read as unrecorded, not silently ok");
      return true;
    }
  );
});

// Fix round 2: a commit created via `git rebase --exec "<a real git commit
// command>"` with no session open. Unlike rebase's own replay of existing
// commits (which never runs pre-commit at all, see the cherry-pick test
// above), --exec spawns the given command as an ordinary subprocess; when
// that command is itself `git commit`, it goes through the normal hook
// sequence, so precommit.mjs correctly refuses it, which pauses the
// rebase exactly as a conflict would.
test("a git commit run via rebase --exec with no session is refused, pausing the rebase", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);

  fs.writeFileSync(path.join(root, "base.txt"), "base\n");
  git(root, ["add", "base.txt"]);
  git(root, ["commit", "-q", "-m", "chore: base", "--no-verify"]);

  assert.throws(
    () =>
      // HEAD~1 (makeRepo's own initial commit): rebasing onto it replays
      // "chore: base" and runs --exec once. Rebasing onto HEAD itself
      // would replay nothing, and --exec would never run at all.
      git(root, [
        "rebase",
        "HEAD~1",
        "--exec",
        "touch execfile.txt && git add execfile.txt && git commit -m 'exec commit'",
      ]),
    (err) => {
      assert.match(String(err.stdout) + String(err.stderr), /pnpm provenance start|no session is open/);
      return true;
    }
  );

  // The rebase must be left paused (mid-rebase), not silently past the
  // refused commit; abort cleanly so the temp repo teardown is not left
  // in a half-rebased state.
  const rebaseInProgress = fs.existsSync(path.join(root, ".git", "rebase-merge"));
  assert.equal(rebaseInProgress, true, "the refused commit must leave the rebase paused, not silently continue");
  git(root, ["rebase", "--abort"]);
});

// I3: a pending file left over from an aborted commit attempt (precommit
// ran and staged a manifest, but the commit never happened) must not
// stamp trailers onto a later, unrelated PROVENANCE_SKIP=1 commit.
test("a stale pending file from an aborted commit does not stamp a later skip commit", (t) => {
  const root = makeRepo(t);
  cli(root, ["install"]);
  cli(root, ["start", "add a file that never gets committed"]);

  fs.writeFileSync(path.join(root, "aborted.txt"), "never committed\n");
  git(root, ["add", "aborted.txt"]);

  // Simulate an aborted commit: run the pre-commit hook directly, exactly
  // as git would right before opening the message editor, without ever
  // actually creating the commit. This leaves .provenance/pending on disk
  // exactly as an editor-cancelled `git commit` would.
  execFileSync("node", [path.join(root, "scripts", "provenance", "precommit.mjs")], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  const pendingFile = path.join(root, ".provenance", "pending");
  assert.ok(fs.existsSync(pendingFile), "expected the aborted attempt to leave a stale pending file");

  git(root, ["reset", "aborted.txt"]);
  fs.rmSync(path.join(root, "aborted.txt"));
  cli(root, ["end"]);

  fs.writeFileSync(path.join(root, "real.txt"), "actually committed\n");
  git(root, ["add", "real.txt"]);
  git(root, ["commit", "-q", "-m", "chore: real skip commit"], {
    env: { ...process.env, PROVENANCE_SKIP: "1" },
  });

  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  const message = git(root, ["log", "-1", "--format=%B", sha]);
  assert.ok(!message.includes("Provenance-Manifest:"), "the stale pending must not stamp this commit");
  assert.equal(fs.existsSync(pendingFile), false, "the skip path must clear the stale pending file");
});

// M1: a payload whose cwd resolves to a different repository must be
// ignored (and logged), never acted on -- this hook trusts its own file
// location for identity, not a payload field.
test("hook.mjs ignores a payload whose cwd resolves to a different repository", (t) => {
  const root = makeRepo(t);
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "provenance-other-repo-"));
  git(otherDir, ["init", "-q"]);
  git(otherDir, ["config", "user.name", "Test User"]);
  git(otherDir, ["config", "user.email", "test@example.com"]);
  t.after(() => fs.rmSync(otherDir, { recursive: true, force: true }));
  const otherRoot = repoRoot(otherDir);

  const out = hook(root, {
    hook_event_name: "UserPromptSubmit",
    prompt: "this claims to be in a different repo",
    cwd: otherRoot,
  });
  assert.equal(out, "");

  assert.equal(fs.existsSync(paths(root).current), false, "no session should start in this hook's own repo");
  const logPath = path.join(paths(root).dir, "hook.log");
  assert.ok(fs.existsSync(logPath), "expected hook.log to record the mismatch");
  const log = fs.readFileSync(logPath, "utf8");
  assert.match(log, /different repository|resolves to/i);
});

test("hook.mjs ignores unrecognised PostToolUse tools and still exits cleanly", (t) => {
  const root = makeRepo(t);
  const out = hook(root, {
    hook_event_name: "PostToolUse",
    tool_name: "Glob",
    tool_input: { pattern: "**/*.ts" },
    tool_response: {},
    cwd: root,
  });
  assert.equal(out, "");
  // A session was still started (tool event with no prior session), but no
  // tool entry should have been appended for an ignored tool.
  const id = fs.readFileSync(paths(root).current, "utf8").trim();
  const entries = readSession(root, id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "start");
});
