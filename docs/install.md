# Install Creatio AI App Development Toolkit

This repository is the root plugin package for the Creatio AI App Development Toolkit.

## Prerequisites

- `clio` must be installed and available in `PATH`.
- The target coding agent must support plugin installation, local skills, or MCP configuration.

## MCP

The plugin includes `.mcp.json`, which starts the global clio MCP server:

```json
{
  "mcpServers": {
    "clio": {
      "command": "clio",
      "args": ["mcp-server"]
    }
  }
}
```

The coding agent owns the process lifecycle.

## Supported coding agents

For Claude Code, GitHub Copilot CLI, and Codex CLI the installer registers CAADT as a remote plugin
marketplace served from the public Git repository (`MARKETPLACE_GIT_URL` in
[install.py](../installer/install.py)) and installs `creatio-ai-app-development-toolkit@creatio`
through the host CLI. The CLI manages the plugin payload on disk; the installer does not copy or
overlay files into the host's plugin tree.

Cursor remains on the local file-copy install model.

- **Claude Code** (`~/.claude/`) — preflights `claude` in PATH, then runs
  `claude plugin marketplace add <url>` and `claude plugin install creatio-ai-app-development-toolkit@creatio`.
  Patches `~/.claude/settings.json` to set `extraKnownMarketplaces.creatio.autoUpdate = true` so the
  marketplace and plugin auto-update on Claude Code startup (third-party marketplaces are otherwise
  off by default). Skills ship inside the plugin payload, so the CLI-managed install exposes them
  directly; the installer does not mirror skills into `~/.agents/skills/` for Claude.
- **Codex CLI/Desktop** (`~/.codex/`) — preflights `codex` in PATH, removes any legacy file-copy
  artifacts (`~/.codex/plugins/marketplaces/creatio/`, `~/.codex/plugins/cache/creatio/`,
  `~/.agents/plugins/creatio-ai-app-development-toolkit/`, `~/.codex/skills/creatio-app-orchestrator/`,
  and the `creatio` entry in `~/.agents/plugins/marketplace.json`), scrubs `[marketplaces.creatio]`,
  `[plugins."creatio-ai-app-development-toolkit@creatio"]`, and any matching `[[skills.config]]`
  override out of `~/.codex/config.toml`, then runs `codex plugin marketplace remove creatio`
  (tolerating "not found"), `codex plugin marketplace add <url>`, and
  `codex plugin add creatio-ai-app-development-toolkit@creatio`. Finally re-merges the `clio` MCP
  server block into `~/.codex/config.toml` — Codex CLI does not auto-promote plugin-bundled
  `.mcp.json` entries to user-level `[mcp_servers.*]`, so the installer keeps that registration.
- **Cursor** (`~/.cursor/`) — copies the plugin into
  `~/.cursor/plugins/local/creatio-ai-app-development-toolkit/`, installs the `clio` MCP server into
  `~/.cursor/mcp.json` (merging with any existing servers), and writes a
  `creatio-app-orchestrator.mdc` rule into `~/.cursor/rules/`.
- **GitHub Copilot CLI** (`~/.copilot/`) — preflights `copilot` in PATH, then runs
  `copilot plugin marketplace add <url>` and `copilot plugin install creatio-ai-app-development-toolkit@creatio`.
  Copilot manages the plugin on disk under `~/.copilot/installed-plugins/`. If a `creatio`
  marketplace already exists (e.g. from a prior local-install run), the installer runs
  `copilot plugin marketplace remove creatio --force` first so the source can switch to the public marketplace URL.

## Install from the terminal (advanced)

Tech users who already have Claude Code, Codex CLI, or GitHub Copilot CLI configured can register
the marketplace and install the plugin without running [install.py](../installer/install.py):

```bash
# Claude Code
claude plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
claude plugin install creatio-ai-app-development-toolkit@creatio

# Codex CLI
codex plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
codex plugin add creatio-ai-app-development-toolkit@creatio

# GitHub Copilot CLI
copilot plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
copilot plugin install creatio-ai-app-development-toolkit@creatio
```

Note that Codex still needs the `clio` MCP server in `~/.codex/config.toml` — the marketplace
install does not register it. Run `python installer/install.py --target codex` to add the
`[mcp_servers.clio]` block (and to apply the legacy-state cleanup the manual flow above does not
cover).

The terminal commands above do not configure the Cursor rule — for that, run
`python installer/install.py`.

## Installation

`install.py` runs from a plugin checkout — either a local clone or an extracted release zip. It does not clone the repository on its own.

### For end users — install from a release

Recommended path: use the Creatio installation wizard, which downloads the latest release asset, extracts it, runs `install.py`, and cleans up the temporary folder.

To do this manually:

1. Download `creatio-ai-app-development-toolkit-<version>.zip` from the [latest release](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/releases/latest) (asset attached by the release workflow).
2. Extract it to a temporary folder.
3. From the extracted folder, run:

   ```bash
   python installer/install.py
   ```

4. The extracted folder can be deleted after `install.py` completes — installed plugin copies are self-contained under each agent's home directory.

### For developers — install from a local checkout

```bash
git clone https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
cd creatio-ai-app-development-toolkit
python installer/install.py
```

The installer detects the current checkout as the install source via `.release-manifest.json` and the plugin manifests at the repository root.

### Common flags

Advanced users can install for only one agent with `--target <codex|claude|cursor|copilot>`.

When launched by the Creatio installation wizard, the wizard sets `CAADT_SETUP_WIZARD_MANIFEST=1`. In that mode, `install.py` writes a one-shot `~/.caadt/install-state.json` handoff file so the wizard can display which coding agents were configured, then the wizard deletes it. Manual `python installer/install.py` runs do not create that handoff file by default.

The installer does not use a registry, checksums, or a CAADT-owned scheduled updater in v1.
Claude Code marketplace auto-update is enabled separately through Claude's own marketplace settings.

## Release-pinned plugin source

The Claude, Copilot, and Codex marketplace manifests (`.claude-plugin/marketplace.json`,
`.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`) pin the plugin payload to
the `release` branch via `source.ref: "release"`. The `release` branch is a moving pointer that
the release workflow force-updates to the latest released SHA after `gh release create` succeeds.
Effect: `claude plugin install creatio-ai-app-development-toolkit@creatio`,
`codex plugin add creatio-ai-app-development-toolkit@creatio`, and the Copilot equivalent always
fetch the most-recent published release, never an unreleased commit on `main`.

The plugin `source.source: "url"` discriminator is the documented form for git-URL-backed
sources — see [Claude Code's plugin marketplaces docs](https://code.claude.com/docs/en/plugin-marketplaces.md)
and the production example in
[obra/superpowers-marketplace](https://github.com/obra/superpowers-marketplace/blob/main/.claude-plugin/marketplace.json)
(the `superpowers-dev` entry uses the same shape with `ref` to pin to a branch).

Three manifests, one schema: the repo ships the same `marketplace.json` content at
`.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, and
`.agents/plugins/marketplace.json`. This is because each CLI scans a different conventional path
inside a registered marketplace repo — `.claude-plugin/marketplace.json` is Claude Code's
canonical path, `.github/plugin/marketplace.json` is Copilot CLI's canonical path
([Copilot docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace),
matching the official [github/awesome-copilot](https://github.com/github/awesome-copilot/blob/main/.github/plugin/marketplace.json)
reference marketplace), and `.agents/plugins/marketplace.json` is Codex CLI's canonical path.
Copilot CLI also falls back to `.claude-plugin/marketplace.json`, but shipping the canonical path
explicitly avoids depending on fallback behavior. The schema is identical across the three CLIs,
so the `plugins[0]` block is the same in each — `scripts/bump-version.js` keeps the
`plugins[0].version` field in sync via `.version-bump.json`, and
`tests/test_release_structure.py` asserts all three manifests carry the same `source` block.

Cursor stays on the local file-copy install model and is not affected by the `release` branch pin.

### Testing unreleased changes through a marketplace agent

When you need to validate work-in-progress changes through Claude, Codex, or Copilot (not via the
Cursor file-copy path), the path is per-CLI native:

- **Claude Code** — register a second, dev-scoped marketplace pinned to your branch via the URL
  fragment, then install the plugin from it:
  ```bash
  claude plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git#<your-branch>
  claude plugin install creatio-ai-app-development-toolkit@<marketplace-name-chosen-by-claude>
  ```
  Uninstall and re-add the production `creatio` marketplace when done.
- **Codex CLI** — override the `ref` baked into `marketplace.json` with `--ref` on the marketplace
  add:
  ```bash
  codex plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git --ref <your-branch>
  codex plugin add creatio-ai-app-development-toolkit@creatio
  ```
  The `--ref` flag overrides the marketplace clone's tracked branch; the plugin payload then
  follows whatever `ref` is declared inside that branch's `marketplace.json`. Useful for
  fast-iteration dev work, but Cursor (file-copy) is preferred for the inner toolkit-itself
  loop because it picks up local edits without a commit.
- **GitHub Copilot CLI** — there is no native escape hatch (see
  [github/copilot-cli#1296](https://github.com/github/copilot-cli/issues/1296)). To test unreleased
  changes, fall back to the Cursor file-copy install from a local checkout of the working branch
  via `python installer/install.py --target cursor`.

Never push work-in-progress to the `release` branch — that branch is owned by the release workflow
and is the production install target for every Claude, Codex, and Copilot user.

### If you disabled Claude marketplace autoUpdate

`installer/install.py` enables `extraKnownMarketplaces.creatio.autoUpdate = true` so Claude
self-updates the plugin on each session start. If you have flipped this to `false` in
`~/.claude/settings.json`, run

```bash
claude plugin update creatio-ai-app-development-toolkit@creatio
```

manually to pick up new releases. The in-agent update notification and the unified `caadt update`
command both skip Claude by design, on the assumption that autoUpdate is on.
