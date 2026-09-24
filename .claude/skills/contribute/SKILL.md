---
name: contribute
description: Use before changing anything in the Panorama repository: the working contract, vocabulary, test and commit rules, and how provenance is recorded and verified.
---

# Contributing to Panorama

Panorama is a free, self-hosted project manager that any AI agent plugs into through REST or MCP. Work moves only by explicit rules, and a ticket cannot close without evidence. Panorama ships no agents and makes no LLM calls; it is the record of what other agents did, not an agent itself.

## Read first, in order

1. `docs/superpowers/specs/2026-09-21-panorama-design.md`, the system design: data model, API, rule engine, security.
2. `BRIEF.md`, the UI build brief: views, copy rules, the quality floor.
3. `BRAND.md`, the locked visual system: tokens, type, shape, motion. Re-read before any visual change.
4. `docs/superpowers/specs/2026-09-24-provenance-design.md`, this repository's provenance system, summarised below.
5. The plan for whatever milestone you are working in, under `docs/superpowers/plans/`.

## Vocabulary

Name things by these words, nowhere else: Project, Epic, Ticket, Lane, Flag, Evidence, Rule, Trigger, Agent. A ticket moves through Lanes; a gated Lane refuses entry without its Evidence; a Flag such as needs_human is cleared only by a human; a Rule reacts to an event and, when its conditions hold, performs actions, one of which may be a Trigger on a schedule.

## Rules

- Tests first. Write the failing test, watch it fail, then make it pass.
- Tokens only. Colours, radii, type, and motion come from the CSS custom properties in `BRAND.md`. No framework palette names, no hex codes invented on the spot.
- No em dashes and no en dashes anywhere: not in code, comments, commit messages, or generated strings.
- Conventional commits (`feat:`, `fix:`, `docs:`, ...), one concern per commit, ending with the required co-author trailer.

## Provenance

Every commit carries a record of the session that produced it: who, with what tool, with what stated intent, through which prompts and tool calls, producing which diff. See `docs/superpowers/specs/2026-09-24-provenance-design.md` for the full design; this is the short version.

- **In Claude Code**, a session starts and records itself automatically: hooks append your prompts and tool calls as you work.
- **Anywhere else** (another agent, or a human), run `pnpm provenance start "<intent>"` first, `pnpm provenance note "<text>"` for context, `pnpm provenance end` when done. `pnpm provenance status` shows the open session, entry count, chain head, and what is staged.
- Run `status` before every commit; a commit with no open session is refused (`PROVENANCE_SKIP=1` bypasses it, verifying as unrecorded).
- **Amends, rebases, and cherry-picks** carry a manifest forward as an increment, not the whole diff: treat a chain of amends like a chain of commits. `prepare-commit-msg` only annotates the pending record; it cannot rewrite what pre-commit already staged.
- **Never paste secrets into a prompt.** Prompts are recorded locally, in full, in `.provenance/sessions/`, so the record stays honest. That file is never committed, but treat it as if someone might read it.
- `pnpm provenance verify [range]` checks recent commits (default: ahead of `origin/main`, or the last 20): trailers present, manifest genuinely bound to that commit, file list matches, signature, transcript match. Merges are exempt (their own row). A failing or unrecorded row is the one to look at hardest.
- **Attaching a transcript to a PR**: export `.provenance/sessions/<id>.jsonl` (redact if needed) and state its head hash against `Provenance-Head`.

## When the pre-commit hook refuses

No session is open. Run `pnpm provenance start "<intent>"` describing the work, then commit again. If this commit genuinely should not be recorded (an emergency fix, a generated lockfile), use `PROVENANCE_SKIP=1` and say so in the message.

What this proves: the record was not altered after the commit, and the commit is bound to it. What it does not prove: that the record is truthful, or that the code is safe. Review still happens.
