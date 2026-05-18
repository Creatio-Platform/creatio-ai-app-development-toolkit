# Creatio AI App Development Toolkit — Release Notes

Releases are listed in reverse chronological order. Each release has a
`## X.Y.Z (YYYY-MM-DD)` header. Subsections (`###`) under each release
are free-form — pick what reflects the actual scope (Features, Bug Fixes,
Breaking Changes, Migration Notes, Documentation, etc.).

To cut a release: open a release preparation PR that adds a new
`## X.Y.Z (date)` section at the top of this file and runs
`node scripts/bump-version.js X.Y.Z`, merge it, then trigger the `Release`
GitHub Actions workflow with the same version. The workflow validates the
prepared main branch, tags it, and uses this section as the body of the
GitHub Release.

---

## 0.1.0 (unreleased)

### Breaking Changes

- `installer/install.py` must now be run from a plugin checkout (a local
  clone or an extracted release zip). It no longer clones the repository
  on its own.
- Removed installer CLI flags: `--repo-url`, `--ref`, `--install-root`.
  Callers that previously pinned a ref or installed from a custom path
  must instead check out / extract the desired revision first and run
  `python installer/install.py` from that directory.
- `install.py` no longer exposes `DEFAULT_REPO_URL`, `DEFAULT_INSTALL_ROOT`,
  `clone_or_update_repo`, or `render_codex_skill` as importable symbols.

### Release flow established

- GitHub Actions workflows (`pr.yml`, `release.yml`) introduce a Release
  Gate (5 pre-release checks) and a manual `workflow_dispatch` release
  trigger that tags and publishes an already-prepared main branch.
- Release workflow now builds a `creatio-ai-app-development-toolkit-<version>.zip` asset from
  `.release-manifest.json` (`plugin_runtime[]` + `release_extras[]`) and
  attaches it to the GitHub Release in a single `gh release create` call
  (draft → upload → publish). A transient asset-upload failure leaves a
  draft instead of a published release whose asset 404s.
- `.release-manifest.json` added as the canonical list of paths shipped
  in the release zip and copied into agent homes by `install.py`. The
  installer reads `plugin_runtime[]` from this file instead of a
  hardcoded tuple.
- `scripts/bump-version.js --audit` mode added to catch hardcoded version
  strings in files outside `.version-bump.json` sync list.
- `.github/plugin/plugin.json` and `.github/plugin/marketplace.json` added
  to the version sync list for GitHub Copilot CLI packaging.

### Migration Notes

- Version bumping now happens in a release preparation PR (run
  `node scripts/bump-version.js X.Y.Z` locally, commit, merge), not in
  the release workflow. The workflow only validates that the canonical
  manifest already matches the input version and that the tag is free.

### clio coupling

- Removed hard-coded `MIN_SUPPORTED_CLIO_VERSION` from `mcp_client.py` as
  an arbitrary cargo-cult value not tied to any specific clio feature.
- Coupling between ADAC and clio is now handled at runtime via
  `get-tool-contract`, which fails fast with an actionable error if a
  tool ADAC depends on is missing or has changed signature.
- `installer/install.py::preflight_clio()` checks only that `clio` is
  on PATH; no version check. Users are expected to keep clio current
  via `dotnet tool install/update clio -g`.

### Documentation

- `AGENTS.md` documents clio coupling, semver policy, and release flow.
- `runbooks/01-environment-setup.md` no longer pins clio to 8.0.2.50.
