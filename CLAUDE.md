# Claude Code Instructions

Use the repo-local shared skills under `skills/` when the task matches them.

<!-- BEGIN MANAGED SECTION: company-agent-policy v1.1.0 -->
<!-- DO NOT EDIT THIS SECTION MANUALLY. -->

## Required Workflow
Attribution of AI-authored changes is handled automatically by the installed Claude Code tooling hooks (Pre/PostToolUse events) — no manual skill or marker command is required for normal work.

The agent must:
1. Let the installed hooks record every file the agent creates or modifies.
2. Allow the hooks to manage the `AI agents: ...` commit trailer automatically.
3. Avoid running manual attribution commands during normal work.

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
