# Install Creatio AI App Development Toolkit

This repository is the `creatio` plugin marketplace of the Creatio AI App Development Toolkit: four
plugins under `plugins/` (`creatio-core`, `creatio-app-builder`, `creatio-ui`, `creatio-migration`) and,
under the name `creatio-ai-app-development-toolkit`, one install that brings all of them. See
[`plugins/README.md`](../plugins/README.md) for what each plugin owns.

## Prerequisites

- `clio` must be installed and available in `PATH`.
- The target coding agent must support plugin installation, local skills, or MCP configuration.

## MCP

The `creatio-core` plugin includes `.mcp.json`, which starts the global clio MCP server:

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
[agent_cli.py](../installer/agent_cli.py), which `install.py` and `update.py` both import). How the
whole family gets installed depends on what the host supports:

| Host | Install unit | How every plugin arrives |
|---|---|---|
| Claude Code | `creatio-ai-app-development-toolkit@creatio` | a meta-plugin whose `dependencies` are the four plugins |
| GitHub Copilot CLI | `creatio-ai-app-development-toolkit@creatio` | one plugin whose `.github/plugin/plugin.json` lists every plugin's `skills/` and the core MCP declaration |
| Codex CLI | each of the four plugins | the installer materializes each plugin into the Codex cache |
| Cursor | one local plugin | a copy whose `.cursor-plugin/plugin.json` lists every plugin's `skills/`, the app-builder rules and the core MCP declaration |

Copilot and Cursor have no dependency mechanism, which is why they install the family through one
manifest. Every plugin is also installable on its own from the same catalogs (for example
`claude plugin install creatio-ui@creatio`, which brings `creatio-core` as its dependency); do not
combine the Copilot install of `creatio-ai-app-development-toolkit` with individual plugins, or each
skill loads twice.

Targets are auto-detected by the presence of their agent home directory (`~/.codex`, `~/.claude`,
`~/.cursor`, `~/.copilot`). Because every CLI-driven target needs its agent binary on PATH, a
leftover home directory whose CLI is gone (e.g. `~/.copilot` surviving an `npm uninstall -g` or a
PATH change) would otherwise abort the whole run. Instead, a failure on an *auto-detected* target is
isolated: the installer prints a warning, skips that target, and still installs the rest. The run
only exits non-zero when nothing installed. A target requested explicitly via `--target` still fails
hard, since the user asked for exactly that agent.

- **Claude Code** (`~/.claude/`) — preflights `claude` in PATH, then runs
  `claude plugin marketplace add <url>` and `claude plugin install creatio-ai-app-development-toolkit@creatio`,
  which also installs the four plugins the meta-plugin depends on.
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
  (tolerating "not found") and `codex plugin marketplace add <url>`. Codex CLI has no
  non-interactive plugin-install command (the interactive `/plugins` browser is the only documented
  path), so the installer performs the two steps that browser does for every plugin of the Codex
  catalog: it copies `plugins/<plugin>/` into `~/.codex/plugins/cache/creatio/<plugin>/<version>/` and
  writes `[plugins."<plugin>@creatio"] enabled = true` into `~/.codex/config.toml` — Codex loads
  plugin skills only when both exist. Supported Codex CLI: 0.130 or
  newer (verified on 0.130.0 and 0.153.4); Codex exposes no non-interactive install API the installer
  could call instead. Finally re-merges the `clio` MCP server block into `~/.codex/config.toml` — Codex CLI
  does not auto-promote plugin-bundled `.mcp.json` entries to user-level `[mcp_servers.*]`, so the
  installer keeps that registration.
- **Cursor** (`~/.cursor/`) — copies the release surface into
  `~/.cursor/plugins/local/creatio-ai-app-development-toolkit/`, whose root `.cursor-plugin/plugin.json`
  lists every plugin's skills; installs the `clio` MCP server into `~/.cursor/mcp.json` (merging with
  any existing servers); writes the `creatio-app-orchestrator.mdc` and `creatio-telemetry.mdc` rules
  into `~/.cursor/rules/`; and registers the telemetry hook in `~/.cursor/hooks.json`, replacing the
  entry that pointed at the same directory's root `hooks/` folder.
- **GitHub Copilot CLI** (`~/.copilot/`) — preflights `copilot` in PATH, then runs
  `copilot plugin marketplace add <url>` and `copilot plugin install creatio-ai-app-development-toolkit@creatio`.
  Copilot manages the plugin on disk under `~/.copilot/installed-plugins/` and loads the skills of
  every plugin through that plugin's `.github/plugin/plugin.json`. If a `creatio`
  marketplace already exists (e.g. from a prior local-install run), the installer runs
  `copilot plugin marketplace remove creatio --force` first so the source can switch to the public marketplace URL.

## Install from the terminal (advanced)

Tech users who already have Claude Code, Codex CLI, or GitHub Copilot CLI configured can register
the marketplace and install the plugin without running [install.py](../installer/install.py):

```bash
# Claude Code
claude plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
claude plugin install creatio-ai-app-development-toolkit@creatio

# Codex CLI — no non-interactive install verb: register the marketplace, then either pick the
# plugin in the `/plugins` browser inside Codex or let the installer materialize it.
codex plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
python installer/install.py --target codex

# GitHub Copilot CLI
copilot plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
copilot plugin install creatio-ai-app-development-toolkit@creatio
```

Note that Codex still needs the `clio` MCP server in `~/.codex/config.toml` — a marketplace
install does not register it. `python installer/install.py --target codex` adds the
`[mcp_servers.clio]` block, materializes the plugin cache and applies the legacy-state cleanup the
manual flow above does not cover.

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

Every entry of the Claude, Copilot, and Codex catalogs (`.claude-plugin/marketplace.json`,
`.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`) pins its payload to the
`release` branch via `source.ref: "release"`. The hosts read a catalog from the repository's default
branch, so an entry that resolved against the catalog's own checkout would install unreleased `main`
content. The `release` branch is a moving pointer that the release workflow force-updates to the
latest released SHA after `gh release create` succeeds. Effect: a Claude, Codex, or Copilot install
of any CAADT plugin always fetches the most-recent published release.

The plugin `source.source: "url"` discriminator is the documented form for git-URL-backed
sources — see [Claude Code's plugin marketplaces docs](https://code.claude.com/docs/en/plugin-marketplaces.md)
and the production example in
[obra/superpowers-marketplace](https://github.com/obra/superpowers-marketplace/blob/main/.claude-plugin/marketplace.json)
(the `superpowers-dev` entry uses the same shape with `ref` to pin to a branch).

Each CLI scans a different conventional path inside a registered marketplace repo —
`.claude-plugin/marketplace.json` is Claude Code's canonical path, `.github/plugin/marketplace.json`
is Copilot CLI's canonical path
([Copilot docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace),
matching the official [github/awesome-copilot](https://github.com/github/awesome-copilot/blob/main/.github/plugin/marketplace.json)
reference marketplace), and `.agents/plugins/marketplace.json` is Codex CLI's canonical path. The
source forms differ per host:

| Catalog | `creatio-ai-app-development-toolkit` | each of the four plugins |
|---|---|---|
| Claude | `url` + `ref: release` (the repository root: the meta-plugin) | `git-subdir` + `path: plugins/<plugin>` + `ref: release` |
| Copilot | `url` + `ref: release` (the repository root: the bundle manifest) | `github` + `path: plugins/<plugin>` + `ref: release` |
| Codex | — | `git-subdir` + `path: ./plugins/<plugin>` + `ref: release` |

`scripts/bump-version.js` keeps every `version` field in sync via `.version-bump.json`, and
`tests/test_release_structure.py` asserts these source blocks.

Cursor stays on the local file-copy install model and installs from the release zip it runs from.

### Testing unreleased changes through a marketplace agent

Every catalog entry fetches its payload from `release`, whichever branch the marketplace itself is
registered from, so a branch's unreleased plugin files reach an agent only from a local checkout or a
branch catalog whose entries name that branch in `ref`. The path is per-CLI native:

- **Claude Code** — load the plugins straight from your checkout for one session:
  ```bash
  claude --plugin-dir plugins/creatio-core --plugin-dir plugins/creatio-app-builder
  ```
  Or register a second, dev-scoped marketplace from your branch via the URL fragment after setting
  the `ref` of its catalog entries to that branch:
  ```bash
  claude plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git#<your-branch>
  claude plugin install creatio-ai-app-development-toolkit@<marketplace-name-chosen-by-claude>
  ```
  Uninstall and re-add the production `creatio` marketplace when done.
- **Codex CLI** — override the `ref` baked into `marketplace.json` with `--ref` on the marketplace
  add:
  ```bash
  codex plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git --ref <your-branch>
  ```
  then install the plugin from the `/plugins` browser inside Codex (Codex CLI has no
  non-interactive install command). The `--ref` flag overrides the marketplace clone's tracked
  branch; the plugin payload then follows whatever `ref` is declared inside that branch's
  `marketplace.json`. For local edits without a commit, run `python installer/install.py --target codex`
  from the branch checkout: it materializes the plugin cache from the local files, the same way the
  Cursor file-copy install does.
- **GitHub Copilot CLI** — mount the checkout for one session with the global `--plugin-dir`
  option (the repository root carries the bundle manifest):
  ```bash
  copilot --plugin-dir .
  ```

Never push work-in-progress to the `release` branch — that branch is owned by the release workflow
and is the production install target for every Claude, Codex, and Copilot user.

### If you disabled Claude marketplace autoUpdate

`installer/install.py` enables `extraKnownMarketplaces.creatio.autoUpdate = true` so Claude
self-updates the plugin on each session start. If you have flipped this to `false` in
`~/.claude/settings.json`, run

```bash
python installer/update.py --target claude
```

to pick up new releases. `claude plugin update creatio-ai-app-development-toolkit@creatio` on its own
updates the meta-plugin and nothing else: the four plugins stay at their old version, and a plugin a
new release adds to the meta-plugin's `dependencies` stays uninstalled, which keeps the meta-plugin
disabled. `update.py` therefore refreshes the marketplace catalog, then updates every installed
`creatio` plugin the listing names (`claude plugin list --json`) — the meta-plugin included, and only
when it is installed, so an individual install such as `claude plugin install creatio-ui@creatio`
updates too — and installs each dependency Claude reports as missing. Claude's own auto-update
installs missing dependencies too.

For GitHub Copilot CLI, `update.py` updates the single `creatio-ai-app-development-toolkit` plugin
that host installs the family as; individual Copilot plugins are updated with `copilot plugin update`
directly.

## Product telemetry: the floor hook per host

Telemetry has two tiers. Every stage of a workflow is reported by the agent, which is reliable
but not guaranteed — a skill-less run was measured reporting nothing. Underneath it, a hook
deterministically records one `workflow_started` per session (attributed to
`workflow=unattributed`, because a hook sees a tool name and cannot know the flow). That floor
is the denominator: without it there is no way to tell "few runs happened" from "runs happened
and went unreported".

The hook is `plugins/creatio-core/hooks/telemetry-routing.mjs`. It emits the floor through clio's own MCP tool, so it
needs `clio` on `PATH` and stored consent of `granted` — an `unknown` or `denied` decision makes
it silent, and it never prompts. `CAADT_TELEMETRY_HOOK_HOST` selects how the routing text is
handed back; the floor event itself is identical on every host.

The two identity fields resolve themselves, so nothing has to be configured for them to be right:
`plugin_version` is read from `.claude-plugin/plugin.json` beside the hook — that manifest IS the
installed version — and `coding_agent` follows `CAADT_TELEMETRY_HOOK_HOST`, because the host running
the hook is the coding agent. `CAADT_TELEMETRY_PLUGIN_VERSION` and `CAADT_TELEMETRY_AGENT` override
them for a non-standard layout. Neither is ever guessed: if a value cannot be resolved the field is
omitted, which clio accepts, rather than sent as `unknown` — a placeholder lands real runs in a
cohort that never existed, and one installation was measured reporting five versions, four invented.

| Host | Wired by | Floor | Routing text |
| --- | --- | --- | --- |
| Claude Code | the plugin manifest — nothing to do | yes | `hookSpecificOutput.additionalContext` |
| Cursor | `installer/install.py` writes `~/.cursor/hooks.json` | yes | **not possible** — `afterMCPExecution` is informational and reaches neither the user nor the agent, so the always-applied `creatio-telemetry` rule carries the routing instead |

Cursor's `afterMCPExecution` payload names the session `conversation_id` and passes `tool_input` as a
JSON string rather than an object ([Cursor hooks](https://cursor.com/docs/agent/hooks)), so the hook
normalizes both before anything reads them — without that the Cursor floor never fired at all. Cursor
also states the `model` in the payload, which is where it is read from on that host.
| Codex | manual, see below | yes | `systemMessage` |
| Copilot CLI | manual, see below | yes | not verified — the hook stays silent rather than emit a guessed shape |

### Codex

Codex hooks are off by default and marked under development, so enabling them is your decision,
not the installer's. Opt in, then register the hook, in `~/.codex/config.toml`:

```toml
[features]
codex_hooks = true

[[hooks.PostToolUse]]
matcher = "mcp__.*clio.*"
command = ["node", "<plugin-root>/hooks/telemetry-routing.mjs"]
env = { CAADT_TELEMETRY_HOOK_HOST = "codex" }
```

### Copilot CLI

Copilot loads hooks from the repository you are working in (`.github/hooks/`), not from an
installed plugin, so this one is per-repository and the installer cannot place it for you. Copy
the hook next to a config that points at it:

```json
{ "events": ["postToolUse"],
  "match": { "tool": "mcp__.*clio.*" },
  "bash":       { "command": "CAADT_TELEMETRY_HOOK_HOST=copilot node .github/hooks/telemetry-routing.mjs" },
  "powershell": { "command": "$env:CAADT_TELEMETRY_HOOK_HOST='copilot'; node .github/hooks/telemetry-routing.mjs" } }
```

Both keys are needed for cross-OS use. Hook event names and matcher syntax evolve — check the
host's current hook documentation before relying on these snippets.
