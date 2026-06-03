# Claude Code Instructions

Use repo-local shared skills from `.agents/skills/` when the task matches them.

<!-- BEGIN MANAGED SECTION: company-agent-policy v1.0.0 -->
<!-- DO NOT EDIT THIS SECTION MANUALLY. -->

## Required Workflow
Before any substantial repository analysis, planning, implementation, refactoring, bug fixing, or file edits, use the `$ensure-ai-commit-attribution` skill.

This is a mandatory attribution rule for all coding sessions in this repository.

The agent must:
1. Mark every file the agent creates or modifies with the skill marker helper.
2. Allow the repository hooks to manage the `AI agents: ...` trailer automatically.
3. Avoid all other attribution commands during normal work.

For normal work, the only allowed attribution command is the file-marking command after a real file write. That single command must also handle any needed hook installation quietly.

<!-- END MANAGED SECTION -->
