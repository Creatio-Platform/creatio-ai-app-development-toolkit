# Decision: shipped toolkit code takes no runtime dependency

**Status:** accepted · **Scope:** everything the plugin ships and runs on the developer's machine —
`skills/`, `hooks/`, `runtime/` and `installer/` · **Raised in** the Technology Principles audit
ENG-99929, recorded under ENG-100096

## The observation

Every Node module under `skills/` and `hooks/` imports only `node:` built-ins and its own siblings, and
every Python script under `runtime/` and `installer/` imports only the standard library. Several files
say so in a header line ("Zero dependencies (node built-ins)"), but nothing said *why*, or where the
rule stops. So it read as a habit, and it invited two opposite mistakes:

- adding a small npm package to the migration engine because "it is only a tarball reader", or
- refusing an npm dev dependency in a CI script because "the repo is zero-dependency".

Three hand-written helpers show what the rule costs where it arguably does not apply:

| Helper | Where | Replaceable by |
| --- | --- | --- |
| ustar reader `readTarEntry` | `skills/classic-to-freedom-migration/engine/verify-vendor-upstream.mjs` | `tar` / `tar-stream` |
| SRI checker `integrityOk` | same file | `ssri` |
| Sonar glob matcher `toRegex` | `scripts/check-sonar-exclusions.mjs` | `picomatch` / `minimatch` |

## Why shipped code takes none

**There is no install step between the release zip and the first run.** The plugin is copied into the
coding agent's plugin directory as it is — `.release-manifest.json` → `plugin_runtime` lists what goes
in — and its code is then run by the agent host (a skill's `node migrate.mjs`, a hook the host spawns
on `PostToolUse`, a runtime script) inside the agent's sandbox. Nothing runs `npm install` or
`pip install` there, and the sandbox may have no network or no write access to do it. A bare
`import "some-package"` in shipped code does not degrade; it fails at load, on the developer's
machine, with an error that points at the toolkit rather than at a missing install.

**Each dependency is also a supply-chain surface nobody reviews per release.** The migration engine
feeds untrusted Classic schema bodies to a parser; the hooks run on nearly every agent turn. Code on
those paths that the toolkit does not own is code whose updates arrive without review.

So the rule is: **code the plugin ships imports only the language's standard library (`node:*`, the
Python stdlib) and files shipped next to it.** Vendoring is the only way in, and it carries its own
controls.

## The one exception: the vendored acorn parser

`parseSchema` needs a real JavaScript parser; evaluating a hostile schema body with `vm` is what the
AST route exists to avoid. acorn is therefore vendored, under these safeguards, all of which must hold
for any future vendored file too:

1. **Vendored unmodified.** `vendor/acorn.cjs` is upstream's own `dist/acorn.js` build for the pinned
   version, byte for byte (line endings aside), with its licence in `vendor/acorn-LICENSE.txt`.
2. **SHA-256 pin.** `vendor/provenance.json` records the package, version, upstream artifact and the
   SHA-256 of the LF-normalized bytes. `verify-vendor.mjs` recomputes it in CI on Linux and Windows
   and fails on any mismatch.
3. **Upstream authenticity.** The pin lives in the same commit as the file, so a change to both would
   pass step 2. `verify-vendor-upstream.mjs` closes that: in CI it downloads `<package>@<version>` from
   the public npm registry, checks the tarball against the registry's own `dist.integrity` — accepting
   only `sha256`, `sha384` or `sha512`, since an `md5` or `sha1` digest can be forged — extracts the
   pinned file and asserts its hash equals the pin.
4. **Loaded only after the check passes.** `engine.mjs` never imports acorn statically. It runs the
   integrity check first, requires `acorn.cjs` itself to be one of the verified entries, and only then
   loads it with `createRequire`, so a tampered file's top-level code never runs. A failed check throws
   on every parse, not just the first.

A weekly OSV audit (`.github/workflows/vendor-audit.yml`) covers what vendoring gives up: automatic
notice of a CVE against the pinned version.

## Where the rule stops

| In scope — no runtime dependency | Out of scope — npm / pip dev dependencies allowed |
| --- | --- |
| `skills/**` (the migration engine and every other skill script) | `scripts/` (CI and maintenance scripts) |
| `hooks/**` | `engine-tests/` (goldens and their runners) |
| `runtime/**` | `tests/` (the pytest suite) |
| `installer/**` (runs before anything else is installed) | `.github/` (workflow steps) |

The boundary is *what runs on the developer's machine from the release*, not *which directory a file
sits in*, and one file straddles it: **`verify-vendor-upstream.mjs` is CI-only although it lives under
`skills/`.** It ships because the release copies the whole `skills/` tree, but nothing on the developer's
machine runs it; it needs the network, and `.github/workflows/pr.yml` is its only caller. It sits next
to the engine because it checks the engine's `vendor/` directory.

What this means for the three helpers above:

- They are **replaceable, not required to be replaced.** A CI helper may take an npm dev dependency;
  whether swapping a working, tested hand-written helper for a package is worth it is a normal
  engineering call, not something this rule settles.
- The **Sonar glob matcher** can be replaced in place: `scripts/` is out of scope.
- The **ustar reader and SRI checker** can be replaced once `verify-vendor-upstream.mjs` moves out of
  `skills/` (for example to `scripts/`). Until then keep it import-clean, so the statement in
  `package.json` that nothing under `skills/` or `hooks/` imports a dev dependency stays true without
  exceptions.

## When to revisit

If the plugin gains an install step that runs inside the agent's environment — the installer resolving
dependencies into the plugin directory, or a host that installs a plugin's `package.json` — the first
argument above stops holding, and the rule becomes a choice about supply-chain surface alone.
