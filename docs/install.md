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

The installer detects and configures these locally:

- **Codex CLI/Desktop** (`~/.codex/`) — copies the ADAC plugin runtime into `~/.codex/plugins/marketplaces/creatio/` and `~/.codex/plugins/cache/creatio/creatio-ai-app-development-toolkit/<version>/`, installs the local plugin surface into `~/.agents/plugins/creatio-ai-app-development-toolkit/`, registers the personal marketplace entry, and registers the `clio` MCP server in `~/.codex/config.toml`.
- **Claude Code** (`~/.claude/`) — copies the ADAC marketplace into `~/.claude/plugins/marketplaces/creatio/`, copies the plugin cache into `~/.claude/plugins/cache/creatio/creatio-ai-app-development-toolkit/<version>/`, copies ADAC skills into `~/.agents/skills/`, copies MCP config into `~/.claude/adac.mcp.json`, registers the marketplace in `~/.claude/plugins/known_marketplaces.json`, registers the installed plugin in `~/.claude/plugins/installed_plugins.json`, and enables `creatio-ai-app-development-toolkit@creatio` in `~/.claude/settings.json`.
- **Cursor** (`~/.cursor/`) — copies the plugin into `~/.cursor/plugins/local/creatio-ai-app-development-toolkit/`, installs the `clio` MCP server into `~/.cursor/mcp.json` (merging with any existing servers), and writes a `creatio-app-orchestrator.mdc` rule into `~/.cursor/rules/`.

- **GitHub Copilot CLI** (`~/.copilot/`) — registers this checkout as a local Copilot marketplace with `copilot plugin marketplace add <repo-root>` and installs `creatio-ai-app-development-toolkit@creatio` through the native Copilot plugin flow. The installer then overlays the self-contained ADAC runtime into `~/.copilot/installed-plugins/creatio/creatio-ai-app-development-toolkit/` and rewrites the Copilot skill entry under `~/.copilot/skills/creatio-app-orchestrator/` so it points to the installed plugin copy instead of the source checkout. This keeps the Copilot installation usable after the original ADAC repository checkout is deleted.

## Installation

`install.py` runs from a plugin checkout — either a local clone or an extracted release zip. It does not clone the repository on its own.

### For end users — install from a release

Recommended path: use the Creatio installation wizard, which downloads the latest release asset, extracts it, runs `install.py`, and cleans up the temporary folder.

To do this manually:

1. Download `adac-<version>.zip` from the [latest release](https://creatio.ghe.com/engineering/ai-driven-app-creation/releases/latest) (asset attached by the release workflow).
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

The installer does not use a registry, checksums, or scheduled auto-update in v1.
