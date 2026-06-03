# Creatio AI App Development Toolkit — Release Notes

Releases are listed in reverse chronological order. Each release has a `## X.Y.Z (YYYY-MM-DD)` header. Subsections (`###`) under each release are free-form — pick what reflects the actual scope (Features, Bug Fixes, Breaking Changes, Migration Notes, Documentation, etc.).

To cut a release: open a release preparation PR that adds a new `## X.Y.Z (date)` section at the top of this file and runs `node scripts/bump-version.js X.Y.Z`, merge it, then trigger the `Release` GitHub Actions workflow with the same version. The workflow validates the prepared main branch, tags it, and uses this section as the body of the GitHub Release.

---

## 1.0.0 (2026-06-03)

### Initial public release

First public release of the Creatio AI App Development Toolkit on github.com. The toolkit installs as a plugin or skill surface for AI coding agents (Codex CLI/Desktop, Claude Code, Cursor, GitHub Copilot CLI) and drives a business-first workflow: natural-language app request → BA-style Business Plan → Technical Implementation Handoff → implementation through the clio MCP server.

### Highlights

- BA-style Business Plan and Technical Implementation Handoff as the user-facing deliverables, with explicit business approval before implementation.
- Installer (`installer/install.py`) for Codex, Claude Code, Cursor, and GitHub Copilot CLI; remote-marketplace install for Claude, Codex, and Copilot; local file-copy install for Cursor.
- clio MCP integration as the executable contract for implementation; tool parameter and response shapes are sourced from `get-tool-contract` rather than duplicated in the repository.
- Repository docs by responsibility: `AGENTS.md` (orchestration policy), `runbooks/` (stage-specific workflow), `context/` (navigation hub for reference content), `runtime/` (helper scripts).
- MIT licensed; security policy and contribution guide included.
