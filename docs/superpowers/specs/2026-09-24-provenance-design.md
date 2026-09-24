# Contribution provenance

Date: 2026-09-24. Status: approved by the owner (local only, no CI, iterate later).

## Purpose

Every change to Panorama should carry a verifiable record of how it was made: who, with which tool, with what stated intent, through which prompts and tool calls, producing which diff. A reviewer, human or AI, can then check that the record presented matches what was committed, and read the intent and the process next to the diff. Hunks that no prompt explains are the ones to look at hardest.

What this proves: the record was not altered after the commit, the commit is bound to that record, and (when the commit is signed) a named person stands behind it. What it does not prove: that the record is truthful, or that the code is safe. It raises the cost of injecting a change and leaves a trail; review still happens.

## Vocabulary

Session, Entry, Manifest, Trailer, Verification.

- **Session**: a working period in the repository. Stored locally in `.provenance/sessions/<id>.jsonl`, never committed. Entries: `start` (actor, tool, intent), `prompt` (text kept locally, hash carried), `tool` (tool name, input hash, files touched), `note`, `commit`, `end`. Each entry carries `prev` and `hash = sha256(prev + canonical(entry without hash))`, so a session is a hash chain.
- **Manifest**: committed, one per commit, at `.provenance/manifests/<sessionId>-<n>.json`: session id, actor, tool, intent, chain head and entry count at commit time, `diffHash` = sha256 of `git diff --cached` excluding `.provenance/`, the list of files in that diff, timestamp, and an optional `redactedHead` when the contributor hands over a redacted transcript. Hashes only; no prompt text.
- **Trailers** on the commit message: `Provenance-Manifest: sha256:<hash of canonical manifest> <path>`, `Provenance-Head: sha256:<chain head>`, `Provenance-Diff: sha256:<diffHash>`.
- **Verification** (`pnpm provenance verify [range]`, default `origin/main..HEAD` or the last 20 commits): for every commit, trailers present; manifest file present in that commit and its hash matches the trailer; the commit's real diff (excluding `.provenance/`) hashes to `Provenance-Diff`; the manifest's file list equals the changed files; `git verify-commit` result reported as signed, unsigned, or unknown key; when the session file exists locally, its chain verifies and its head equals `Provenance-Head` (transcript matches), otherwise "transcript not available here". Output is a table and a non-zero exit when anything fails or is unrecorded.

## Capture

- **Claude Code**: hooks in `.claude/settings.json` (`UserPromptSubmit`, `PostToolUse`) run `node scripts/provenance/hook.mjs`, which appends entries to the current session. With no current session, the hook starts one (intent taken from the first prompt, or "unstated" for a tool event). Subagent tool calls fire the same hooks and land in the same session.
- **Any other agent or a human**: `pnpm provenance start "<intent>"`, `note`, `prompt` (reads stdin), `tool`, `end`.
- **Git hooks** installed by `pnpm provenance install` (`core.hooksPath=.githooks`): `pre-commit` refuses a commit when no session is open (message tells how to start one; `PROVENANCE_SKIP=1` bypasses and the commit then verifies as unrecorded), writes the manifest and stages it; `commit-msg` appends the three trailers.

## Ontology enforcement

A repository skill at `.claude/skills/contribute/SKILL.md` (with `AGENTS.md` at the root pointing to it for other tools) states how work happens here: read the spec, BRIEF, BRAND; use the vocabulary Project, Epic, Ticket, Lane, Flag, Evidence, Rule, Trigger, Agent; tests first; conventional commits, no em or en dashes; tokens only in CSS; never paste secrets into prompts because prompts are recorded locally; run `pnpm provenance status` before committing; how to attach a transcript to a PR. The skill is the contract; the hooks are the enforcement.

## Out of scope for now

GitHub Actions, a remote lineage server, uploading transcripts anywhere, and key management beyond git's own commit signing. Later, Panorama itself is the lineage server: a change is a ticket and the transcript is evidence.
