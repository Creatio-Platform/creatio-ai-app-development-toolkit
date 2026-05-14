# Creatio AI App Development Toolkit — Release Notes

Releases are listed in reverse chronological order. Each release has a
`## X.Y.Z (YYYY-MM-DD)` header. Subsections (`###`) under each release
are free-form — pick what reflects the actual scope (Features, Bug Fixes,
Breaking Changes, Migration Notes, Documentation, etc.).

To cut a release: add a new `## X.Y.Z (date)` section at the top of this
file in a PR, merge it, then trigger the `Release` GitHub Actions workflow
with the same version. The workflow extracts this section and uses it as
the body of the GitHub Release.

---

## 0.1.0 (unreleased)

### Release flow established

- GitHub Actions workflows (`pr.yml`, `release.yml`) introduce a Release
  Gate (5 pre-release checks) and a manual `workflow_dispatch` release
  trigger.
- `scripts/bump-version.js --audit` mode added to catch hardcoded version
  strings in files outside `.version-bump.json` sync list.
- `.copilot-plugin/plugin.json` added to version sync list (was drifting).

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
