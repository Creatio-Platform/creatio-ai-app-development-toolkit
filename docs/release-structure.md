# Release Structure

The toolkit ships as a plugin family under `plugins/<name>/` (`creatio-core`, `creatio-app-builder`, `creatio-ui`,
`creatio-migration`), each with its own host manifests and a flat `skills/` directory, plus a root
`.claude-plugin/plugin.json` meta-plugin that installs the whole family on Claude Code through `dependencies`. The root
catalogs (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.github/plugin/marketplace.json`) list
the plugins. See [`plugins/README.md`](../plugins/README.md) for what each plugin owns and
[`versioning-and-release.md`](versioning-and-release.md) for the version and release flow.

The canonical list of files that ship in the release zip is defined in [`.release-manifest.json`](../.release-manifest.json) at the repository root. Two sections:

- `plugin_runtime[]` — paths bundled into the release zip and copied into the agent's plugin destination by the **local-install path** (Cursor, and the Codex plugin-cache materialization) via `copy_plugin_runtime_surface`, which reads this list directly. Claude Code and GitHub Copilot CLI install from the remote marketplace (`<cli> plugin marketplace add` + `plugin install`) and do not use this copy step — but they still rely on the bundled checkout for the required-reference preflight. There is no parallel hardcoded list in the installer.
- `release_extras[]` — additional paths bundled into the release zip but not installed into agent homes (currently `installer/`).

The release workflow (`.github/workflows/release.yml`) builds `creatio-ai-app-development-toolkit-<version>.zip` from `plugin_runtime + release_extras + .release-manifest.json` itself and attaches it to the GitHub Release in a single `gh release create` call (draft → upload → publish). The installation wizard downloads this asset.

Included release files (full list lives in `.release-manifest.json`):

- `.claude-plugin/plugin.json` (the meta-plugin) and `.claude-plugin/marketplace.json` for Claude Code.
- `.agents/plugins/marketplace.json` for the Codex CLI marketplace catalog.
- `.github/plugin/marketplace.json` for the GitHub Copilot CLI marketplace catalog.
- `plugins/` — every plugin with its four host manifests (`.claude-plugin/`, `.codex-plugin/`, `.cursor-plugin/`, `.github/plugin/`) and `skills/`; the core `context/`, `hooks/` and `.mcp.json` (clio MCP); the app-builder `runtime/`, `rules/` (the Cursor rule) and orchestrator `references/`.
- `AGENTS.md` for the repository-wide rules.
- `LICENSE`, `README.md`, and `SECURITY.md` for license compliance, in-zip product overview, and the vulnerability-reporting channel.
- `installer/` so the extracted release zip can install itself.

Not included in the release asset:

- `.version-bump.json` and `scripts/bump-version.js` are repository release-preparation tooling, not installed runtime files.
- `.github/workflows/` is repository CI/release automation, not part of the installable plugin asset.
- `RELEASE-NOTES.md` is consumed by the release workflow before packaging and becomes the GitHub Release body; it is not needed inside the installable zip.
- `docs/`, `tests/`, `engine-tests/` and `.architecture/` are development artifacts and stay out of the runtime release.

Deferred:

- MCP registry discovery through `server.json`.
- Custom CAADT MCP server package.
- `gh skill install` packaging.
- Installer profiles (installing a subset of the family per host) and per-plugin `ref: release` pinning of the Codex and Copilot catalog entries; until then the Claude meta-plugin entry is the only pinned catalog entry.
- Replacing the remaining cross-plugin relative references in skill files with skill names or clio `get-guidance` articles.
- Registry/tarball marketplace and a CAADT-owned auto-updater. (Claude Code plugin auto-update is enabled via Claude's own marketplace settings — `extraKnownMarketplaces.creatio.autoUpdate` — not a CAADT-owned mechanism.)
