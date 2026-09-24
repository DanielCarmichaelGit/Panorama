# For agents other than Claude Code

Read `.claude/skills/contribute/SKILL.md` first: it is the working
contract for this repository (what Panorama is, what to read, the
vocabulary, test and commit rules, and provenance).

Claude Code records prompts and tool calls automatically via hooks. Any
other tool must call the CLI: `pnpm provenance start "<intent>"` before
you begin, `pnpm provenance note "<text>"` for context, `pnpm provenance
end` when done, `pnpm provenance status` before every commit.

See `docs/provenance.md` for the full picture, and `pnpm provenance
verify` to check recorded commits.
