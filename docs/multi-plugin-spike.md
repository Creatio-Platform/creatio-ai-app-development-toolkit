# Multi-plugin marketplace spike (ENG-96688)

Branch `spike/multi-plugin`, executed 2026-09-07 on Windows 11. Nothing here is meant to merge: the branch
copies (does not move) two skills into `plugins/` so the three host CLIs can be exercised against a
marketplace that serves several plugins from one repository. The findings feed sub-tasks ENG-96689 to
ENG-96692 (CAADT) and ENG-96693 (ADDK).

## What was built

```
plugins/
  creatio-core/                     skills/{creatio-schema-naming, creatio-ui-guidelines}, context/, hooks/, .mcp.json
                                    + .claude-plugin/ .codex-plugin/ .cursor-plugin/ .github/plugin/ manifests (hooks kept)
  creatio-ui/                       skills/creatio-branding-orchestrator
                                    + the same four manifests; Claude manifest declares "dependencies": ["creatio-core"]
  creatio-ai-app-development-toolkit/
                                    .claude-plugin/plugin.json only — a meta-plugin with
                                    "dependencies": ["creatio-core", "creatio-ui"] and no components
.claude-plugin/marketplace.json     3 entries, "source": "./plugins/<name>"
.agents/plugins/marketplace.json    2 entries, {"source": "local", "path": "./plugins/<name>"}
.github/plugin/marketplace.json     2 entries, "source": "./plugins/<name>"
```

Root `skills/`, `context/`, `hooks/` and the root `plugin.json` files were left untouched, so the repository still
installs as the 1.10.0 single plugin from the `release` branch.

## Host versions

| Host | Version |
|---|---|
| Claude Code | 2.1.263 |
| Codex CLI | 0.130.0 |
| GitHub Copilot CLI | 1.0.46 |

Every install below ran in an isolated config so the machine's real plugins were not touched:
`CLAUDE_CONFIG_DIR=<tmp>` for Claude, `CODEX_HOME=<tmp>` for Codex, `HOME`+`USERPROFILE=<tmp>` for Copilot
(Copilot has no dedicated variable; it resolves `~/.copilot` from the home directory).

## Results

### Claude Code

| Check | Command | Result |
|---|---|---|
| Add marketplace from a local clone | `claude plugin marketplace add C:\...\creatio-ai-app-development-toolkit` | added as `creatio` |
| Install a subdirectory plugin | `claude plugin install creatio-core@creatio` | installed, cached under `plugins/cache/creatio/creatio-core/2.0.0/` |
| Second subdirectory plugin | `claude plugin install creatio-ui@creatio` | installed |
| Dependency resolution | fresh config, `claude plugin install creatio-ui@creatio` only | `Successfully installed ... (+ 1 dependency: creatio-core)` |
| Meta-plugin | fresh config, `claude plugin install creatio-ai-app-development-toolkit@creatio` | `(+ 2 dependencies: creatio-core, creatio-ui)`; three plugins listed |
| Hooks survive the move | the cached `creatio-core/.claude-plugin/plugin.json` keeps the three telemetry hook entries with `${CLAUDE_PLUGIN_ROOT}` | yes |
| Hook executes from the plugin location | `node <cache>/hooks/telemetry-routing.mjs` fed `UserPromptSubmit` and `PostToolUse` payloads with `CLAUDE_PLUGIN_ROOT` set to the cache path | exit 0 both |
| Skill namespacing in a live session | `claude -p --plugin-dir plugins/creatio-core --plugin-dir plugins/creatio-ui` and asked for the skill list | `creatio-core:creatio-schema-naming`, `creatio-core:creatio-ui-guidelines`, `creatio-ui:creatio-branding-orchestrator` |
| Same skill name from two plugins | the machine also has 1.10.0 installed | **both are listed**: `creatio-ai-app-development-toolkit:creatio-ui-guidelines` next to `creatio-core:creatio-ui-guidelines`, same for schema-naming and branding. No de-duplication. |
| Same plugin from two marketplaces | second marketplace `creatio-test` with identical `plugins/`, `claude plugin install creatio-core@creatio-test` | installed alongside `creatio-core@creatio`; both enabled; both skill trees loaded |
| Uninstall | `claude plugin uninstall creatio-ui@creatio` | removed; prints `1 auto-installed dependency no longer needed: creatio-core. Run claude plugin prune` |
| Leftovers | after uninstalling everything and `marketplace remove creatio` | `plugins/cache/creatio/*` stays on disk with an `.orphaned_at` marker; `installed_plugins.json` is empty |

### GitHub Copilot CLI

| Check | Command | Result |
|---|---|---|
| Add marketplace from a local clone | `copilot plugin marketplace add C:\...\creatio-ai-app-development-toolkit` | added as `creatio` |
| Catalog browse | `copilot plugin marketplace browse creatio` | lists `creatio-core` and `creatio-ui` with their descriptions |
| Install | `copilot plugin install creatio-core@creatio` / `creatio-ui@creatio` | `Installed 2 skills` / `Installed 1 skill`; copied to `~/.copilot/installed-plugins/creatio/<plugin>/` (whole plugin directory, all four manifests included) |
| Same plugin from two marketplaces | `copilot plugin install creatio-core@creatio-test` | installed alongside; `plugin list` shows three entries; both `creatio-core` skill trees present on disk |
| Uninstall | `copilot plugin uninstall creatio-core@creatio-test` | removed cleanly, directory gone |
| Live session | `copilot -p ... --plugin-dir ...` | **not verifiable on this machine**: the org Copilot policy denies non-interactive access (`Access denied by policy settings`). Install mechanics are proven; skill presentation inside a session is not. |

### Codex CLI

| Check | Command | Result |
|---|---|---|
| Add marketplace from a local clone | `codex plugin marketplace add C:\...\creatio-ai-app-development-toolkit` | `Added marketplace creatio`; `config.toml` gets `[marketplaces.creatio] source_type = "local"` |
| Second marketplace | `codex plugin marketplace add <creatio-test dir>` | added |
| Install a plugin | `codex plugin add ...` / `codex plugin install ...` | **the subcommands do not exist in 0.130.0** (`codex plugin` offers only `marketplace` and `help`). Plugins are enabled through `config.toml`: `[plugins."creatio-core@creatio"] enabled = true`, which is how the machine's real config enables OpenAI's own plugins. The TUI `/plugins` flow writes the same section. |
| `codex plugin marketplace upgrade creatio` | | `Error: marketplace creatio is not configured as a Git marketplace` — expected for a local source; a URL-added marketplace is upgradable |
| Live session | `codex exec` with `-c` overrides | **not verifiable on this machine**: the Codex refresh token is revoked (`codex login` needed). |

### Install from the pushed remote branch

| Host | Command | Result |
|---|---|---|
| Claude Code | `claude plugin marketplace add Creatio-Platform/creatio-ai-app-development-toolkit#spike/multi-plugin`, then `claude plugin install creatio-ai-app-development-toolkit@creatio` | clone + validation OK; meta-plugin installed with `+ 2 dependencies`; `known_marketplaces.json` records `{"source":"github","repo":...,"ref":"spike/multi-plugin"}` |
| Codex CLI | `codex plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git --ref spike/multi-plugin` | cloned to `$CODEX_HOME/.tmp/marketplaces/creatio` with `plugins/creatio-core` present; `codex plugin marketplace upgrade creatio` works for a git marketplace |
| Copilot CLI | `copilot plugin marketplace add <owner/repo or URL>` | **no way to pass a ref**: `owner/repo#ref` is treated as a local path, `URL#ref` is sent to GitHub verbatim and fails. Direct installs `owner/repo:plugins/creatio-core` read the default branch too (`Plugin path does not exist in repository`). Copilot always reads the catalog from the repository's default branch. |

Consequence for ENG-96691: the Copilot catalog `.github/plugin/marketplace.json` on `main` must always be valid, and its
entries should point at the released payload explicitly with `{"source": "github", "repo": "Creatio-Platform/creatio-ai-app-development-toolkit", "ref": "release", "path": "plugins/<name>"}` rather than a relative `./plugins/<name>` — exactly what the 1.10.0 catalog already does for the root plugin (`url` + `ref: release`). A relative path would install whatever is on `main` at that moment. Claude and Codex accept either form; using the same `github`/`git-subdir` + `ref: release` objects in all three catalogs keeps the payload pinned to the `release` branch on every host.

### Existing test suite on this branch

`python -m pytest tests` → 636 passed, 7 skipped, **3 failed**, all three encode the single-plugin release
structure and are the input for ENG-96691:

- `test_release_structure.py::test_marketplace_catalogs_point_to_plugin` expects `plugins[0].name ==
  "creatio-ai-app-development-toolkit"` in every catalog.
- `test_release_structure.py::test_public_trigger_text_uses_general_creatio_app_wording` requires the
  phrase "creatio app" in every public manifest (fixed on this branch by wording the catalog description
  accordingly).
- `test_version_bump.py::test_repo_versions_are_in_sync` compares the root `plugin.json` versions (1.10.0)
  against the catalog versions (2.0.0). With several plugins the check has to iterate `plugins/*/`.

## Go / no-go

**Go**, with four adjustments to the plan.

1. **Multi-plugin catalogs from one repository work on all three hosts.** Relative `./plugins/<name>`
   entries are enough for Claude and Copilot; Codex needs `{"source": "local", "path": ...}`. Nothing in
   the plugin content had to change — the copied skills, context, hooks and `.mcp.json` installed as-is.
2. **Claude `dependencies` and the meta-plugin work as documented.** Installing `creatio-ui` alone pulls
   `creatio-core`; the meta-plugin pulls the whole family. Uninstall is dependency-aware (`prune`).
   The meta-plugin must live in its own directory (`plugins/creatio-ai-app-development-toolkit/`) as long
   as the repository root still has a `skills/` directory: a plugin rooted at `./` would auto-discover
   every root skill and re-create the duplication the split is meant to remove. Once ENG-96689 removes the
   root `skills/`, the meta-plugin can move back to the root manifest; until then keep it in `plugins/`.
3. **Double installation is real on Claude and Copilot, and Claude shows both copies to the model.** The
   same plugin from two marketplaces, or the same skill name from two plugins, coexists under separate
   namespaces and both skill bodies are loaded. This confirms the ADDK rule: **never re-export CAADT
   plugins in the ADDK catalog**, and the ADDK migration (ENG-96694) must delete its copies in the same
   release in which it starts depending on `creatio-core`, otherwise users see
   `ai-driven-development-kit:creatio-ui-guidelines` next to `creatio-core:creatio-ui-guidelines`.
   The Installer Hub (ENG-96695) must refuse to install a plugin name that is already installed from a
   different marketplace.
4. **Codex has no CLI install verb.** `installer/install.py::install_codex` calls
   `codex plugin add <plugin>@<marketplace>`, which 0.130.0 rejects. ENG-96692 has to write the
   `[plugins."<name>@creatio"] enabled = true` sections into `config.toml` itself (the installer already
   edits that file for MCP servers) or drive the documented TUI flow. This is also a live bug for the
   current 1.10.0 installer on Codex 0.130 and deserves its own ticket.

Copilot's catalog is read from the default branch only (see "Install from the pushed remote branch"), so the spike catalog could not be exercised remotely on Copilot; the local-path install covers the same code path minus the clone.

Two checks could not be completed on this machine and should be repeated by someone with working
Codex and Copilot sessions: that the skills of `creatio-core` appear in a live Codex session after enabling
the plugin in `config.toml`, and how Copilot presents namespaced skills in a session.

Operational notes for the next sub-tasks:

- Claude caches every installed version under `plugins/cache/<marketplace>/<plugin>/<version>/` and leaves
  the directory after uninstall (`.orphaned_at`). The updater in ENG-96692 should not rely on the cache
  being empty.
- Copilot copies the whole plugin directory, including the other hosts' manifests. Harmless, but the
  per-plugin zip in ENG-96691 may exclude foreign manifests if size matters.
- Claude's `--plugin-dir <path>` loads an uninstalled plugin for one session and is the fastest way to test
  a plugin directory without touching any marketplace.

## Reproduce

```powershell
# isolated homes
$env:CLAUDE_CONFIG_DIR = "C:\tmp\spike\claude"
$env:CODEX_HOME        = "C:\tmp\spike\codex"
$src = "C:\path\to\creatio-ai-app-development-toolkit"   # checkout of spike/multi-plugin

claude plugin marketplace add $src
claude plugin install creatio-ui@creatio                 # pulls creatio-core as a dependency
claude plugin install creatio-ai-app-development-toolkit@creatio
claude plugin list

codex plugin marketplace add $src
Add-Content "$env:CODEX_HOME\config.toml" "`n[plugins.""creatio-core@creatio""]`nenabled = true`n"

$env:HOME = "C:\tmp\spike\copilot"; $env:USERPROFILE = $env:HOME
copilot plugin marketplace add $src
copilot plugin install creatio-core@creatio
copilot plugin install creatio-ui@creatio
copilot plugin list

# live session on Claude without installing anything
claude -p --plugin-dir "$src\plugins\creatio-core" --plugin-dir "$src\plugins\creatio-ui" "list your skills"
```
