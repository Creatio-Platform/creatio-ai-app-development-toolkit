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

For Claude Code and GitHub Copilot CLI the installer registers ADAC as a remote plugin marketplace
served from the public Git repository (`MARKETPLACE_GIT_URL` in [install.py](../installer/install.py))
and installs `creatio-ai-app-development-toolkit@creatio` through the host CLI. The CLI manages the
plugin payload on disk; the installer does not copy or overlay files into the host's plugin tree.

Codex CLI and Cursor remain on the local file-copy install model.

- **Claude Code** (`~/.claude/`) — preflights `claude` in PATH, then runs
  `claude plugin marketplace add <url>` and `claude plugin install creatio-ai-app-development-toolkit@creatio`.
  Patches `~/.claude/settings.json` to set `extraKnownMarketplaces.creatio.autoUpdate = true` so the
  marketplace and plugin auto-update on Claude Code startup (third-party marketplaces are otherwise
  off by default). Skills ship inside the plugin payload, so the CLI-managed install exposes them
  directly; the installer does not mirror skills into `~/.agents/skills/` for Claude.
- **Codex CLI/Desktop** (`~/.codex/`) — copies the ADAC plugin runtime into
  `~/.codex/plugins/marketplaces/creatio/` and `~/.codex/plugins/cache/creatio/creatio-ai-app-development-toolkit/<version>/`,
  installs the local plugin surface into `~/.agents/plugins/creatio-ai-app-development-toolkit/`,
  registers the personal marketplace entry, and registers the `clio` MCP server in
  `~/.codex/config.toml`. Codex requires a self-contained `plugins/<plugin>/` subdirectory layout
  inside the marketplace (skills, `.mcp.json`, and `.codex-plugin/plugin.json` all inside the plugin
  root). Until the repo provides that mirror, Codex installs from the local checkout rather than
  the remote marketplace.
- **Cursor** (`~/.cursor/`) — copies the plugin into
  `~/.cursor/plugins/local/creatio-ai-app-development-toolkit/`, installs the `clio` MCP server into
  `~/.cursor/mcp.json` (merging with any existing servers), and writes a
  `creatio-app-orchestrator.mdc` rule into `~/.cursor/rules/`.
- **GitHub Copilot CLI** (`~/.copilot/`) — preflights `copilot` in PATH, then runs
  `copilot plugin marketplace add <url>` and `copilot plugin install creatio-ai-app-development-toolkit@creatio`.
  Copilot manages the plugin on disk under `~/.copilot/installed-plugins/`. If a `creatio`
  marketplace already exists (e.g. from a prior local-install run), the installer runs
  `copilot plugin marketplace remove creatio --force` first so the source can switch to the GHE URL.

## Install from the terminal (advanced)

Tech users who already have Claude Code or GitHub Copilot CLI configured can register the
marketplace and install the plugin without running [install.py](../installer/install.py):

```bash
# Claude Code
claude plugin marketplace add https://creatio.ghe.com/engineering/ai-driven-app-creation.git
claude plugin install creatio-ai-app-development-toolkit@creatio

# GitHub Copilot CLI
copilot plugin marketplace add https://creatio.ghe.com/engineering/ai-driven-app-creation.git
copilot plugin install creatio-ai-app-development-toolkit@creatio
```

For Codex use the installer (`python installer/install.py --target codex`) — the remote marketplace
flow is not yet supported for Codex because of a marketplace layout requirement (see the Codex
bullet above).

The terminal commands above do not configure the `clio` MCP server or the Cursor rule — for those,
run `python installer/install.py`.

## Installation

`install.py` runs from a plugin checkout — either a local clone or an extracted release zip. It does not clone the repository on its own.

### For end users — install from a release

Recommended path: use the Creatio installation wizard, which downloads the latest release asset, extracts it, runs `install.py`, and cleans up the temporary folder.

To do this manually:

1. Download `creatio-ai-app-development-toolkit-<version>.zip` from the [latest release](https://creatio.ghe.com/engineering/ai-driven-app-creation/releases/latest) (asset attached by the release workflow).
2. Extract it to a temporary folder.
3. From the extracted folder, run:

   ```bash
   python installer/install.py
   ```

4. The extracted folder can be deleted after `install.py` completes — installed plugin copies are self-contained under each agent's home directory.

### For developers — install from a local checkout

```bash
git clone https://creatio.ghe.com/engineering/ai-driven-app-creation.git
cd ai-driven-app-creation
python installer/install.py
```

The installer detects the current checkout as the install source via `.release-manifest.json` and the plugin manifests at the repository root.

### Common flags

Advanced users can install for only one agent with `--target <codex|claude|cursor|copilot>`.

When launched by the Creatio installation wizard, the wizard sets `CAADT_SETUP_WIZARD_MANIFEST=1`. In that mode, `install.py` writes a one-shot `~/.caadt/install-state.json` handoff file so the wizard can display which coding agents were configured, then the wizard deletes it. Manual `python installer/install.py` runs do not create that handoff file by default.

The installer does not use a registry, checksums, or an ADAC-owned scheduled updater in v1.
Claude Code marketplace auto-update is enabled separately through Claude's own marketplace settings.
