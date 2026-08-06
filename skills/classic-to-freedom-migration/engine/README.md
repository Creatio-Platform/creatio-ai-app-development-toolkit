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
node migrate.mjs <manifest.json> --stubs  # the step-5.1 behaviour-analysis handoff digest (JSON)
node migrate.mjs <manifest.json> --plan --out plan.md   # WRITE the artifact to a file (present that file, not stdout)
```

**The inverse call graph.** `triggers[]` is read off DECLARATIONS (an attribute dependency, a bound control
property), so a method invoked from another method's BODY had none and its row printed `⚠ unresolved` — which reads
as "nobody knows what runs this" even though the parser had already recorded the call in `facts.calls`. Those calls
are now inverted into a caller index and walked upward until something answers what starts the chain: a caller with a
declared trigger (the row reports that declaration, reached `via` the chain), or a standard lifecycle method (the
platform calls it, which is the answer). Neither found → `internal call from X`, the honest partial answer. The index
is built from ALL methods including the standard ones the worklist filters out — a helper is very often invoked from
`init` / `onEntityInitialized`. Cycles are guarded, callers are sorted so the result is order-independent, a declared
trigger is never replaced by an internal one, and every caller travels along when there is more than one. Rows left
knowing only their caller are counted apart (`internalCallOnly`) from true orphans (`unresolvedTrigger`): both are
still behaviour-analysis work, and collapsing them would make the recovery look like work that no longer needs doing.

The plan then **folds** each such helper under the row that calls it: ordered directly beneath it, marked `↳`, with
its Freedom target replaced by `port with <caller>` so nobody builds a second artifact for half a behaviour. The
worklist header reports rows AND port units (63 rows that are 44 things to build read very differently). Nothing is
hidden — every row keeps its place and its own ported / dropped / blocked mark (Contract rule 7), and the
`--checklist` row for a folded helper says `(ported with <caller>)` so the two documents agree. Two deliberate
non-folds: a helper with SEVERAL callers (it is usually the row that becomes a shared converter) and one whose caller
is a standard method filtered out of the worklist (no parent row exists to fold under).

**The behaviour-analysis handoff (`--stubs` out, `manifest.behaviourIndex` back).** Four of the plan's imperative
rows cannot be answered from the page bodies this engine reads — a method whose trigger it could not trace, a method
assigned from another module, a `message`, a `mixin` — so SKILL.md step 5.1 sends them to the `classic-ui-expert`
skill. `--stubs` writes the payload for that: per scope (main page · mini page · each child page) every row's method
name, traced trigger, `externalRef` and line span, the `<kind>:<name>` member rows, and the standard-method names the
worklist excluded (so "63 stubs vs 70 members" is a set difference, not a contradiction). It is a digest, not the
result JSON — `evidence` is dropped, because the analysis run reads bodies from the stand itself.

The answers come back as `manifest.behaviourIndex`: `{ "<method>" | "<schema>::<method>" | "<kind>:<name>":
{ trigger?, from?, card?, ac?: […], note? } }`. On the next run the engine folds each entry into the GENERATED
tables — a **Described in** cell naming the card + AC on the `⚠ Imperative logic` row, the same reference on a
described `⚠ Confirm` member row, and a reported trigger where the engine traced none (marked `reported`; an
engine-traced trigger is never overwritten). A key that matches no row anywhere becomes a plan banner rather than a
silent drop. This is why the reference belongs in the manifest and not in the plan's hand-written `Adjustments`
section: `--plan --out` rewrites the file, so an appended index is lost on every regenerate.

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
- `vendor/acorn.cjs` — vendored **acorn 8.17.0** (MIT, the CommonJS build `dist/acorn.js`), the JS parser `parseSchema` uses; keeps the engine self-contained (no `npm install`). It is the CJS build so a plain synchronous `require()` loads it after the integrity check on ANY supported Node (no `require(esm)` >= 22.12 floor). **Not in `package.json` by design** (zero runtime deps), so it is outside Dependabot — patching is still a manual re-vendor, but advisories are **surfaced automatically**: the weekly `vendor-audit.yml` runs an OSV query against the pinned version (see `scripts/audit-vendored-acorn.mjs`), and `verify-vendor-upstream.mjs` (PR CI) anchors the pin to the real npm release so the audited version can't be spoofed. `vendor/acorn-LICENSE.txt` holds its license.
  - **Integrity pin** — because this bundle is the one executable component that processes *untrusted* stand schema-body, its provenance is pinned in `vendor/provenance.json` (upstream package + version + SHA-256 of the LF-normalized bytes, which equals the published npm artifact's hash). `verify-vendor.mjs` recomputes the hash and exits non-zero on any mismatch; CI (`.github/workflows/pr.yml` → *Verify vendored parser integrity*) runs it on every PR, so a swapped or silently-drifted parser fails the build. **To re-vendor:** replace `vendor/acorn.cjs` with the upstream **`package/dist/acorn.js`** from `acorn-<version>.tgz` (the CommonJS build — NOT `dist/acorn.mjs`), confirm its LF-normalized SHA-256, then update `version` + `sha256` + `upstreamArtifact` (`… -> package/dist/acorn.js`) in `provenance.json` together (these must match what `verify-vendor-upstream.mjs` fetches, or the authenticity anchor fails).
- `mapper.mjs` — `mapToFreedom()` (effective page → Freedom ChangeSet + `needsDecision[]`).
- `designspec.mjs` — render the plan / design spec as Markdown.
- `migrate.mjs` — CLI driver.

## Tests & internals

Golden runners, fixtures and the detailed engine-internals notes live **outside** the shipped skill, in
`engine-tests/classic-to-freedom/` (see its `README.md` and `engine-internals.md`), so this folder ships
runtime-only.
