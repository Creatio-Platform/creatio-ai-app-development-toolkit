# Creatio AI App Development Toolkit — Release Notes

Releases are listed in reverse chronological order. Each release has a `## X.Y.Z (YYYY-MM-DD)` header. Subsections (`###`) under each release are free-form — pick what reflects the actual scope (Features, Bug Fixes, Breaking Changes, Migration Notes, Documentation, etc.).

**Write each section as an announcement, not a changelog.** Open the section body with a one-sentence **bold hook** that says what the release unlocks and why it matters — the release workflow uses that leading `**bold**` sentence as the GitHub Release *title* (`X.Y.Z — <hook>`), so a section without one publishes under the bare version number. Then group the changes under short `###` sections, lead each bullet with the user-facing value (not the internal mechanism), and link the PR (`#NN`) so external readers can follow it. Emoji section headers (✨ / 🔒 / 🛠️) are welcome. See the most recent release below for the house style.

To cut a release: open a release preparation PR that adds a new `## X.Y.Z (date)` section at the top of this file and runs `node scripts/bump-version.js X.Y.Z`, merge it, then trigger the `Release` GitHub Actions workflow with the same version. The workflow validates the prepared main branch, tags it, and uses this section as the body of the GitHub Release.

---

## 1.6.0 (2026-07-29)

**Beta — your Classic pages finally have a map to Freedom.** Migrating a Creatio Classic UI page to Freedom UI has always been archaeology — hunt down the client schema, work out which base template it inherits from, rebuild the merged tree by hand, then guess the Freedom equivalent and hope nothing got dropped. This first release hands that job to an agent skill backed by a deterministic engine: the mechanical work is reconstructed for you and only the real judgment calls come back for review. It ships as an early **Beta** with deliberately limited migration coverage — **layout, components, and business rules** — so treat its output as a reviewed draft to build from, not a finished migration (see *Beta scope* below).

### ✨ What's new

- **`classic-to-freedom-migration` — Classic → Freedom UI, planned before it's built.** Point it at a Classic section/page (or a whole package/application) and it reconstructs the *effective* Classic page from its full schema inheritance chain — correct dependency order, with the parent-template seed folded in — then emits a Freedom **ChangeSet** and a ready-to-present **design spec / migration plan** you approve before anything is written. Anything it can't decide deterministically is surfaced as an explicit **worklist**, and a hard correctness gate refuses to hand you a plan built on parse errors, an unresolved parent chain, or a skeletal seed — so a page is never silently half-migrated. ([#46](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/46))

### 🧪 Beta scope

- This Beta migrates the three areas that carry the most manual toil, and **only** those:
  - **Layout** — profile islands, tab & group nesting, the 24-column grid, wide-header detection.
  - **Components** — fields and their controls, standard features (Approvals / Attachments / Activities / Emails / Feed) recognised instead of flattened to generic lists, and the page **tree** (child, typed, and mini pages — cycle- and diamond-safe), plus section concerns (add-record mini page, section actions, quick filters, list columns).
  - **Business rules** — the declarative page/entity rules carried over from the Classic page.
- Everything outside those three — imperative handler logic, custom modules/widgets, process launches, and other page behaviour — is **surfaced for you to port manually**, not auto-migrated. Coverage will expand in later releases.

### 🔒 Safe by construction

- The engine reads **untrusted** Classic schema bodies through a vendored, integrity-pinned **acorn** parser and *statically evaluates* them — it never executes them, so a hostile page body can't reach `process`, `require`, or the filesystem. The vendored parser is tamper-evidenced against its recorded hash and independently anchored to its real npm release in CI (plus a weekly vulnerability audit), and hostile input is contained end-to-end: bounded name extraction (no catastrophic regex backtracking), clamped grid spans, null-safe merging, and path-traversal guards on file inputs. ([#46](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/46))

### 🛠️ Under the hood

- New-code quality is now enforced in CI — merges are blocked on newly introduced SonarCloud issues, keeping the engine reference-quality as it grows. ([#59](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/59))

---

## 1.5.0 (2026-07-27)

### Features

- Add the `creatio-branding-orchestrator` skill — brand or theme an app to match a brandbook, company site, or chosen colors and fonts: guided palette conversation, logo intake and application (with a white-logo preference for dark top panels), and a palette-matched app background. SVG assets are sanitized before upload, and background/branding upload mechanics are delegated to clio. (ENG-92981)
- Apply a newly generated theme to the current user's profile by default, aligned with `clio set-user-theme` becoming a confirmed write. (ENG-93302)
- Add the `creatio-mobile-page-conversion` skill — convert a Freedom UI web page into a Freedom UI mobile page, toggle-aware via a feature-flag preflight gate, with a preflight recovery message and a form-page guard. (ENG-91228)
- Business Plan and UI guidelines now cover related lists (expanded lists / details). (ENG-92614)

### Bug Fixes / Guidance

- Clarify lookup/enum seeding guidance to prevent a runtime-insert fallback. (ENG-93865)
- Add a transient section-creation failure playbook runbook. (ENG-93376)

### CI

- Bump `actions/checkout` from 7.0.0 to 7.0.1. (#54)
- Bump `actions/setup-node` from 6.4.0 to 7.0.0. (#45)
- Exclude engine fixtures and the vendored parser from SonarCloud analysis. (#50)

---

## 1.4.0 (2026-07-09)

### Features

- Auto-register a Creatio environment directly from its URL and create the app without an extra confirmation prompt, streamlining first-run onboarding. Host matching and auto-registration are hardened against unsafe or ambiguous hosts. (ENG-91558)
- Reconcile the "prefer native tool-calls" guidance with the resident/clio-run rule so orchestration guidance is consistent. (ENG-92762)

### Bug Fixes

- Fix the `creatio-schema-naming` and `creatio-ui-guidelines` skills failing to load in GitHub Copilot. Their `SKILL.md` YAML frontmatter was invalid (an unquoted `description` containing `': '`), and the `creatio-ui-guidelines` description also exceeded Copilot's description-length cap. Descriptions are now valid, spec-compliant YAML and within the cap, with CI guards to prevent recurrence. (ENG-92957)

### CI

- Bump `actions/checkout` from 6.0.3 to 7.0.0. (#33)

---

## 1.3.0 (2026-06-25)

### Features

- Add the `creatio-schema-naming` skill — a Creatio data-model naming assistant for object schemas, object/column titles, lookup objects, Guid/UId references, and relation objects, backed by a detailed naming-standard reference. The orchestrator now invokes it before naming any data-model element.
- Add the `creatio-ui-guidelines` skill — Freedom UI page design, layout, and review guidance, including a concept→component workflow built on `get-component-info`, layout/gap mechanics, and a WCAG 2.2 AA no-code accessibility checklist with audit templates. The orchestrator now invokes it before authoring or reviewing Freedom UI pages.
- Orchestrator handoffs: `creatio-app-orchestrator` mandates `creatio-ui-guidelines` before Freedom UI page work and `creatio-schema-naming` before naming data-model elements.

### Documentation

- `skills/README.md` updated for the multi-skill model: the orchestrator remains the single entrypoint, with reusable domain-expertise skills it hands off to mid-workflow (gate-ordered stages still must not become standalone skills).

---

## 1.2.0 (2026-06-22)

### Features

- Add the CAADT product telemetry contract (`context/product-telemetry.md`): consent handling, required event mapping, telemetry payload shape, and emission checkpoints. The contract is referenced from `AGENTS.md` and the `creatio-app-orchestrator` skill + Cursor rule, and registered as a required installer reference.
- Install a `## Analytics Context` block (`coding_agent`, `skill_version`, `plugin_version`): concrete values are rendered into the Cursor rule at install time, while the committed `SKILL.md` and orchestrator Cursor rule carry derived values for the marketplace-based install path.

---

## 1.1.0 (2026-06-17)

### Features

- Prefer the native `clio` MCP server, operate within a single context, and treat the package context as writable, streamlining implementation through clio.
- Execution UX & effort-budget contract: reasoning-latency expectations, progress signals during long-running work, and recovered-error reframing so transient failures are reported as recovered rather than fatal.
- Orchestrator now generates business rules and applies improved business-plan object-model naming.
- Generated UI text must use localizable strings, so produced apps are translation-ready by default.

### Bug Fixes

- Orchestrator skill path resolution now works when the toolkit is invoked from outside the toolkit folder.

---

## 1.0.1 (2026-06-09)

### Features

- Unified updater (`installer/update.py`) that updates every detected agent in a single run, including Claude Code, through each agent's native plugin update command; Cursor is reinstalled from the latest release.

### Bug Fixes

- More resilient installer: per-target failures are isolated, and agents whose CLI is not on `PATH` are skipped instead of triggering a failed install.

### Documentation

- Documented the native per-agent update commands, linked the contributing and security guides, and added guidance to resolve web vs mobile (default web) before any page edit.

### Security & CI

- Hardened CI and supply chain: added SAST, secret, and dependency scanning, enabled CodeQL, pinned actions to commit SHAs, and locked the release branch to the release pipeline.

---

## 1.0.0 (2026-06-03)

### Initial public release

First public release of the Creatio AI App Development Toolkit on github.com. The toolkit installs as a plugin or skill surface for AI coding agents (Codex CLI/Desktop, Claude Code, Cursor, GitHub Copilot CLI) and drives a business-first workflow: natural-language app request → BA-style Business Plan → Technical Implementation Handoff → implementation through the clio MCP server.

### Highlights

- BA-style Business Plan and Technical Implementation Handoff as the user-facing deliverables, with explicit business approval before implementation.
- Installer (`installer/install.py`) for Codex, Claude Code, Cursor, and GitHub Copilot CLI; remote-marketplace install for Claude, Codex, and Copilot; local file-copy install for Cursor.
- clio MCP integration as the executable contract for implementation; tool parameter and response shapes are sourced from `get-tool-contract` rather than duplicated in the repository.
- Repository docs by responsibility: `AGENTS.md` (orchestration policy), `runbooks/` (stage-specific workflow), `context/` (navigation hub for reference content), `runtime/` (helper scripts).
- MIT licensed; security policy and contribution guide included.
