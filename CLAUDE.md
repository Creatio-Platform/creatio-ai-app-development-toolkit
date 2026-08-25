# Claude Code Instructions

Use repo-local shared skills from `.agents/skills/` when the task matches them.

<!-- BEGIN MANAGED SECTION: company-agent-policy v1.1.0 -->
<!-- DO NOT EDIT THIS SECTION MANUALLY. -->

## Required Workflow
Attribution of AI-authored changes is handled automatically by the installed Claude Code tooling hooks (Pre/PostToolUse events) — no manual skill or marker command is required for normal work.

The agent must:
1. Let the installed hooks record every file the agent creates or modifies.
2. Allow the hooks to manage the `AI agents: ...` commit trailer automatically.
3. Avoid running manual attribution commands during normal work.

<!-- END MANAGED SECTION -->
