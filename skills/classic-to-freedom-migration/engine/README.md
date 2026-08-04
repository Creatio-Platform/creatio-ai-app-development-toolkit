# Classic → Freedom migration engine

Deterministic, offline Node module. It reconstructs the *effective* Classic page from N `ClientUnitSchema`
layers (base → top) and maps it to a Freedom **ChangeSet** + plan/design-spec. No Creatio/stand dependency:
the skill fetches the schema bodies (via clio) and passes them in a manifest; the engine only transforms.

## Usage

Invoked by the skill as a CLI — see `../SKILL.md` step 4:

```
node migrate.mjs <manifest.json>          # full JSON: effective page + ChangeSet + needsDecision[] + gates
node migrate.mjs <manifest.json> --plan   # render the migration plan (Markdown)
node migrate.mjs <manifest.json> --spec   # render just the per-page design spec (Markdown)
node migrate.mjs <manifest.json> --plan --out plan.md   # WRITE the artifact to a file (present that file, not stdout)
```

`--out <file>` writes the `--plan`/`--spec` output to a file so the agent presents the file verbatim instead
of hand-pasting stdout (its Overview/Main-scope values come from `manifest.planMeta`).

**Exit codes & gates.** Bad input (missing/invalid manifest, unreadable schema `file`) → exit **1**. Otherwise
the run computes three gates — `gate.blocked` (correctness: parse errors / unresolved parents / merge warnings /
skeletal seed), `structure.complete` (input completeness: unresolved detail / child-page schemas) and
`coverage.complete` (member coverage: every schema member accounted for) — plus, in
`--plan` mode only, a fourth **plan-completeness** check: required `manifest.planMeta` still `<FILL: …>`
(`planMetaMissing`) or unresolved on-stand `signals` (`signalsMissing`). If any of these is bad the CLI prints a
`⛔` banner to stderr and exits **2** (the artifact is still written/printed, with the banner at the top, so you
see *what* to fix). Exit **0** = all applicable gates clear = an approvable plan. (`--spec`/default runs need no
`planMeta`, so the plan check applies only to `--plan`.)

**The member ledger (`coverage`).** Every member of every merged layer — each `diff` operation, `methods` entry,
`attributes` entry, `messages` entry, `mixins` entry, `define()` dependency and `details` entry — carries a
disposition: `mapped` (the ChangeSet has a Freedom artifact for it), `decision` (it is on a `⚠` worklist),
`resolved` (the agent recorded one in `manifest.memberDispositions`), `context` (inherited base-template content,
excluded by design but COUNTED) — or `unaccounted`, which blocks. Kinds with no members are reported as counted
zeros, so "the plan says nothing about messages" cannot mean "nobody looked". Methods additionally carry body
evidence read from the AST (framework calls made, attributes read/written, messages published/subscribed, line
span, passthrough-vs-real, assigned-from-another-module) — the parser still never EXECUTES a body.

## Files

- `engine.mjs` — `parseSchema()` (AST parse of a classic `define(...)` body — reads the returned object, never executes it) + `mergeHierarchy()` (replay the layer chain into one effective page + provenance).
- `vendor/acorn.mjs` — vendored **acorn 8.17.0** (MIT), the JS parser `parseSchema` uses; keeps the engine self-contained (no `npm install`). **Not in `package.json` by design** (zero runtime deps), so it is outside Dependabot — patching is still a manual re-vendor, but advisories are **surfaced automatically**: the weekly `vendor-audit.yml` runs an OSV query against the pinned version (see `scripts/audit-vendored-acorn.mjs`), and `verify-vendor-upstream.mjs` (PR CI) anchors the pin to the real npm release so the audited version can't be spoofed. `vendor/acorn-LICENSE.txt` holds its license.
  - **Integrity pin** — because this bundle is the one executable component that processes *untrusted* stand schema-body, its provenance is pinned in `vendor/provenance.json` (upstream package + version + SHA-256 of the LF-normalized bytes, which equals the published npm artifact's hash). `verify-vendor.mjs` recomputes the hash and exits non-zero on any mismatch; CI (`.github/workflows/pr.yml` → *Verify vendored parser integrity*) runs it on every PR, so a swapped or silently-drifted parser fails the build. **To re-vendor:** replace the file, confirm the new LF-normalized SHA-256 against the pinned upstream artifact, then update `version` + `sha256` in `provenance.json` together.
- `mapper.mjs` — `mapToFreedom()` (effective page → Freedom ChangeSet + `needsDecision[]`).
- `designspec.mjs` — render the plan / design spec as Markdown.
- `migrate.mjs` — CLI driver.

## Tests & internals

Golden runners, fixtures and the detailed engine-internals notes live **outside** the shipped skill, in
`engine-tests/classic-to-freedom/` (see its `README.md` and `engine-internals.md`), so this folder ships
runtime-only.

