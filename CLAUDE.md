# Claude Code Instructions

Use repo-local shared skills from `.agents/skills/` when the task matches them.

For ADAC or Copilot session-log analysis, use `.agents/skills/analyze-adac-logs/SKILL.md` as the canonical guide for this repository.

- Read the skill before analyzing a raw session log.
- Use `.agents/skills/analyze-adac-logs/scripts/analyze_session_log.py` first for counts and timeline extraction.
- Treat the raw log as the source of truth.
- If the user wants remediation, follow `.agents/skills/analyze-adac-logs/references/remediation-workflow.md`, treat `clio MCP` as the source of truth, confirm the CLIO source path before fixes, and ask before any push.
