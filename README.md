# Creatio AI App Development Toolkit

AI-driven toolkit for turning natural-language Creatio app requests into BA-style Business Plans, Technical Implementation Handoffs, and implementation-ready guidance for clio MCP execution.

The toolkit is installed as a local plugin or skill surface for coding agents. It keeps the workflow business-first: clarify the app request, produce the Business Plan, wait for approval, then implement through clio MCP using the approved plan.

Installer-supported agents: Codex CLI/Desktop, Claude Code, Cursor, and GitHub Copilot CLI.
Other MCP-capable agents can use the repository manually if they can read the same instructions and connect to clio MCP.

## Quick Start

Prerequisites:

- An AI coding agent supported by the installer, or another MCP-capable coding agent for manual use.
- [clio](https://github.com/Advance-Technologies-Foundation/clio) installed and available in `PATH`.
- Access to a running Creatio instance for implementation after Business Plan approval.

There are three ways to install — pick one.

### Install with the wizard (recommended for end users)

Install through the Creatio installation wizard, which downloads the latest release asset, runs `install.py`, and cleans up. See [docs/install.md](docs/install.md) for the wizard flow and setup-wizard behavior.

### Install from a local checkout (developers)

```bash
python installer/install.py
```

To install for only one agent, use `--target` with one of `codex`, `claude`, `cursor`, or `copilot`.

### Register the remote marketplace (tech users)

If you already have Claude Code, Codex CLI, or GitHub Copilot CLI on `PATH`, register the marketplace and install the plugin directly — run the pair for your agent:

**Claude Code**

```bash
claude plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
claude plugin install creatio-ai-app-development-toolkit@creatio
```

**Codex**

```bash
codex plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
codex plugin add creatio-ai-app-development-toolkit@creatio
```

**GitHub Copilot CLI**

```bash
copilot plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
copilot plugin install creatio-ai-app-development-toolkit@creatio
```

Codex additionally needs the `clio` MCP server registered in `~/.codex/config.toml` — run
`python installer/install.py --target codex` once to add it. See [docs/install.md](docs/install.md)
for release-zip installation and agent-specific install details.

## Updates

CAADT updates each agent through that agent's native plugin update command when one is available. There are two ways to update — pick one.

### Update via native plugin commands

If you registered the remote marketplace directly (Claude Code, Codex CLI, or GitHub Copilot CLI), update the same way — refresh the marketplace catalog, then update the plugin. The refresh is required: a bare update resolves against the cached catalog and no-ops if it looks current. Run the pair for your agent:

**Claude Code**

```bash
claude plugin marketplace update creatio
claude plugin update creatio-ai-app-development-toolkit@creatio
```

**Codex**

```bash
codex plugin marketplace upgrade creatio
codex plugin add creatio-ai-app-development-toolkit@creatio
```

**GitHub Copilot CLI**

```bash
copilot plugin marketplace update creatio
copilot plugin update creatio-ai-app-development-toolkit@creatio
```

Cursor has no native update command — update it with the manual updater below.

### Update every agent in one shot

```bash
python installer/update.py
```

Each agent with a native update command is updated in place (its catalog is refreshed, then the plugin is updated). If an agent has no native update command, it is reinstalled from the latest release, which the updater downloads on demand — agents are otherwise updated from their own marketplace, so nothing is downloaded unless a reinstall is needed. Run it from a plain terminal after exiting any agent session — updating an agent rewrites the plugin directory the running session holds. Options:

- `--target {codex,claude,cursor,copilot}` — update only one agent.
- `--source <dir>` — reinstall from a local checkout/extract instead of downloading (used for agents without a native update command).
- `--silent` — suppress output and exit non-zero on failure.

A network or release-fetch failure exits non-zero without touching installed agents, so the main CAADT workflow keeps working on the previously installed version.

## Main Workflow

The normal user-facing flow is:

1. Developer describes the Creatio app or feature in natural language.
2. Agent summarizes what it understood and asks only the highest-priority business questions.
3. Agent drafts the BA-style Business Plan and Technical Implementation Handoff inline in the conversation.
4. Developer approves the Business Plan in natural language.
5. Agent collects runtime blockers, resolves the target environment, and implements through clio MCP.

Business discovery tracks whether checklist inputs are `confirmed` or `assumed`; assumptions must be visible in the approval context.

## Where Rules Live

Use the repository docs by responsibility:

- `AGENTS.md` defines orchestration policy, approvals, support mode, and business invariants.
- `runbooks/` defines the stage-specific workflow for environment setup and requirements gathering.
- `context/INDEX.md` is the navigation hub for the remaining context files (naming conventions, clio CLI reference, model discovery evidence). Start there to find the smallest supporting context file for the current task.
- `context/business-checklist.md` defines the Business Plan checklist and `confirmed` / `assumed` source tracking.

Executable MCP contract is authoritative only in `clio MCP` through `get-tool-contract`.
Repository docs do not define clio tool parameter or response shapes.

## More Documentation

- [Install guide](docs/install.md)
- [Release packaging](docs/release-structure.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

Support mode, troubleshooting reporting, runtime helper details, and contributor-facing workflow rules are intentionally not duplicated here. Use the source-of-truth documents above when working on those areas.
