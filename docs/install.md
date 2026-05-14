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

- **GitHub Copilot CLI** (`~/.copilot/`) — registers this checkout as a local Copilot marketplace with `copilot plugin marketplace add <repo-root>` and installs `creatio-ai-app-development-toolkit@creatio` through the native Copilot plugin flow. Copilot then materializes the installed plugin under `~/.copilot/installed-plugins/`, exposes the skill automatically, and keeps `clio` MCP available through the plugin install.

## Simple Installer

The v1 installer clones or downloads this repository and configures supported local agents.
After the installer is published at the hosted ADAC installer URL, users should run the no-flag bootstrap command:

```bash
curl -fsSL <hosted-adac-install-url>/install.py | python3
```

Until that hosted URL is available, run the installer from a local checkout:

```bash
python installer/install.py
```

When launched from `installer/install.py` inside a plugin checkout, the installer uses that checkout as the install source. Use `--install-root <path>` only when you want to install from another checkout directory.

Advanced users can install for only one agent with `--target <codex|claude|cursor|copilot>`.

The installer does not use a registry, release tarballs, checksums, or scheduled auto-update in v1.
