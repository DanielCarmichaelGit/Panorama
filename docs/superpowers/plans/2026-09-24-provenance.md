# Contribution Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every commit to Panorama carries a hash-bound record of the session that produced it, captured automatically in Claude Code and by CLI elsewhere, enforced by git hooks, verifiable offline, with a repository skill that states the working contract.

**Architecture:** Plain Node 22 ES modules under `scripts/provenance/` with no dependencies beyond `node:` built-ins and git. A library module does hashing, session files, manifests, and verification; a CLI, a Claude Code hook adapter, and two git hooks call it. Tests use `node:test`.

**Tech Stack:** Node 22 (`node:crypto`, `node:fs`, `node:child_process`, `node:test`), git 2.40+.

**Spec:** `docs/superpowers/specs/2026-09-24-provenance-design.md`.

## Global Constraints

- No new dependencies. Files are ES modules (`.mjs`). Works on macOS and Linux; paths through `node:path`.
- `.provenance/sessions/` and `.provenance/current` are git-ignored; `.provenance/manifests/` is committed. `.claude/settings.json` and `.claude/skills/` are committed; `.claude/launch.json` stays ignored (adjust `.gitignore` from `.claude` to `.claude/*` plus negations).
- Hashes are hex sha256. Canonical JSON: keys sorted at every depth, no whitespace, `undefined` dropped (same rule as `packages/core/src/canonical.ts`, reimplemented here to avoid importing TypeScript).
- No prompt text or tool output ever enters a committed file. Manifests carry hashes and file paths only.
- No em dashes and no en dashes anywhere. Conventional commits ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Branch `provenance`.
- Do not touch anything under `apps/`, `packages/`, or the milestone 2 plan; another branch is active there.

## File Structure

```
scripts/provenance/lib.mjs        sha256, canonical, repoRoot, session read/append, manifest write/read, staged diff hash, verify
scripts/provenance/cli.mjs        pnpm provenance <start|note|prompt|tool|status|end|install|verify>
scripts/provenance/hook.mjs       Claude Code hook adapter (stdin JSON)
scripts/provenance/precommit.mjs  git pre-commit: require session, write and stage manifest
scripts/provenance/commitmsg.mjs  git commit-msg: append trailers
scripts/provenance/lib.test.mjs   node:test
.githooks/pre-commit, .githooks/commit-msg   shell shims calling the two scripts
.claude/settings.json             hooks for UserPromptSubmit and PostToolUse
.claude/skills/contribute/SKILL.md
AGENTS.md
docs/provenance.md
package.json                      scripts: "provenance": "node scripts/provenance/cli.mjs", "test:provenance": "node --test scripts/provenance/"
```

---

### Task 1: Library: hashing, sessions, manifests, verification

**Files:** Create `scripts/provenance/lib.mjs`, `scripts/provenance/lib.test.mjs`; modify `.gitignore`, `package.json`.

**Interfaces (exported from lib.mjs):**
- `sha256(s: string): string`, `canonical(v): string`
- `repoRoot(cwd = process.cwd()): string` (`git rev-parse --show-toplevel`)
- `paths(root)` → `{ dir, sessions, manifests, current }`
- `currentSession(root): string | null`, `setCurrent(root, id | null)`
- `startSession(root, { actor, tool, intent }, now = new Date()): { id, entry }`; id `s_<yyyymmddThhmmss>_<6 hex>`; first entry `{ seq: 1, type: "start", ts, actor, tool, intent, prev: "0".repeat(64), hash }`
- `appendEntry(root, id, fields, now?)`: reads the last line, computes `seq`, `prev`, `hash`; `fields.type` in `prompt | tool | note | commit | end`; for `prompt`, callers pass `{ type: "prompt", text }` and the entry stores `text` locally plus `textHash`; for `tool`, `{ type: "tool", tool, input, files? }` stores `inputHash` and `files`, never the input
- `readSession(root, id): Entry[]`, `verifySession(entries): { ok: true, head, count } | { ok: false, brokenAt }`
- `stagedDiff(root): { diff: string, files: string[] }` (`git diff --cached --no-color -- . ':!.provenance'`; files from `--name-only`)
- `commitDiff(root, sha): { diff, files }` (same exclusion, `sha~1..sha`, root commit handled with the empty tree)
- `writeManifest(root, m): { path, hash }` where `m = { sessionId, actor, tool, intent, head, count, diffHash, files, ts, redactedHead? }`, path `.provenance/manifests/<sessionId>-<count>.json`, content pretty JSON, `hash = sha256(canonical(m))`
- `parseTrailers(message): { manifest?: { hash, path }, head?, diff? }`
- `verifyCommit(root, sha): Report` with fields `sha, subject, recorded, manifestOk, diffOk, filesOk, signature: "signed" | "unsigned" | "unknown-key" | "bad", transcript: "matches" | "mismatch" | "unavailable", problems: string[]`
- `verifyRange(root, range): Report[]`

- [ ] **Step 1: Write the failing tests** in `lib.test.mjs` using a temp git repo per test (`git init`, `user.name`/`user.email` set, `commit.gpgsign false`): canonical sorts keys; a session of start, prompt, tool verifies and a tampered entry breaks at its seq; `stagedDiff` ignores `.provenance/`; `writeManifest` hash is stable across key order; `verifyCommit` on a commit made through the library helpers (`startSession`, `appendEntry`, stage a file, `writeManifest`, commit with trailers) reports `recorded`, `manifestOk`, `diffOk`, `filesOk`, `transcript: "matches"`; after editing the manifest file in a later commit the earlier commit still verifies (manifest read from the commit, not the tree); a commit without trailers reports `recorded: false`; deleting the local session file gives `transcript: "unavailable"`; a diff hash mismatch is reported when the trailer is altered.
- [ ] **Step 2: Run** `node --test scripts/provenance/` and confirm FAIL.
- [ ] **Step 3: Implement** `lib.mjs`. Git through `execFileSync("git", [...], { cwd: root, encoding: "utf8" })`. Signature: `git log -1 --format=%G? <sha>` mapped `G`→signed, `N`→unsigned, `U`/`X`/`Y`/`R`→unknown-key, `B`/`E`→bad.
- [ ] **Step 4: Run tests, expect pass.** Add the two package.json scripts and the `.gitignore` changes (`.provenance/sessions/`, `.provenance/current`, `.claude/*`, `!.claude/settings.json`, `!.claude/skills/`).
- [ ] **Step 5: Commit** `feat(provenance): hash-chained sessions, manifests, verification`

---

### Task 2: CLI, Claude Code hook adapter, git hooks

**Files:** Create `cli.mjs`, `hook.mjs`, `precommit.mjs`, `commitmsg.mjs`, `.githooks/pre-commit`, `.githooks/commit-msg`, `.claude/settings.json`; test `scripts/provenance/cli.test.mjs`.

**Interfaces:**
- `cli.mjs` commands: `start <intent...>` (actor from `git config user.name`, tool from `PROVENANCE_TOOL` or "cli"), `note <text...>`, `prompt` (stdin), `tool <name> [files...]` (input from stdin), `status` (prints current session id, entry count, head, staged files), `end`, `install` (sets `core.hooksPath .githooks`, `chmod +x` the shims, prints what it did), `verify [range]` (table: sha, recorded, manifest, diff, files, signature, transcript; exit 1 when any commit is unrecorded or fails), `--json` flag on `verify` and `status`.
- `hook.mjs`: reads one JSON object from stdin (Claude Code hook payload). `hook_event_name` `UserPromptSubmit` → `prompt` entry with `prompt` text; `PostToolUse` → for `tool_name` in `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash` a `tool` entry with `input` = `tool_input` and `files` = `[tool_input.file_path]` when present; other tools ignored. No current session → start one (intent: first 120 characters of the prompt, or "unstated"; tool "claude-code"). Always exits 0 and prints nothing (a hook must never block the agent); errors go to `.provenance/hook.log`.
- `precommit.mjs`: exits 1 with a clear message when no session (unless `PROVENANCE_SKIP=1`, in which case it prints a one-line warning and exits 0); otherwise computes `stagedDiff`, appends a `commit` entry `{ diffHash, files }`, writes the manifest, `git add`s it, and writes the manifest path and hash to `.provenance/pending` for `commitmsg.mjs`.
- `commitmsg.mjs`: reads `.provenance/pending`, appends the three trailers to the message file (idempotent), deletes `pending`. Skips when `pending` is absent (the skip case).
- `.claude/settings.json`: `{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"node scripts/provenance/hook.mjs"}]}],"PostToolUse":[{"matcher":"Edit|Write|MultiEdit|NotebookEdit|Bash","hooks":[{"type":"command","command":"node scripts/provenance/hook.mjs"}]}]}}`

- [ ] **Step 1: Write the failing tests** (`cli.test.mjs`, spawning the CLI with `execFileSync("node", [...])` in a temp repo with hooks installed): `install` sets hooksPath; a commit with no session is refused with exit 1 and the message names `pnpm provenance start`; with a session, the commit succeeds, the manifest is in the commit, and `verify` reports it recorded and matching; `PROVENANCE_SKIP=1` commits without trailers and `verify` reports unrecorded with exit 1; `hook.mjs` given a `UserPromptSubmit` payload with no session creates one whose intent is the prompt's first words and stores the prompt text only in the session file; a `PostToolUse` Edit payload appends a tool entry with the file path and no input text.
- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement. Step 4: Run** `node --test scripts/provenance/` and, by hand in this repo, `pnpm provenance install` then `pnpm provenance status`.
- [ ] **Step 5: Commit** `feat(provenance): cli, claude code hooks, git hooks`

---

### Task 3: The contribute skill and docs

**Files:** Create `.claude/skills/contribute/SKILL.md`, `AGENTS.md`, `docs/provenance.md`; modify `README.md` (one "Contributing" section pointing at both).

- `SKILL.md` frontmatter: `name: contribute`, `description: Use before changing anything in the Panorama repository: the working contract, vocabulary, test and commit rules, and how provenance is recorded and verified.` Body under 600 words: what Panorama is (one paragraph from the spec), the documents to read and in what order, the vocabulary, the rules (tests first, tokens only, no dashes, conventional commits with the trailer), the provenance workflow (sessions start automatically in Claude Code; otherwise `pnpm provenance start`; `status` before committing; never paste secrets into prompts; how `verify` is read; how to attach a transcript to a PR: export `.provenance/sessions/<id>.jsonl`, optionally redacted, and state the head hash), and what to do when the pre-commit hook refuses.
- `AGENTS.md`: ten lines pointing non-Claude agents at the skill file and the CLI.
- `docs/provenance.md`: the spec's Purpose and Vocabulary sections in plain words, the trailer format, the verify table columns, the honest limits paragraph, and the skip escape hatch.

- [ ] **Step 1: Write the three files and the README section. Step 2: Check** `grep -rn "—\|–" .claude/skills AGENTS.md docs/provenance.md README.md scripts/provenance | wc -l` is 0 and `node --test scripts/provenance/` passes. **Step 3: Commit** `docs(provenance): contribute skill, agents pointer, guide`

## Acceptance

1. In a fresh clone, `pnpm provenance install` then a commit without a session is refused; `pnpm provenance start "x"` then commit succeeds and `pnpm provenance verify HEAD~1..HEAD` shows recorded, manifest ok, diff ok, files ok, transcript matches.
2. In Claude Code, prompts and edits append to the session without any manual step.
3. No committed file contains prompt text.
