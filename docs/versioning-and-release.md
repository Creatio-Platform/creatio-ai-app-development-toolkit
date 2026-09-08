# Versioning and release

Moved from the root `AGENTS.md` in ENG-96689 so the agent-facing file carries only agent-facing rules.

## Versioning Policy (semver)

CAADT ships as a single versioned product (one number for plugin metadata, skills, rules, runtime scripts, docs, installer, MCP config). Canonical tag: `X.Y.Z` (without `v` prefix; e.g. `0.2.0`, not `v0.2.0`). Pre-release tags (`-rc`, `-beta`) are not used in v1.

**MAJOR (X.0.0)** — incompatible changes that require user action:
- Breaking change in workflow contracts (Business Plan format, gate flow).
- Breaking change in installed skill contract.
- Installer CLI breaking change (renamed/removed flags, changed install paths).
- Removal of a supported agent target (Codex / Claude / Cursor / Copilot).
- Removal of a runbook or required gate.

**MINOR (0.X.0)** — backward-compatible capabilities:
- New runbook or new optional gate.
- New supported agent.
- New clio MCP capability adopted (CAADT starts calling a tool that wasn't used before).
- New workflow capability without breaking existing contracts.

**PATCH (0.0.X)** — compatible fixes:
- Instruction text fix.
- Runtime script bugfix without behavior change.
- Installer fix that does not change CLI.
- Documentation update.

**Support policy:** Latest stable only. Patches are not backported to older minor branches.

## Release Flow

Releases are cut manually via the `Release` GitHub Actions workflow (`workflow_dispatch`) after a release preparation PR has already bumped versions and added the matching `RELEASE-NOTES.md` section. Maintainer enters the target version `X.Y.Z`; the workflow runs the Release Gate (5 gates: version format, release-notes section present, manifests already synced, tests pass, and canonical manifest match and tag availability), then tags and creates a GitHub Release with body extracted from `RELEASE-NOTES.md`.

Notes for each release live in `RELEASE-NOTES.md` (canonical file at the repo root). Add a `## X.Y.Z (YYYY-MM-DD)` section at the top of the file in a separate PR before triggering the release workflow. Subsections (`###`) are free-form per release (Features, Bug Fixes, Migration Notes, etc.).
