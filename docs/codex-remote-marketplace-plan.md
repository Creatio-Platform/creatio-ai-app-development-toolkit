# Codex Remote Marketplace Migration Plan

## Goal

Move Codex from the local file-copy install path to the remote marketplace flow, with **full parity
to the Claude/Copilot pattern** delivered in ENG-90475. After this lands, `install_codex` is a
near-clone of `install_claude` (single CLI call + a few cleanup steps + clio MCP merge), and the
Codex marketplace pins the plugin payload to the `release` branch via the same `source.url + ref`
manifest shape as Claude/Copilot.

## Spike Findings (Codex CLI 0.131.0, 2026-05-31)

A spike on the throwaway branch `spike/eng-90514-codex-remote-mp` resolved the four planned
unknowns plus surfaced one critical new one (P5). All findings verified against a real Codex CLI
0.131.0 install on Windows.

### P1 — Source shape in `.agents/plugins/marketplace.json`

Two shapes were tested:

**Shape A (`source: "local", path: "./plugins/<name>"`)** — works but requires:
- A committed mirror directory at `plugins/creatio-ai-app-development-toolkit/` holding the plugin
  payload.
- `--ref release` on every `codex plugin marketplace add` invocation (manual or scripted),
  otherwise Codex pulls `main` where marketplace.json's `path` resolves to old/wrong content.

**Shape B (`source: "url", url: <git>, ref: "release"`)** — works **without any mirror**:
- The marketplace clone tracks `main` (where `marketplace.json` lives).
- On `codex plugin add`, Codex separately fetches the plugin payload at the `ref` declared in the
  plugin source — same two-clones-on-disk pattern as Claude/Copilot.
- The plugin payload is the **whole repository root**: `.codex-plugin/plugin.json` at root is the
  manifest; `skills/` at root is the plugin's skill tree; `.mcp.json` at root is the plugin's MCP
  declaration.
- No `plugins/<name>/` subdirectory needed in the repo.

**Decision: Shape B.** It removes the entire mirror/sync/CI-gate/version-bump-integration apparatus
that the earlier draft of this plan proposed, and gives full architectural parity with Claude and
Copilot.

### P2 — Skill exposure

After `codex plugin add` succeeds, the plugin's `skills/creatio-app-orchestrator/SKILL.md` is
accessible to Codex directly from the plugin payload cache
(`~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/skills/...`). Codex does **not** create a
parallel `~/.codex/skills/<name>/` mirror, and the marker on the marketplace listing reads
`(installed, enabled)` — the same shape as the bundled `browser` and `latex` plugins.

**Decision: drop the skill mirror.** Remove `render_codex_skill` and the `write_rendered_skill`
call for Codex from `install.py` — parallel to commit `46fdf49` for Claude.

### P3 — Plugin MCP auto-registration

`codex plugin add` does **not** merge the plugin's `.mcp.json` entries into the user's
`~/.codex/config.toml`. The plugin's MCP declaration lives only inside the plugin payload and is
not promoted to a top-level `[mcp_servers.*]` section.

**Decision: keep `merge_codex_mcp_config`.** clio is a shared MCP server, registered globally in
`config.toml` independent of the plugin install model. The install.py function that merges the
`clio` block into `config.toml` stays as-is.

### P4 — Re-registering an existing marketplace

Codex CLI errors on `marketplace add` when a marketplace with the same name is already registered
with a different source:

```
Error: marketplace 'creatio' is already added from a different source; remove it before adding this source
```

`codex plugin marketplace remove <name>` removes both the config entry and the on-disk clone, and
exits 0 cleanly. There is no `--force` flag, and none is needed.

**Decision:** the existing `register_remote_marketplace_and_install_plugin` helper already encodes
the `remove → add` retry pattern for Copilot. For Codex, **always** call `marketplace remove` first
(ignoring the "not found" error when there's nothing to remove); this matches Copilot's
`marketplace_remove_flags=["--force"]` shape but with empty flags for Codex.

### P5 (NEW) — Personal-catalog shadow

`~/.agents/plugins/marketplace.json` (a user-personal marketplace catalog written by today's local
file-copy install via `merge_personal_marketplace_catalog`) **shadows** a git-source marketplace of
the same name. When this file declares a `creatio` marketplace, Codex CLI prefers it over the
freshly-cloned `~/.codex/.tmp/marketplaces/creatio/` even though `config.toml`'s
`[marketplaces.creatio]` block correctly points at the git URL. Result: `codex plugin add`
resolves `path` against `~/.agents/plugins/` and fails with `missing plugin.json`.

This is the single biggest migration risk for existing users — every machine that ran the old
file-copy install has this shadow file. Without explicit cleanup, the new install **fails out of
the box** for upgraders.

**Decision:** `install_codex` must remove the `creatio` plugin entry from
`~/.agents/plugins/marketplace.json` (or delete the whole file if it contains only the `creatio`
entry) as part of the migration cleanup step.

## Required Changes

### 1. Update `.agents/plugins/marketplace.json`

Change the plugin source from local-path to URL+ref, matching Claude/Copilot exactly:

```json
"source": {
  "source": "url",
  "url": "https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git",
  "ref": "release"
}
```

`scripts/bump-version.js` already keeps `plugins[0].version` in sync via `.version-bump.json` — no
change to bump logic needed.

### 2. Refactor `install_codex` in `installer/install.py`

The new shape closely mirrors `install_claude`:

```python
def install_codex(repo_root: Path, home: Path) -> None:
    ensure_required_references(repo_root)
    codex_home = home / ".codex"

    # --- Migration cleanup for users coming from the old file-copy install. ---

    # On-disk artifacts left by old install_codex.
    remove_tree_if_exists(codex_home / "plugins" / "marketplaces" / MARKETPLACE_NAME, "Codex")
    remove_tree_if_exists(codex_home / "plugins" / "cache" / MARKETPLACE_NAME, "Codex")
    remove_tree_if_exists(home / ".agents" / "plugins" / PLUGIN_NAME, "Codex")
    remove_tree_if_exists(codex_home / "skills" / SKILL_NAME, "Codex")

    # Personal marketplace catalog entry that shadows git marketplaces (P5).
    # Strip the `creatio` plugin entry from ~/.agents/plugins/marketplace.json if present.
    remove_personal_marketplace_creatio_entry(
        home / ".agents" / "plugins" / "marketplace.json", MARKETPLACE_NAME
    )

    # config.toml leftovers: old [marketplaces.creatio] / [plugins."creatio-...@creatio"] /
    # [[skills.config]]. Leave [mcp_servers.clio] alone — we re-merge it below.
    remove_codex_marketplace_section(codex_home / "config.toml", MARKETPLACE_NAME)
    remove_codex_plugin_section(codex_home / "config.toml", PLUGIN_NAME, MARKETPLACE_NAME)
    remove_codex_skill_config_override(
        codex_home / "config.toml", f"{PLUGIN_NAME}:{SKILL_NAME}"
    )

    # --- Install via Codex CLI (parity with install_claude). ---

    register_remote_marketplace_and_install_plugin(
        resolve_codex_command(),
        install_verb="add",              # Codex uses `plugin add`, not `plugin install`.
        marketplace_remove_flags=[],     # P4: bare `remove` works; no --force.
    )

    # --- clio MCP stays in config.toml (P3). ---

    merge_codex_mcp_config(repo_root, codex_home / "config.toml")
```

### 3. Dead-code removal in `installer/install.py`

After step 2, the following become unreachable and should be deleted:

- `write_codex_marketplace_catalog`
- `merge_codex_marketplace_config`
- `merge_personal_marketplace_catalog` (only caller was old `install_codex`)
- `render_codex_skill`
- The `write_rendered_skill` call inside `install_codex` (the helper itself stays; Cursor uses it)
- The `copy_plugin_runtime_surface` call inside `install_codex` (the helper stays for Cursor)

### 4. New helpers in `installer/install.py`

- `resolve_codex_command()` — analogous to `resolve_claude_command`, handles `.ps1` on Windows.
- `preflight_codex()` — analogous to `preflight_claude`, fails fast if `codex` not in PATH.
- `remove_codex_marketplace_section(config_path, name)` — regex/AST-based removal of the
  `[marketplaces.<name>]` table block from `config.toml`, preserving everything else.
- `remove_codex_plugin_section(config_path, plugin_name, marketplace_name)` — same shape, removes
  `[plugins."<plugin>@<marketplace>"]` block.
- `remove_personal_marketplace_creatio_entry(catalog_path, name)` — opens
  `~/.agents/plugins/marketplace.json`, removes the plugin entry whose `name` matches, writes back.
  If the file would become empty (no other plugins, no other top-level metadata), delete it.
- `install_verb` parameter on `register_remote_marketplace_and_install_plugin` (default
  `"install"`, Codex passes `"add"`).

### 5. Other agent flows stay stable

Claude, Copilot, and Cursor install paths unchanged. Cursor stays on file-copy.

### 6. Documentation updates

#### docs/install.md
- Rewrite the Codex bullet: remote marketplace via CLI, command form
  ```bash
  codex plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git
  codex plugin add creatio-ai-app-development-toolkit@creatio
  ```
  No `--ref` flag in the public-facing command; the `ref: "release"` lives in marketplace.json.
- Note that Codex still needs `clio` MCP in `~/.codex/config.toml`, which the installer adds.
- Add Codex to the "Testing unreleased changes through a marketplace agent" section:
  ```bash
  codex plugin marketplace add https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git --ref <your-branch>
  codex plugin add creatio-ai-app-development-toolkit@creatio
  ```
  The `--ref` flag overrides marketplace.json's `ref` for the marketplace clone; the plugin
  payload follows whatever `ref` is declared inside that branch's marketplace.json.
- The dev-loop note: for fast inner-loop work on the toolkit itself, devs use Cursor (file-copy
  stays) or Claude (marketplace dev-branch flow). Codex is production-like only.

#### docs/release-structure.md
- No structural change to mention. Remove any forward-looking note about Codex needing a mirror.

#### CONTEXT.md
- **"File-copy agents"** — drop Codex, keep only Cursor.
- **"Marketplace agents"** — add Codex (with a note that, unlike Claude, Codex install does not
  enable a platform autoUpdate equivalent, so Codex falls into the Copilot bucket of "marketplace
  agent that is NOT self-updating").
- **"Release-pinned install"** — drop the "Codex inherits the model after its remote-marketplace
  migration (separate ticket)" qualifier; Codex is now in.
- **Flagged ambiguities** — line about "Codex stays on file-copy until its remote-marketplace
  migration" — resolved by this work; remove.
- **Dev escape hatch** — Codex documented form `codex plugin marketplace add <url> --ref <ref>` is
  already correct in CONTEXT.md; no change.

Note for ENG-90476 follow-up: after this lands, Codex moves from the file-copy bucket of the
unified update command into the marketplace-update + reinstall bucket (same as Copilot). This PR
only updates CONTEXT.md wording; the actual `caadt update` logic change is owned by ENG-90476.

### 7. Tests

Release-structure tests (`tests/test_release_structure.py`):

- **(U1)** `.agents/plugins/marketplace.json plugins[0].source` matches the Shape B block:
  ```python
  self.assertEqual(
      codex["plugins"][0]["source"],
      {
          "source": "url",
          "url": "https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git",
          "ref": "release",
      },
  )
  ```
  Replaces the current `self.assertEqual(plugin["source"]["path"], "./")` assertion at
  `tests/test_release_structure.py:99`.

Installer tests (`tests/test_installer.py`):

- **(U3)** `install_codex()` shells out to `codex plugin marketplace remove creatio` (ignoring
  not-found), then `codex plugin marketplace add <url>`, then `codex plugin add <name>@creatio`.
  Mock `subprocess.run`. Asserts no `copy_plugin_runtime_surface` invocation.
- **(U4)** `install_codex()` cleans up `~/.codex/plugins/marketplaces/creatio/`,
  `~/.codex/plugins/cache/creatio/`, `~/.agents/plugins/<plugin>/`, and
  `~/.codex/skills/<skill>/` if present.
- **(U5)** `install_codex()` removes `[marketplaces.creatio]` and `[plugins.".."@creatio"]` blocks
  from `config.toml`, preserves `[mcp_servers.clio]` if present, and re-merges `clio` from the
  plugin's `.mcp.json` if absent.
- **(U5a)** `install_codex()` strips the `creatio` plugin entry from
  `~/.agents/plugins/marketplace.json` and deletes the file if no other entries remain.
- **(U6)** Remove existing assertions that the old marketplace path
  (`~/.codex/plugins/marketplaces/creatio/plugins/<name>/.codex-plugin/plugin.json`) exists.
- **(U8)** Symbol-absence smoke: `write_codex_marketplace_catalog`,
  `merge_codex_marketplace_config`, `merge_personal_marketplace_catalog`, `render_codex_skill` are
  no longer importable from `installer.install`.

No mirror-related tests (no mirror exists). No CI staleness gate needed. `.version-bump.json`
unchanged.

## Acceptance Criteria

### Pre-conditions
- [x] **(P1)** Source shape resolved by spike: Shape B (`url + ref: "release"`), no mirror.
- [x] **(P2)** Skill mirror unnecessary; Codex exposes plugin-bundled skills natively.
- [x] **(P3)** `clio` MCP merge into `config.toml` still required; not auto-registered.
- [x] **(P4)** `marketplace remove` precursor required for re-registration; no `--force` flag.
- [x] **(P5)** `~/.agents/plugins/marketplace.json` shadow-cleanup required for existing users.

### Functional (verified on a real Codex CLI 0.131.0)
- [ ] **(F1)** Fresh install on clean `~/.codex` and clean `~/.agents`: `python installer/install.py --target codex`
      succeeds; `codex plugin list` shows the plugin as `(installed, enabled)`.
- [ ] **(F2)** Existing-user upgrade (legacy file-copy artifacts present): same command cleans up
      `~/.codex/plugins/marketplaces/creatio/`, `~/.codex/plugins/cache/creatio/`,
      `~/.agents/plugins/<plugin>/`, the `creatio` entry in `~/.agents/plugins/marketplace.json`,
      and the `[marketplaces.creatio]` / `[plugins."<plugin>@creatio"]` / `[[skills.config]]` blocks
      in `config.toml`. Preserves `[mcp_servers.clio]` and other user MCP servers and plugin
      entries.
- [ ] **(F3)** Manual install path:
      `codex plugin marketplace add <url>` (no flags) + `codex plugin add <plugin>@creatio` succeeds.
- [ ] **(F4)** Claude, Copilot, Cursor install paths unchanged (regression).
- [ ] **(F5)** `~/.codex/config.toml` has `[mcp_servers.clio]` after install.
- [ ] **(F6)** Codex CLI lists the orchestrator skill from the plugin payload (no separate
      `~/.codex/skills/<skill>/` directory created).

### Documentation
- [ ] **(T5)** CONTEXT.md reflects Codex as a marketplace agent (Copilot bucket: not
      self-updating); flagged-ambiguity line about Codex remote-marketplace migration is removed
      or marked resolved.
- [ ] **(T6)** docs/install.md Codex section rewritten; dev-workflow note added that Cursor and
      Claude are preferred for fast inner-loop work on the toolkit.

### Tests
- [ ] **(U1)** `test_release_structure`: `.agents/plugins/marketplace.json` source matches Shape B
      block (replaces `path: "./"` assertion).
- [ ] **(U3)** `test_installer`: `install_codex` shells the right CLI sequence and does not copy
      runtime files.
- [ ] **(U4)** `test_installer`: cleanup of old file-copy artifacts on `~/.codex`.
- [ ] **(U5)** `test_installer`: cleanup of `config.toml` blocks; preservation of `clio` and
      unrelated entries.
- [ ] **(U5a)** `test_installer`: cleanup of `~/.agents/plugins/marketplace.json` `creatio` entry.
- [ ] **(U6)** Stale `test_installer` assertions about file-copy paths removed.
- [ ] **(U8)** Dead-code removal: symbol-absence smoke test for the four removed helpers.

### Side-note (not a blocker)
- Verify `.github/workflows/release.yml` zip step does not need adjusting — since there is no
  mirror to include or exclude, the release zip composition is unchanged.

## Recommended Implementation Order

1. Update `.agents/plugins/marketplace.json` source block (one line of JSON).
2. Refactor `install_codex` per §2; add helpers per §4; remove dead code per §3.
3. Update tests per §7.
4. Update docs per §6.
5. Run unit tests; push; let CI run.
6. Live Codex verification per F1–F6 on a real install.

## Decision

Shape B with no mirror. Codex install path becomes a near-clone of `install_claude` with three
extras:
1. Pre-install cleanup of legacy file-copy artifacts (cheap and idempotent).
2. Pre-install removal of the personal-marketplace-catalog shadow (P5).
3. Post-install `merge_codex_mcp_config` for `clio` (P3).

The earlier draft of this plan proposed a mirror at `plugins/creatio-ai-app-development-toolkit/`
with a sync script, CI staleness gate, version-bump integration, and dev-workflow friction
absorption. The spike (§Spike Findings) showed that all of that apparatus is unnecessary — Codex
CLI's `url` plugin-source mode fetches the whole repository as the plugin payload, which is
exactly what we want. The mirror approach is dropped entirely.

ENG-90476 (unified update command) is out of scope for this ticket. After this migration lands,
Codex falls into the same "marketplace agent, not self-updating" bucket as Copilot; ENG-90476 will
absorb that categorisation change when it implements its update logic. This PR only updates
CONTEXT.md wording to match the new category.
