# Release Structure

V1 ships as a single root-level plugin. All ADAC skills belong to the root plugin package.

Included release files:

- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` for Claude Code.
- `.codex-plugin/plugin.json` for Codex CLI plugin metadata.
- `.cursor-plugin/plugin.json` for Cursor plugin installation.
- `.github/plugin/plugin.json` and `.github/plugin/marketplace.json` for GitHub Copilot CLI.
- `.agents/plugins/marketplace.json` for the Codex CLI marketplace catalog.
- `.mcp.json` for global clio MCP server configuration.
- `rules/creatio-app-orchestrator.mdc` for Cursor plugin rule support.
- `.version-bump.json` plus `scripts/bump-version.js` for version synchronization across every plugin and marketplace manifest (includes `--audit` mode). `.version-bump.json` is the single source of truth for which fields hold the plugin version; `.claude-plugin/plugin.json` is the canonical reference used by `--check` drift detection (listed first).
- `.github/workflows/pr.yml` and `.github/workflows/release.yml` for CI and release automation.
- `RELEASE-NOTES.md` for canonical release notes consumed by the release workflow.

Deferred from v1:

- MCP registry discovery through `server.json`.
- Custom ADAC MCP server package.
- `gh skill install` packaging.
- Multi-plugin `plugins/<name>/plugin.yaml` packaging.
- Registry/tarball marketplace and auto-update.
