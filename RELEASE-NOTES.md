# Creatio AI App Development Toolkit — Release Notes

Releases are listed in reverse chronological order. Each release has a `## X.Y.Z (YYYY-MM-DD)` header. Subsections (`###`) under each release are free-form — pick what reflects the actual scope (Features, Bug Fixes, Breaking Changes, Migration Notes, Documentation, etc.).

To cut a release: open a release preparation PR that adds a new `## X.Y.Z (date)` section at the top of this file and runs `node scripts/bump-version.js X.Y.Z`, merge it, then trigger the `Release` GitHub Actions workflow with the same version. The workflow validates the prepared main branch, tags it, and uses this section as the body of the GitHub Release.

---

## 0.1.3 (2026-05-31)

### Bug Fixes

- **Codex install on a fresh machine** (forward-fix for 0.1.2): `installer/install.py` now tolerates the fifth Codex CLI wording for "no such marketplace" — ``marketplace `creatio` is not configured or installed`` (backticks around the name, "is not configured or installed" instead of "not found"). 0.1.2 only recognized four wording variants and exited 1 on the pre-remove step, blocking the remote-marketplace install path for Codex. Claude and Copilot install paths from 0.1.2 were unaffected.

---

## 0.1.2 (2026-05-31)

### Features

- **Remote marketplace for Codex** (ENG-90514): Codex CLI now installs from the remote git marketplace, matching Claude and Copilot. The installer migrates users coming from the legacy file-copy install — removing `~/.codex/plugins/marketplaces/creatio/`, the `~/.agents/plugins/marketplace.json` shadow catalog that would otherwise shadow the freshly-cloned git marketplace, and stale `config.toml` blocks (`[marketplaces.creatio]`, `[plugins."…@creatio"]`, and `[[skills.config]]` overrides for the toolkit skill) before registering the new marketplace.
- **Marketplace manifests pinned to the remote `release` branch** (ENG-90475): `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, and `.agents/plugins/marketplace.json` now declare `source: { source: "url", url: "<repo>.git", ref: "release" }` so every marketplace agent fetches plugin payload from the moving `release` branch rather than `main`. Decouples "what users install" from "what is on `main`".

### Hardening

- Codex install distinguishes "marketplace not found" from real failures during pre-remove, so first-time installs no longer print misleading errors.
- Codex install tolerates malformed marketplace state left by earlier installer versions.

### Release workflow

- Release workflow Gate 6 hardened against silent `OLD_VERSION` capture failures — refuses to force-push the `release` branch onto a SHA that shares its `plugin.json:version` with the current release, preventing clients from missing a release because of payload cache reuse.

### Documentation

- `docs/install.md` expanded with the release-pinned install model, dev escape-hatch instructions for testing unreleased changes, and manual-update guidance.
- `docs/codex-remote-marketplace-plan.md` added as the design record for the Codex migration.

---

## 0.1.1 (2026-05-27)

### Features

- **Remote marketplace for Claude and Copilot** (ENG-90475): Claude Code and GitHub Copilot plugins now install from the remote marketplace source instead of a local mirror. JSON config writes hardened with atomic replace to prevent partial writes on interrupted installs.
- **Mobile pages creation support** (ENG-89649): AI app creation instructions now cover mobile page creation — updated `context/essentials.md`, `context/naming-conventions.md`, and the requirements-gathering runbook.

### Bug Fixes

- **CAADT skill install/runtime fixes** (ENG-89512): Fixed skill file rendering with absolute installed paths for Codex and Claude; removed duplicate standalone skill registrations; added Codex legacy disabled-skill override cleanup; added validator launcher fallback (`py` → `python` → `python3`); prevented duplicate Copilot skill surfacing from install-side runtime.
- **Codex installer**: Fixed rendered installed skill paths and removed duplicate marketplace/skill surfaces (fix(codex)).
- **Reduced per-run agent friction** (ENG-89962): `mcp_client.py` now prints a USAGE banner on `--help`/`-h`/bare invocation with PowerShell-safe invocation examples. `AGENTS.md` trimmed (~440 → ~323 lines) by deferring Support Mode policy to `get-guidance`; added "Tool surface preference (clio MCP vs CLI)" rule to prevent agents falling back to CLI by default.

---

## 0.1.0 (2026-05-18)

### Breaking Changes

- `installer/install.py` must now be run from a plugin checkout (a local clone or an extracted release zip). It no longer clones the repository on its own.
- Removed installer CLI flags: `--repo-url`, `--ref`, `--install-root`. Callers that previously pinned a ref or installed from a custom path must instead check out / extract the desired revision first and run `python installer/install.py` from that directory.
- `install.py` no longer exposes `DEFAULT_REPO_URL`, `DEFAULT_INSTALL_ROOT`, `clone_or_update_repo`, or `render_codex_skill` as importable symbols.

### Release flow established

- GitHub Actions workflows (`pr.yml`, `release.yml`) introduce a Release Gate (5 pre-release checks) and a manual `workflow_dispatch` release trigger that tags and publishes an already-prepared main branch.
- Release workflow now builds a `creatio-ai-app-development-toolkit-<version>.zip` asset from `.release-manifest.json` (`plugin_runtime[]` + `release_extras[]`) and attaches it to the GitHub Release in a single `gh release create` call (draft → upload → publish). A transient asset-upload failure leaves a draft instead of a published release whose asset 404s.
- `.release-manifest.json` added as the canonical list of paths shipped in the release zip and copied into agent homes by `install.py`. The installer reads `plugin_runtime[]` from this file instead of a hardcoded tuple.
- `scripts/bump-version.js --audit` mode added to catch hardcoded version strings in files outside `.version-bump.json` sync list.
- `.github/plugin/plugin.json` and `.github/plugin/marketplace.json` added to the version sync list for GitHub Copilot CLI packaging.

### Migration Notes

- Version bumping now happens in a release preparation PR (run `node scripts/bump-version.js X.Y.Z` locally, commit, merge), not in the release workflow. The workflow only validates that the canonical manifest already matches the input version and that the tag is free.

### clio coupling

- Removed hard-coded `MIN_SUPPORTED_CLIO_VERSION` from `mcp_client.py` as an arbitrary cargo-cult value not tied to any specific clio feature.
- Coupling between CAADT and clio is now handled at runtime via `get-tool-contract`, which fails fast with an actionable error if a tool CAADT depends on is missing or has changed signature.
- `installer/install.py::preflight_clio()` checks only that `clio` is on PATH; no version check. Users are expected to keep clio current via `dotnet tool install/update clio -g`.

### Documentation

- `AGENTS.md` documents clio coupling, semver policy, and release flow.
- `runbooks/01-environment-setup.md` no longer pins clio to 8.0.2.50.
