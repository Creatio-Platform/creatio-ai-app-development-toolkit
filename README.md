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

Recommended for end users: install through the Creatio installation wizard, which downloads the latest release asset, runs `install.py`, and cleans up. See [docs/install.md](docs/install.md) for the wizard flow and setup-wizard behavior.

Install from a local checkout (developers):

```bash
python installer/install.py
```

To install for only one agent, use `--target` with one of `codex`, `claude`, `cursor`, or `copilot`.

Tech users who already have Claude Code or GitHub Copilot CLI in PATH can register the remote
marketplace directly (Codex stays on the installer-managed local install — see
[docs/install.md](docs/install.md)):

```bash
claude plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
claude plugin install creatio-ai-app-development-toolkit@creatio
copilot plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
copilot plugin install creatio-ai-app-development-toolkit@creatio
```

See [docs/install.md](docs/install.md) for release zip installation and agent-specific install details.

## Updates

CAADT relies on each agent's native plugin update mechanism.

For a single command that updates every detected agent in one shot, run the manual updater:

```bash
python installer/update.py
```

It downloads the latest public release, extracts it to a temp directory, and delegates to that release's `installer/install.py` for each installed agent. Run it from a plain terminal after exiting any agent session — updating an agent rewrites the plugin directory the running session holds. Options:

- `--target {codex,cursor,copilot}` — update only one agent.
- `--source <dir>` — update from a local checkout/extract instead of downloading.
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

Support mode, troubleshooting reporting, runtime helper details, and contributor-facing workflow rules are intentionally not duplicated here. Use the source-of-truth documents above when working on those areas.
