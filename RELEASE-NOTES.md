# Creatio AI App Development Toolkit — Release Notes

Releases are listed in reverse chronological order. Each release has a `## X.Y.Z (YYYY-MM-DD)` header. Subsections (`###`) under each release are free-form — pick what reflects the actual scope (Features, Bug Fixes, Breaking Changes, Migration Notes, Documentation, etc.).

**Write each section as an announcement, not a changelog.** Open the section body with a one-sentence **bold hook** that says what the release unlocks and why it matters — the release workflow uses that leading `**bold**` sentence as the GitHub Release *title* (`X.Y.Z — <hook>`), so a section without one publishes under the bare version number. Then group the changes under short `###` sections, lead each bullet with the user-facing value (not the internal mechanism), and link the PR (`#NN`) so external readers can follow it. Emoji section headers (✨ / 🔒 / 🛠️) are welcome. See the most recent release below for the house style.

To cut a release: open a release preparation PR that adds a new `## X.Y.Z (date)` section at the top of this file and runs `node scripts/bump-version.js X.Y.Z`, merge it, then trigger the `Release` GitHub Actions workflow with the same version. The workflow validates the prepared main branch, tags it, and uses this section as the body of the GitHub Release.

---

## 1.10.0 (2026-09-04)

**Your Classic pages are now read from their real source before a migration plan is written.** A plan run can also no longer report a partial surface as complete. This release ships the plan-time half of migration stage 2: a new `classic-ui-expert` skill that describes every customization on a Classic surface with the source that proves it, a shared Freedom mapping table the whole engine agrees on, and a behaviour-analysis workflow that runs the same way on Claude and Codex. The build-time half (the Freedom build executor and its build queue) is not in this release.

### 🔍 Classic behaviour analysis

- **A new `classic-ui-expert` skill** ([#147](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/147)). Ask what a Classic section, record page, mini page or detail actually does, and you get every customization with what it does, why it exists in business terms, and the exact source that proves it. It reads the stand only, and it declines instead of guessing when a source is unreachable.
- **The analysis runs as a workflow, not as a single long prompt.** `classic-behaviour-analysis.workflow.js` and its host-neutral core (`skills/_workflow-core/`) split the surface into work items with their own run state, so a long analysis survives a dead call and replays identically instead of starting over. Claude and Codex adapters run the same core; a CI drift gate fails the build if the generated workflow stops matching its source.
- **A run that can only see part of the surface stops instead of announcing full coverage** ([#147](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/147)). On a measured run the analysis returned 1 of 18 declared scopes and still logged `547/547` after 1h51m. It now stops with a named cause before spending a single description.
- **Method names are counted per schema.** Six schemas each having an `onSaved` used to collapse into one row, so 413 rows were counted as 399 and one description closed six of them. Keys are qualified at one point, and an answer that cannot be attributed is named rather than dropped.
- **The merge phase is retried** — it was the only phase whose death left full coverage and no deliverable — and **a page reachable from several parents is handed off once**, not two or three times.

### 🗺️ Migration planning

- **One mapping table for Classic → Freedom, checked against a registry** ([#147](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/147)). Element recognition, target selection and the generated component index come from the same source, so the plan and the engine can no longer disagree about what a Classic element becomes.
- **The plan says what it could not place.** A coverage gate, imperative-logic and imperative-members worklists, section boundary resolution and a placement gate all run at plan time, so unplaceable behaviour is listed for you instead of quietly disappearing between plan and build.
- **List pages are planned as their own change set**, and the `--stubs` handoff folds analysis results back into the plan.

### 🛠️ Developer tooling

- Bundled workflows are mirrored by the installer, generated output is excluded from Sonar analysis, and `.gitattributes` pins the generated files to LF so a Windows checkout runs them unchanged.

---

## 1.9.0 (2026-09-03)

**Every toolkit workflow now reports product telemetry, not only app creation, and a host-side hook makes sure a session is counted even when the agent forgets to.** Edit, migration, mobile-conversion and branding runs were invisible to usage analytics; this release makes them countable with the same opt-in consent, the same privacy rules and no change to how you work. It requires clio **8.1.0.119** or newer (`dotnet tool update clio -g`).

### 📊 Telemetry for every flow

- **One stage vocabulary for all workflows** ([#96](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/96)). Agents report the same stages for every flow (`workflow_started`, `plan_approved`, `build_started`, `work_item_completed`, `workflow_completed`, ...) plus a `workflow` field naming the flow, so app maintenance, Classic to Freedom migration, mobile page conversion and branding land in the same funnel as app creation. The vocabulary is owned by clio (`get-guidance name=product-telemetry`); the toolkit only says where each flow emits and what counts as a unit of work.
- **A guaranteed floor on Claude Code.** A small hook runs after the first clio MCP call of a session, records one session-start event and reminds the agent which session id and toolkit version to report. It is also registered for the prompt and response events, which Claude Code fires in every project; in a session that never calls clio it returns at once and writes nothing. Cursor gets the same rules through an always-applied rule the installer writes, Codex through `AGENTS.md`; Copilot CLI has the skills only.
- **Session cost is reported from the host's own transcript**, once per response, as the real total rather than a guess made inside the run.
- **Consent and privacy are unchanged.** Nothing is sent before you grant telemetry consent, the hook never answers that question for you, events carry no prompts, generated content or credentials, and `withdraw-telemetry-consent` turns everything off at any time.

### 🛠️ Fixes

- **clio installed under `C:\Program Files` is found again** ([#96](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/96)). A `CLIO_CMD` path with spaces was split at the space and clio was reported as missing on the default Windows install location.
- **An older clio degrades quietly.** If the installed clio does not accept the new vocabulary, the toolkit reports nothing for that run and writes one diagnostic line naming the cause; upgrading clio restores reporting.

---

## 1.8.0 (2026-09-03)

**Your Freedom UI web pages can now become mobile pages — in beta, if you opt in.** The Web → Mobile page converter is open for beta testing behind a clio feature flag that stays off until you turn it on, so nothing changes for anyone who does not ask for it. The same release lands a long reliability pass on Classic → Freedom migration: the plan is checked against the real stand before a build starts, `--verify` no longer reports success it cannot back up, and the whole workflow now runs the same way on Claude, Codex and Copilot.

### 📱 Mobile page conversion — beta, opt-in

- **Convert a Freedom UI web page into a Freedom UI mobile page.** The `creatio-mobile-page-conversion` skill drives a gated flow: it asks clio for a conversion guide, shows you a plain-language plan, and writes nothing until you approve it (Gate M) — and registers nothing as a mobile section until you approve that separately (Gate S).
- **You must turn it on, and you need a recent clio.** The converter is gated behind clio's `mobile-page-converter` feature flag, which is **off by default**:

  ```
  clio experimental --name mobile-page-converter --enable
  ```

  **Requires clio 8.1.0.118 or newer** (`dotnet tool update clio -g`). On an older clio the skill stops with an enable message even after you flip the flag, because the underlying MCP tool is not there yet. The toolkit deliberately pins no clio version — the compatibility boundary is the MCP tool contract, checked at runtime.
- **The plan tells you it is a beta.** Every conversion plan opens with a plain-text Beta notice, so the state of the feature is visible at the moment you are asked to approve a write ([#106](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/106), [#141](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/141), [#142](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/142)).
- **What is in scope:** Freedom UI **web** form pages and list pages/sections. Classic pages must be migrated to Freedom UI web first; already-mobile pages are rejected. The converter is advisory — it returns a guide and the page body is built and validated through `create-page` / `validate-page` / `update-page`, not generated blindly.
- **What still needs you afterwards:** mobile manifest and wizard wiring, plus anything the guide flags as `requiresManualDecision`, `droppedRequests` or `flaggedActions`. Do not enable the flag on a production environment.
- **The engine's mechanics are documented once, in one place** ([#87](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/87)), so the skill's process description and the engine description can no longer drift apart.

### 🔬 Classic → Freedom migration: fewer confident wrong answers

- **A plan is validated against the real stand before the build starts** ([#102](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/102), [#133](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/133)) — including asserting the plan's identifiers against what actually exists, so a build no longer discovers halfway through that it was planned against something else.
- **`--verify` is trustworthy** ([#109](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/109), [#124](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/124)) — business rules, component role matching and list columns are actually checked, an inconclusive live check no longer outranks the run's own record ([#123](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/123)), and a verifier reads back only the round it ran ([#134](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/134)).
- **The gates say what they mean.** A correctness gate blocks on correctness rather than severity ([#121](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/121)); a completeness gate runs in context before a unit closes ([#111](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/111)) and no longer treats a short build as an incomplete one ([#131](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/131)); UI-guidelines evidence is recorded before a unit closes ([#108](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/108)) and a page that is already diffed-and-compliant can file it ([#122](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/122)).
- **Your answers reach the builder.** A decision you gave on a ⚠ Confirm item is carried through to the build action, or the run says why it could not be ([#104](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/104), [#119](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/119)), and the worklist asks one question at a time instead of bundling several into one ([#97](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/97), [#98](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/98)).
- **Recognition and mapping are registry-backed** — one shared Freedom mapping table ([#114](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/114)), component targets resolved by kind with typed `{kind, id}` identifiers ([#116](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/116), [#136](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/136)), generator-mirrored Classic element identification ([#105](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/105), [#125](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/125)), and per-output deprecation carried through the registry index ([#127](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/127)).
- **Build execution is faster and easier to follow** — each build unit gets its own row of the queue and its own built file ([#107](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/107), [#138](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/138)), and the Freedom build executor's phases were optimized ([#112](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/112)).
- **Reconcile respects both size caps** — the schema definition and the runtime output — and retries a bounded number of times with repeated-rejection triage ([#137](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/137), [#140](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/140)).
- **Reading the stand survives a wedged MCP path** by falling back to the clio CLI ([#93](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/93), [#103](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/103)), list pages are emitted as a ChangeSet gated off the built page ([#100](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/100)), resolved Classic list columns are used in plans ([#91](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/91)), and the on-save duplicate check is surfaced as a fourth on-stand signal ([#113](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/113)).

### 🧩 One workflow, three hosts

- **The orchestration core is host-neutral** ([#115](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/115), [#139](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/139)) — Claude, Codex and Copilot run the same workflow instead of three drifting copies. Bare subagents are counted rather than passed off as a verified workflow ([#144](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/144)).

### 💰 Cost reporting you can reconcile

- Cache tokens are reported and cost is split by agent ([#101](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/101)), usage is de-duplicated by `message.id` rather than by JSONL record so a retried message is not billed twice ([#126](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/126)), and transcripts are classified against the run record ([#135](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/135)).

### 🎨 Branding

- **A favicon is applied whenever the logos are** ([#92](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/92)), so a branded app no longer keeps the stock browser-tab icon.

### 🛠️ Developer tooling

- A local `build-dev-toolchain` rebuild script ([#143](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/143)), now cross-platform for Windows, macOS and Linux ([#146](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/146)).
- Workflow scripts are pinned to LF so a Windows checkout can run them ([#83](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/83)).

---

## 1.7.0 (2026-08-07)

**Your new app now lands where users can actually find it.** Until this release the toolkit could build a complete Creatio app that nobody but an administrator could open — `create-app` drops every new section into the `My applications` workplace, which is granted to `System administrators` only, and nothing ever asked where the app really belonged. Navigation placement is now a required discovery question, asked in the first batch alongside the business questions and carried through the plan, the runbooks and the completion criteria. The same release fixes the reason the orchestrator was often skipped entirely, and sharpens what the Classic and mobile migration skills tell you they could not convert.

### ✨ What's new

- **Navigation placement and audience are settled before anything is built.** The first discovery batch now asks which workplace your section — and its home page — belongs to, and which roles should see it, offering a new workplace named for the app, `My applications`, or one you name. Asking later was never a smaller version of the same thing: it made you re-decide work that was already finished. When a section is added to an app that already exists, the recommendation is refined during requirements gathering by reading where that app's sections actually live — and deliberately never recommends `My applications` back to you, because an app sitting there is the very problem this question exists to catch. ([#77](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/77))
- **The orchestrator is selectable from a plain request.** Its description named only the toolkit's own artifacts — "Business Plans", "implementation handoffs" — so "create a Todo app" or "add an Orders section" could miss it entirely and fall through to raw clio MCP with none of the toolkit's gates applied. All three trigger surfaces — the Claude skill, the Cursor rule and the OpenAI manifest — now carry the same user-intent wording, and a test keeps them from drifting apart again. ([#77](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/77))
- **Embedded profile cards migrate to the Freedom side profile.** A Classic page that carried an embedded profile card now maps onto the Freedom side profile instead of being flattened into the main layout. ([#71](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/71))

### 🛠️ Straighter answers about what did not convert

- **Mobile conversion names the whole containers it dropped.** It reported only per-element drops, so a web container removed up front never appeared in "what was dropped" — you found out by noticing something missing. ([#78](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/78))
- **Mobile page conversion emits targeted diff operations** instead of one root merge, so a converted page changes what it needs to and leaves the rest of the mobile template alone. ([#73](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/73))
- **Classic → Freedom migration reads sources from the runtime only.** The hybrid runtime-plus-repository model is gone, so a migration can no longer be planned from a local checkout that disagrees with the environment it will be applied to. ([#66](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/66))
- **A Flow & Engine explainer for the migration skill now lives in the repository**, so the documentation can be read and edited alongside the code it describes. ([#67](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/67))

### 🔒 Fewer surprises in what gets applied

- **Custom CSS is a last resort, and you are asked first.** Freedom UI guidance now tries native component properties before reaching for CSS, and warns and confirms before applying any. ([#57](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/57))
- **A missing guidance topic stops the run instead of improvising.** Navigation writes depend on clio's `workplaces` guidance, which ships with the clio knowledge library from `1.13.0` onward. If it is unavailable the run stops and tells you, rather than guessing the write — a workplace bound with the wrong columns installs on the next environment as an unreachable entry and cannot be repaired by re-installing. ([#77](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/77))

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
