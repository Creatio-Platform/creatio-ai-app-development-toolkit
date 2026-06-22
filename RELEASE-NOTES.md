# Creatio AI App Development Toolkit — Release Notes

Releases are listed in reverse chronological order. Each release has a `## X.Y.Z (YYYY-MM-DD)` header. Subsections (`###`) under each release are free-form — pick what reflects the actual scope (Features, Bug Fixes, Breaking Changes, Migration Notes, Documentation, etc.).

To cut a release: open a release preparation PR that adds a new `## X.Y.Z (date)` section at the top of this file and runs `node scripts/bump-version.js X.Y.Z`, merge it, then trigger the `Release` GitHub Actions workflow with the same version. The workflow validates the prepared main branch, tags it, and uses this section as the body of the GitHub Release.

---

## 1.2.0 (2026-06-22)

### Features

- Add the CAADT product telemetry contract (`context/product-telemetry.md`): consent handling, required event mapping, telemetry payload shape, and emission checkpoints. The contract is referenced from `AGENTS.md` and the `creatio-app-orchestrator` skill + Cursor rule, and registered as a required installer reference.
- Install a `## Analytics Context` block (`coding_agent`, `skill_version`, `plugin_version`): concrete values are rendered into the Cursor rule at install time, while the committed `SKILL.md` and orchestrator Cursor rule carry derived values for the marketplace-based install path.

---

## 1.1.0 (2026-06-17)

### Features

- Prefer the native `clio` MCP server, operate within a single context, and treat the package context as writable, streamlining implementation through clio.
- Execution UX & effort-budget contract: reasoning-latency expectations, progress signals during long-running work, and recovered-error reframing so transient failures are reported as recovered rather than fatal.
- Orchestrator now generates business rules and applies improved business-plan object-model naming.
- Generated UI text must use localizable strings, so produced apps are translation-ready by default.

### Bug Fixes

- Orchestrator skill path resolution now works when the toolkit is invoked from outside the toolkit folder.

---

## 1.0.1 (2026-06-09)

### Features

- Unified updater (`installer/update.py`) that updates every detected agent in a single run, including Claude Code, through each agent's native plugin update command; Cursor is reinstalled from the latest release.

### Bug Fixes

- More resilient installer: per-target failures are isolated, and agents whose CLI is not on `PATH` are skipped instead of triggering a failed install.

### Documentation

- Documented the native per-agent update commands, linked the contributing and security guides, and added guidance to resolve web vs mobile (default web) before any page edit.

### Security & CI

- Hardened CI and supply chain: added SAST, secret, and dependency scanning, enabled CodeQL, pinned actions to commit SHAs, and locked the release branch to the release pipeline.

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
