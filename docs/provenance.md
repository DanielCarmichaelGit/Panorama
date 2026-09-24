# Contribution provenance

Every change to Panorama should carry a verifiable record of how it was
made: who, with which tool, with what stated intent, through which
prompts and tool calls, producing which diff. A reviewer, human or AI, can
then check that the record presented matches what was committed, and read
the intent and the process next to the diff. Hunks that no prompt
explains are the ones to look at hardest.

What this proves: the record was not altered after the commit, the commit
is bound to that record, and (when the commit is signed) a named person
stands behind it. What it does not prove: that the record is truthful, or
that the code is safe. It raises the cost of injecting a change and
leaves a trail; review still happens.

## Vocabulary

**Session.** A working period in the repository, stored locally at
`.provenance/sessions/<id>.jsonl` and never committed. It holds entries:
`start` (actor, tool, intent), `prompt` (text kept locally, a hash
carried), `tool` (name, input hash, files touched), `note`, `commit`,
`end`. Each entry carries `prev` and `hash = sha256(prev +
canonical(entry without hash))`, so a session is a hash chain: change or
remove one entry and every entry after it stops verifying.

**Manifest.** Committed, one per commit, at
`.provenance/manifests/<sessionId>-<n>.json`: the session id, actor,
tool, intent, the chain's head hash and entry count at commit time, a
`diffHash` (the sha256 of `git diff --cached`, excluding `.provenance/`
itself), the list of files in that diff, a timestamp, and an optional
redacted transcript head when the contributor hands over a redacted copy.
It carries hashes, never prompt text.

**Trailers.** Three lines appended to the commit message:
`Provenance-Manifest: sha256:<hash> <path>`, naming the manifest and its
hash; `Provenance-Head: sha256:<hash>`, the session chain's head at
commit time; `Provenance-Diff: sha256:<hash>`, the hash of the commit's
real diff.

**Verification.** `pnpm provenance verify [range]` (default: commits
ahead of `origin/main`, or the last 20) checks, for every commit in
range: the three trailers are present; the manifest named by the trailer
is in that commit and its hash matches; that manifest's own recorded
head and diff hash actually match this commit (not merely a hash that
happens to be valid, which an old, still-tracked manifest reused from an
earlier commit would also produce); the manifest's file list equals the
commit's changed files; the commit's signature, reported as signed,
unsigned, or unknown key; and, when the session file still exists on
this machine, that its chain verifies and the entry the manifest points
to still matches (mismatch or "transcript not available here"
otherwise). A merge commit is exempt (see below). The command prints a
table and exits non-zero when any commit has a problem.

## The verify table

Seven columns, sized to fit within 100 characters: `SHA`, `RECORDED`
(trailers present), `MANIFEST` (bound to this commit), `DIFF` (hash
matches), `FILES` (list matches), `SIGNATURE` (signed, unsigned,
unknown-key, or bad), `TRANSCRIPT` (matches, mismatch, unavailable, or
merge). Pass `--json` for the full report objects, problems included.

## Merge commits are exempt

Nobody writes a manifest for "merge these two branches", so a merge
commit is never checked against the ordinary rules. `verify` shows it as
its own row (`RECORDED` reads `merge`, the manifest/diff/file columns
read `-`) and it never fails the range on its own account.

## How it is captured

- **Claude Code**: hooks in `.claude/settings.json` run
  `scripts/provenance/hook.mjs` on `UserPromptSubmit` and `PostToolUse`,
  appending entries to the session in progress. With no session open, the
  hook starts one, taking its intent from the first prompt (or "unstated"
  for a tool event before any prompt).
- **Any other agent, or a human**: the CLI, `pnpm provenance <start|note|
  prompt|tool|status|end>`.
- **Git hooks**, installed by `pnpm provenance install`
  (`core.hooksPath=.githooks`): `pre-commit` refuses a commit with no
  session open (unless `PROVENANCE_SKIP=1`, which prints a warning and
  lets the commit through unrecorded), and otherwise writes the manifest
  (recording the diff against whatever HEAD is at that moment as the
  manifest's own `base`) and stages it; `prepare-commit-msg` confirms
  `git commit --amend` using git's own signal for it and notes that on the
  pending record; `commit-msg` appends the three trailers. A commit made
  by `git rebase` or `git cherry-pick` replaying existing commits does not
  run `pre-commit` at all (git's own behavior, not this tool's) and so
  lands honestly unrecorded, the same as `PROVENANCE_SKIP=1`; a `git
  commit` run explicitly through `git rebase --exec` goes through the
  normal hooks and is refused like any other commit with no session open.

## The skip escape hatch

`PROVENANCE_SKIP=1 git commit ...` bypasses the pre-commit refusal for
the rare case that genuinely needs it (an emergency fix, a generated
lockfile). It does not fake a record: the resulting commit carries no
trailers and `pnpm provenance verify` reports it as unrecorded, honestly,
rather than inventing a session after the fact.

## Honest limits

This is tamper evident, not tamper proof, and it is local, not a CI gate.
It proves that a record exists and matches its commit; it does not prove
the record is true, that the diff is safe, or that nobody edited history
and force pushed over it. A determined actor with write access to the
repository can rewrite everything, including the hooks that would have
caught them. What it does buy: an honest contributor's record survives by
default, a dishonest one has to actively work to produce a false record
instead of simply omitting one, and every commit either carries a
transcript-backed explanation or visibly does not.

For an amended commit, the manifest attests the increment since the last
recording, not the commit's whole diff from its parent: treat a chain of
amends the way you would a chain of ordinary commits, not as one commit
with one diff. Rebase and cherry-pick carry a commit's manifest forward
unchanged, base and all; `prepare-commit-msg` only annotates the pending
record for visibility, it cannot rewrite what pre-commit already staged.
