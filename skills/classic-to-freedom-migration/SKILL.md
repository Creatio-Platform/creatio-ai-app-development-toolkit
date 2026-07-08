---
name: classic-to-freedom-migration
description: Analyze and migrate Creatio Classic UI to Freedom UI at either scope - a single section/page/detail, or an entire package/application. Use when the user provides a Creatio URL, section/page name, or package/app name and asks to audit, plan, or implement a Classic UI to Freedom UI migration with metadata discovery, package editability and placement analysis, Classic page-template structure analysis, Freedom UI template analog selection, layout and business-logic analysis, an approval-gated migration plan, and execution of the approved plan.
---

# Classic To Freedom Migration

Use this skill to guide a coding agent through migration of a Creatio Classic UI section to a parallel Freedom UI analog.

The skill is approval-gated. Do not create or edit Freedom UI artifacts until the migration plan has been reviewed and explicitly approved by the user.

**Always present the migration plan to the user before any implementation — for every scope (single-section, whole-package, and existing-Freedom reconcile), with no exceptions.** Never jump from analysis straight to building, and never treat a task as "too small" or "obvious" to skip the plan. The plan is shown as the readable, section-grouped structure-analysis summary (`references/analysis-summary.md`); the dense detail lives in `plan.md`. For the reconcile scope, the plan must include the reconciliation diff (what will be added, modified, and removed/hidden on the existing Freedom section). Presenting the plan and stopping for approval is a required step, not an optional one.

## Inputs

- Creatio section/page URL, or a section/page/entity name.
- Creatio package or application name, when the whole package/app must be migrated.
- Optional Creatio environment name.
- Optional local repository or workspace containing Creatio package sources.

## Migration Scope

Determine the scope before doing anything else, because it changes how much you inventory and how you order the work.

### Single-section scope

Use when the user names one section, page, detail, or mini page (or gives a URL pointing at one).

- Resolve and migrate only that target plus its directly required dependencies (its entity, details, mini pages, parent template, and the backend it calls).
- Do not inventory or touch unrelated schemas in the same package.
- Follow the workflow below; the package-wide steps marked "(package scope)" are optional and only used to place the single target's Freedom artifacts safely.

### Whole-package / whole-application scope

Use when the user names a package or application, says "the whole app/package", or asks to migrate "everything".

- Treat the package/application as the unit of work, not a single section.
- Run the full package inventory and build a dependency graph before planning any single page (Workflow step 0).
- Classify every Classic schema into one of two kinds, because they migrate differently:
  - **Own section/page**: a self-contained section the app owns (for example a custom `*Section` / `*Page` over the app's own entity). Migrate it as a new Freedom list/form page.
  - **Replacing / extension schema**: a `replacing` schema that injects behavior into a base section (for example a replacing `ContactPageV2` adding fields to the standard Contact card). Migrate it as an additive delta on the existing Freedom page for that entity, not as a new page. Do not create a duplicate Freedom section for an entity that already has one.
- Decide package placement once for the whole app, then reuse that decision for every artifact.
- Order the migration by dependency, not by file or alphabetical order: entities/data sources first, then self-contained own sections, then replacing/extension deltas on base sections, then backend/process/permission logic.
- Produce one consolidated approval-gated plan that lists each section as a sub-plan, sharing the discovery, package-placement, and validation sections.

### Existing-Freedom reconcile scope

Use when the Classic section being migrated **already has a Freedom UI section/page for the same entity** (shipped out of the box or built earlier), and the client's value is the customizations they layered on the Classic section in their own packages. Here the goal is not a new page — it is to make the existing Freedom section carry the client's Classic customization intent, and to reconcile away anything on Freedom that contradicts it.

- Detect it in discovery: a Classic section/page/detail has an existing Freedom counterpart for the same entity, and the client owns customizations (replacing schemas, added fields/details/rules/buttons, hidden or removed base elements) in their editable packages.
- The unit of work is the client's **customization delta**, not the whole Classic page. Target the existing Freedom section; never create a duplicate.
- Reconcile in both directions: what the client added in Classic but is missing on Freedom gets **added**; what exists on Freedom but is not in the client's Classic setup — because they never added it or explicitly removed/hid it in Classic — gets **removed/hidden**, within the customization scope.
- Never strip base/standard Freedom elements that have no Classic analog just because they are absent from the delta; absence is not intent to remove. Flag those as manual decisions.
- Follow `references/existing-freedom-reconcile.md` for the isolate-delta → read-Freedom → diff → apply → verify procedure, and record every removal with its Classic evidence.

## Source Policy

Use a hybrid discovery strategy with fallback:

1. Prefer Creatio runtime metadata through Clio MCP when an environment can be resolved.
2. Use the local repository when available to inspect source schemas, package structure, tests, and hardcoded logic.
3. If runtime metadata or repository sources are unavailable, continue only if the target section can still be identified; record the missing source as a risk in the plan.
4. Stop and ask for the missing identifier only when the target section/page cannot be resolved from the URL, name, runtime metadata, or repository search.

## References

Read these only when needed:

- `references/classic-to-freedom-mapping.md` for Classic UI to Freedom UI mapping rules.
- `references/migration-plan-template.md` before writing the migration plan.
- `references/migration-documentation.md` before creating or updating the migration documentation set.
- `references/analysis-summary.md` before presenting the structure-analysis summary to the user in chat.
- `references/page-design-spec.md` before producing the per-page design spec for each page to rebuild.
- `references/existing-freedom-reconcile.md` when the Classic section already has a Freedom counterpart and the client's customizations must be ported onto it and reconciled.

## Documentation

Every migration is tracked through a persisted documentation set, not from memory. The set is the shared source of truth for the agent and the person directing it.

- Follow `references/migration-documentation.md` for the document layout, status vocabulary, task IDs, Definition of Done, and update rules.
- Scale the set to scope: single-section needs a lightweight `plan.md` plus `worklog.md`; whole-package needs the full set (`README.md`, `discovery.md`, `plan.md`, `roadmap.md`, `decisions.md`, `worklog.md`).
- Create the documents during step 6 (before the approval gate), then keep them updated through execution.
- Cardinal rule: read `README.md` and `roadmap.md` at the start of every session, and after every meaningful action update `roadmap.md` and append to `worklog.md`. `plan.md` is frozen after approval; changes go through `decisions.md` and re-approval.

## Workflow

### 0. Determine Scope

Initial request: `$ARGUMENTS`

1. Decide the scope using "Migration Scope" above:
   - single-section scope when the user names one section/page/detail/mini page or a URL pointing at one
   - whole-package / whole-application scope when the user names a package or application, or asks to migrate "everything"
2. If the scope is genuinely ambiguous (for example a name that is both a section and the package), ask one clarifying question before continuing.
3. For whole-package scope, build the package inventory and dependency graph first:
   - `list_packages`, `list_apps`, `get_app_info`, and `list_app_sections` to enumerate every section, page, detail, entity, and owning app
   - classify each Classic schema as an **own section/page** or a **replacing/extension schema**
   - record which pages depend on which entities, details, and backend schemas
   - this inventory drives the dependency-ordered plan in step 6 and the per-section sub-plans
   - record it in `discovery.md` (whole-package scope) per `references/migration-documentation.md`
   For single-section scope, skip the full inventory and resolve only the named target plus its direct dependencies.

### 1. Resolve The Target

1. Parse the user input:
   - If it is a URL, extract host, route, section/page hints, record Ids, page UIds, and designer UIds.
   - If it is a name, treat it as a possible section caption, section code, entity schema, page schema, package name, application name, or package schema prefix.
   - For whole-package scope, resolve the target as the set of sections/pages from the step 0 inventory rather than a single page.
2. Resolve the Creatio environment:
   - Use `list-environments` when Clio MCP is available.
   - Match the URL host to a registered environment.
   - If no match exists, continue with repository-only discovery if possible and record the environment gap.
3. Resolve the target inventory:
   - section schema and section code
   - edit page schemas
   - mini pages
   - details and related schemas
   - entity schema
   - Classic parent schema or page template for each page/detail
   - Freedom UI template candidates and existing Freedom pages for the same entity/application
   - package and application ownership
   - whether the owning package is editable/unlocked or requires a new/replacing package
   - existing Freedom UI pages for the same entity or application

### 2. Discover Runtime And Source Metadata

Use read-only operations first.

Runtime discovery, when available:

- `list_app_sections` for app section metadata.
- `list_pages` and `get_page` for existing Freedom UI pages.
- `get_client_unit_schema` for Classic client-unit schemas.
- `get_schema` and `get_sql_schema` for referenced C# or SQL schemas.
- package/application tools such as `list_packages`, `list_apps`, `get_app_info`, and app-section metadata to verify package ownership, lock/editability, installed-app ownership, and whether the same package can safely own Freedom artifacts.
- `get_component_info` and `list_page_templates` to verify Freedom UI capabilities.
- For every Classic page/detail, resolve the parent schema chain and identify the effective Classic template structure before choosing a Freedom UI target template.

Repository discovery, when available:

- Search with `rg` for schema names, captions, entity names, section codes, and message names.
- Read Classic schemas such as `*Section`, `*Page`, `*Detail`, `*MiniPage`, mixins, utilities, replacing schemas, data bindings, and package descriptors.
- Inspect package descriptors, project files, app manifests, and dependency declarations to determine whether the Classic package is a source package, locked installed package, third-party/base package, or repo-owned editable package.
- Read parent schemas and inherited templates referenced by `parentName`, `extendParent`, schema metadata, or package dependencies when available.
- Read nearby Freedom UI schemas and repository instructions before proposing implementation patterns.

### 3. Decide Package Placement

Before choosing page templates or planning implementation, decide where Freedom UI artifacts can be created.

1. Identify the Classic owning package and application:
   - package name, UId, maintainer, installed app, dependencies, and whether it is represented in the local repository
   - whether the section/page/entity lives in a base, vendor, locked, compiled, or read-only package
   - whether existing Freedom pages for the same entity already live in an editable app/package
2. Classify package placement:
   - same package: allowed when the package is editable/source-owned and changing it matches repository ownership
   - replacing/extension package: required when the original package is locked but Creatio supports replacement in the design package
   - new package/app: required when the original package is read-only, vendor/base-owned, missing locally, unsafe to mutate, or the user explicitly asks for isolation
   - blocked/manual decision: use when package ownership or lock state cannot be verified and implementation would risk corrupting a shared/base package
3. Record evidence and the decision in the migration plan. If the user already specified a package strategy, still verify whether it is technically possible and call out conflicts.

For whole-package scope, decide placement once for the whole application and reuse it for every artifact. A vendor/installed/locked owning package (for example one with a third-party maintainer) means new package/app for the app's own Freedom sections plus replacing/additive deltas for base sections it extends; do not mutate the vendor package in place.

### 4. Analyze Classic UI Behavior

Build a structured inventory of the Classic implementation:

- template structure: parent page/detail schema, inherited containers, default regions, header/body/tabs/details/files/feed areas, action zones, and which parts are inherited versus custom
- layout: containers, tabs, groups, columns, grids, details, actions, buttons, menus, and mini pages
- data: entity schema, data sources, lookup filters, default values, virtual columns, calculated columns, and dependencies
- page rules: `businessRules`, required/editable/visible state, validation, field filtering, and localizable strings
- hardcoded logic: `methods`, overrides, subscriptions, messages, sandbox events, service/process calls, permission checks, async flows, and custom modules
- backend dependencies: C# source schemas, web services, processes, SQL scripts, integrations, feature flags, and package dependencies
- security and access: operation permissions, record permissions, role-based UI logic, and restricted actions

Do not assume Classic logic has a direct Freedom equivalent. Classify each behavior using the categories from `references/classic-to-freedom-mapping.md`.

### 5. Map To Freedom UI

Create a Classic to Freedom mapping table before planning implementation.

Before mapping individual controls, choose the Freedom page strategy:

1. Build a Classic template profile:
   - parent schema/template name and hierarchy
   - page type: section list, edit page, detail, mini page, lookup/edit card, dashboard-like page, or custom module
   - structural slots used by the Classic page: side profile, header, main tabs, details, files/notes/feed, action menu, modal area, related lists, custom containers
   - inherited behavior from parent schemas that must be preserved or intentionally dropped
2. Compare the Classic template profile with Freedom candidates:
   - existing Freedom page for the same entity/application
   - `list_page_templates` results such as list page, tabs form page, right-area form page, top-area form page, blank page, mini page, or sidebar/page-specific templates
   - component capabilities from `get_component_info`
3. Pick one strategy and record the reason:
   - update an existing Freedom page — when a Freedom counterpart already exists for the entity, follow `references/existing-freedom-reconcile.md`: port the client's Classic customization delta onto it and reconcile away Freedom elements that contradict the client's Classic setup, instead of building a new page
   - create a new Freedom page from the closest template
   - create a blank/custom Freedom page only when no standard template preserves the required structure
   - mark as manual decision if the Classic template has no safe Freedom analog

For every Classic item, choose one target:

- direct Freedom analog
- configurable Freedom business rule
- Freedom handler, converter, or validator
- backend/service dependency
- unsupported or manual decision

Use Clio component metadata where available. Prefer declarative Freedom UI configuration and business rules over custom handlers when the behavior is equivalent.

For every page classified as Rebuild or Delta, produce a per-page design spec following `references/page-design-spec.md`: the Classic page walked region by region and mapped onto a Freedom template, with each field's component, data-source attribute, and grid placement, its page rules and handlers, a wireframe of the finished page, and a build order. This spec is the build contract for step 7; attach it to the page's sub-plan in `plan.md`.

### 6. Write The Migration Plan And Create The Documentation Set

Create the documentation set from `references/migration-documentation.md`, scaled to scope, before the approval gate. Write the plan into `plan.md` using `references/migration-plan-template.md`. For whole-package scope also create `README.md`, `discovery.md`, `roadmap.md`, `decisions.md`, and `worklog.md`, and seed `roadmap.md` with one task per migratable artifact in dependency order.

The plan must include:

- input and resolved target
- discovery evidence and missing-source risks
- Classic UI inventory
- package placement decision
- Classic template structure and Freedom template analog
- layout analysis
- business logic analysis
- Freedom UI mapping
- ordered implementation plan
- validation plan
- blockers and decisions needed

Default implementation strategy:

- Build a parallel Freedom UI analog.
- Do not remove or disable Classic UI during the initial migration unless the user explicitly approves switch-over.
- Update existing Freedom UI pages when they already represent the target entity or section; do not create duplicates without a documented reason.

For whole-package scope, produce one consolidated plan:

- shared sections: discovery evidence, package placement decision, validation plan
- one sub-plan per section/page, each with its own template analog, layout, business-logic, and Freedom mapping
- a single dependency-ordered implementation sequence across all sections (entities/data sources first, then own sections, then replacing/extension deltas, then backend/process/permission logic)
- mark each Classic schema as own section vs replacing/extension so the reader knows which becomes a new page and which becomes an additive delta

Alongside the plan, present a short user-facing structure-analysis summary in chat, following `references/analysis-summary.md`. It is the readable companion to `plan.md`: grouped by section, with each page's business rule shown on the page it belongs to and processes/code as section-level items, each carrying its migration call. Render it as plain Markdown in chat — never as HTML or a rendered artifact.

Stop after presenting the plan and ask for explicit approval. Do not edit code, create pages, update schemas, deploy, compile, or push before approval.

### 7. Implement The Approved Plan

After approval:

1. Re-read `README.md`, `roadmap.md`, and the approved `plan.md`, plus relevant source files, to recover state. Record the approval in `decisions.md`.
2. For whole-package scope, migrate one section at a time in the dependency order from the plan (entities/data sources, then own sections, then replacing/extension deltas, then backend); finish and validate each section before starting the next, and re-check existing Freedom artifacts before each create to avoid duplicates.
3. Build each page from its per-page design spec (`references/page-design-spec.md`): create or select the page from the spec's template, then add containers, fields, rules, handlers, and detail data sources in the spec's build order. Execute subtasks in dependency order:
   - package/app/page scaffolding
   - same-package, replacing-package, or new-package setup according to the approved package placement decision
   - Freedom page template creation or existing page selection
   - entity model or data-source adjustments
   - layout migration
   - business rules
   - handlers, converters, validators, and helper modules
   - backend/service changes
   - localization and data bindings
   - switch-over tasks only if approved
4. Use the safest available Clio operation:
   - `create_page` only when a page does not already exist.
   - `get_page` before `update_page`.
   - `validate_page` before saving page bodies.
   - `create_page_business_rule` or `create_entity_business_rule` for supported rules.
   - `update_client_unit_schema` only for non-page client-unit schemas or when raw schema updates are explicitly needed.
5. Compile only when C# schemas or SQL/runtime-compiled artifacts changed, or when Creatio reports a missing runtime schema.
6. Keep the implementation scoped to the approved plan. If new analysis changes scope or migration strategy, stop and request plan re-approval and log it in `decisions.md`.
7. After each artifact, update its `roadmap.md` status and append a `worklog.md` entry with runtime read-back evidence; refresh the README dashboard. Do not rely on memory between sessions.

### 8. Validate

Validate at the narrowest reliable level first, then broaden:

- run page schema validation for Freedom UI bodies
- run repository build or package validation when available
- run relevant unit tests for helper logic
- run integration or browser checks against the target Creatio environment when available
- run or propose E2E coverage for user-visible migrated flows

Report what passed, what could not run, and what remains risky because of missing runtime, repository, permissions, or test coverage.

Only move a task to `VALIDATED` after the Definition of Done in `references/migration-documentation.md` is met and the evidence is recorded in `worklog.md`. Otherwise leave it `DONE` and log the gap as a risk.

## Output Rules

- Match the language of the user.
- Include concrete schema names, package names, page names, and tool evidence when known.
- Separate confirmed facts from inferences.
- Do not hide fallback gaps; put them in the missing-source risks section.
- Always show the migration plan before implementing, for every scope — present it as the structure-analysis summary in plain Markdown in chat per `references/analysis-summary.md` (do not render it as HTML or a page artifact), and stop for explicit approval. Never skip the plan, even for a single small section or an obvious reconcile.
- Do not commit or push without explicit user approval.
- Keep the migration documentation set current; it is the shared source of truth for progress, not the chat history.
