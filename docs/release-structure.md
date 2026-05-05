# Release Structure

V1 ships as a single root-level plugin. All ADAC skills belong to the root plugin package.

Included release files:

- `plugin.json` for Copilot CLI.
- `.codex-plugin/plugin.json` for Codex-compatible plugin metadata.
- `.cursor-plugin/plugin.json` for Cursor plugin installation.
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` for Claude.
- `.agents/plugins/marketplace.json` for forward-compatible local marketplace metadata.
- `.mcp.json` for global clio MCP server configuration.
- `rules/creatio-app-orchestrator.mdc` for Cursor plugin rule support.
- `.version-bump.json` plus `scripts/bump-version.js` for version synchronization.

Deferred from v1:

- MCP registry discovery through `server.json`.
- Custom ADAC MCP server package.
- `gh skill install` packaging.
- Multi-plugin `plugins/<name>/plugin.yaml` packaging.
- Registry/tarball marketplace and auto-update.
