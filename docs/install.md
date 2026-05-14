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

- **Codex CLI/Desktop** (`~/.codex/`) — copies ADAC skills into `~/.codex/skills/` and registers the `clio` MCP server in `~/.codex/config.toml`. Current Codex Desktop plugin browsing is limited to OpenAI-curated plugins, so ADAC is not expected to appear in that UI.
- **Claude Code** (`~/.claude/`) — copies the ADAC marketplace into `~/.claude/plugins/marketplaces/creatio/`, registers it in `~/.claude/settings.json`, and enables `creatio-ai-app-development-toolkit@creatio`.
- **Cursor** (`~/.cursor/`) — copies the plugin into `~/.cursor/plugins/local/creatio-ai-app-development-toolkit/`, installs the `clio` MCP server into `~/.cursor/mcp.json` (merging with any existing servers), and writes a `creatio-app-orchestrator.mdc` rule into `~/.cursor/rules/`.

GitHub Copilot CLI remains a compatible manual target through `.github/plugin/plugin.json` and `.github/plugin/marketplace.json`, but the v1 installer does not call a Copilot plugin install command because no stable CLI subcommand is verified.

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

Advanced users can install for only one agent with `--target <codex|claude|cursor>`.

The installer does not use a registry, release tarballs, checksums, or scheduled auto-update in v1.
