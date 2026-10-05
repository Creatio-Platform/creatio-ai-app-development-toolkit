# Claude Code Instructions

Use the repo-local shared skills under `skills/` when the task matches them.

<!-- BEGIN MANAGED SECTION: company-agent-policy v1.2.0 -->
<!-- Maintained by Toolkit maintainers; update both policy blocks together and run tests/test_attribution_policy.py. -->

## AI Change Attribution
The public Toolkit does not bundle an AI change-attribution integration or require an attribution skill. Attribution depends on the coding host and any separately installed company tooling.

The agent must:
1. Follow applicable repository-specific attribution instructions when their tooling is available.
2. If the host has an installed attribution integration, let it record edits according to its own documented contract. Claude Code hooks apply only to Claude Code sessions with those hooks installed; do not assume they run in Codex, Cursor, or GitHub Copilot sessions.
3. If no attribution integration is installed, continue the normal Git workflow. If a separate repository rule requires unavailable attribution tooling, report that specific gap and follow the repository's fallback or ask its maintainer; the Toolkit itself adds no attribution prerequisite.
4. Do not invent file markers, install attribution hooks, run manual attribution commands, or add `AI agents: ...` commit trailers solely because of this Toolkit policy. A separately installed integration owns whether it emits metadata or trailers; the Toolkit makes no guarantee that it does.

<!-- END MANAGED SECTION -->

## Comments Describe the Code, Not Its Review History

When you write or edit a comment, a test's check title or a doc under `skills/`, `runbooks/`,
`context/` or `engine-tests/`, state the rule that holds now — never the story of how the code got
here. You have the ticket and the review thread in context, and it is tempting to record what you
were asked to change; do not. The reader of the comment does not have that context and does not
need it, and the tracker keeps it already.

- Never write a ticket key (`ENG-12345`), a pull request number, a review round, a severity label
  or a person's handle.
- Never write `before the fix`, `previously`, `used to`, `no longer` or `regression` narrative.
- Say what must be true and why. `// Guard for the ENG-95806 blocker Ana raised in round 3` becomes
  `// Identically labeled rows on different pages do not share state.`
- When a block carries both a rule and its history, keep the rule and drop the history. When it is
  only history, delete it.

`tests/test_comment_hygiene.py` fails the build on a violation. Records whose subject *is* the
history — `RELEASE-NOTES.md`, the decision records under `docs/`, `.ai/specs/` — are exempt there.
