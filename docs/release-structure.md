# Release Structure

V1 ships as a single root-level plugin. All ADAC skills belong to the root plugin package.

The canonical list of files that ship in the release zip and that `install.py` copies into agent homes is defined in [`.release-manifest.json`](../.release-manifest.json) at the repository root. Two sections:

- `plugin_runtime[]` — paths that `install.py` copies into each agent's plugin destination. `copy_plugin_runtime_surface` reads this list directly; there is no parallel hardcoded list in the installer.
- `release_extras[]` — additional paths bundled into the release zip but not installed into agent homes (currently `installer/`).

The release workflow (`.github/workflows/release.yml`) builds `creatio-ai-app-development-toolkit-<version>.zip` from `plugin_runtime + release_extras + .release-manifest.json` itself and attaches it to the GitHub Release in a single `gh release create` call (draft → upload → publish). The installation wizard downloads this asset.

Included release files (full list lives in `.release-manifest.json`):

- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` for Claude Code.
- `.codex-plugin/plugin.json` for Codex CLI plugin metadata.
- `.cursor-plugin/plugin.json` for Cursor plugin installation.
- `.github/plugin/plugin.json` and `.github/plugin/marketplace.json` for GitHub Copilot CLI.
- `.agents/plugins/marketplace.json` for the Codex CLI marketplace catalog.
- `.mcp.json` for global clio MCP server configuration.
- `rules/creatio-app-orchestrator.mdc` for Cursor plugin rule support.
- `AGENTS.md`, `context/`, `runbooks/`, `runtime/`, and `skills/` for the installed ADAC orchestration runtime.
- `installer/` so the extracted release zip can install itself.

Not included in the release asset:

- `.version-bump.json` and `scripts/bump-version.js` are repository release-preparation tooling, not installed runtime files.
- `.github/workflows/` is repository CI/release automation, not part of the installable plugin asset.
- `RELEASE-NOTES.md` is consumed by the release workflow before packaging and becomes the GitHub Release body; it is not needed inside the installable zip.
- `docs/` and `tests/` are development artifacts and stay out of the runtime release.

Deferred from v1:

- MCP registry discovery through `server.json`.
- Custom ADAC MCP server package.
- `gh skill install` packaging.
- Multi-plugin `plugins/<name>/plugin.yaml` packaging.
- Registry/tarball marketplace and auto-update.
