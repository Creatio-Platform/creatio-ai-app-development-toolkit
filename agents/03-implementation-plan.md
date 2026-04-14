# Agent 03 - Implementation Plan

## Role

Convert approved business requirements into a deterministic Technical Annex and execution plan for MCP application, entity, binding, and page synchronization calls.

Run this agent only when implementation or technical execution detail is explicitly requested.

The business contract for this agent is the BA-style requirements draft approved in Agent 2. Do not reopen broad business discovery here unless a blocker makes the approved requirements internally inconsistent.

## Input

- `output/<AppName>/requirements.md`
- `output/<AppName>/request-spec.json`
- `output/<AppName>/workflow-state.json`
- `output/<AppName>/.creatio-env.json` when runtime inputs are no longer deferred

## Output

- `output/<AppName>/technical-annex.md`
- `output/<AppName>/plan.md`
- `output/<AppName>/page-sync-plan.json` when page sync is required
- `output/<AppName>/sync-pages/*.body.js` when page bodies are materialized outside `plan.md`

## Read First
Preferred: read `context/.cache/agent-3-bundle.md` when available.

Treat the bundle as stale only when there is explicit evidence that it is outdated for the current run, such as:
- the bundle is missing
- the bundle declares a build timestamp or manifest hash that no longer matches its source set
- the current task requires a reference file that is known to be outside the bundle
- the bundle content is internally inconsistent with currently loaded repository instructions

Fallback (if bundle unavailable or stale):
- `AGENTS.md`
- `context/essentials.md` L166-229 (MCP Tools)
- `context/schema-reference.md` L7-90 (Parents + DataValueTypes)
- `context/business-checklist.md`
- `context/ui-reference.md`
- `context/viewconfig-reference.md`
- `context/data-bindings-reference.md`
- `scripts/mcp_client.py`

## Preconditions

- Implementation or technical execution detail was explicitly requested.
- `scripts/check-planning-gate.sh <AppName>` passes.
- `scripts/check-approval-gate.sh <AppName>` passes.
- If runtime inputs are already available for the current run, `output/<AppName>/.creatio-env.json` exists and its `url` matches the current request URL.

## Planning Goals

- Preserve the approved business scope and assumptions from the BA draft.
- Resolve whether the run is a new-app flow or an existing-app update flow.
- Produce an execution-ready MCP payload.
- Produce an ordered schema sync plan.
- Produce a page sync plan whenever the main entity is created or extended.
- Produce explicit `Model Decisions` for ambiguous `reuse` / `extend` / `create` choices before execution planning begins.
- Make blocker conditions explicit.

## Validation Before Planning

Validate `request-spec.json` and `workflow-state.json`:

- the business checklist is complete
- all required checklist groups have values
- natural-language approval is persisted
- routing mode is known
- runtime inputs are either present or explicitly deferred
- the approved requirements follow the BA-style structure from Agent 2
- the approved requirements are not merely a generic planning wrapper with non-BA headings
- when runtime inputs are available, `.creatio-env.json` points to the same URL as the current request for this run
- if `.creatio-env.json` exists with a different URL, stop and rerun Agent 1 instead of reusing stale runtime artifacts

If any of these checks fail, stop and report the blocker.

Parse the approved requirements with these business sections as primary inputs:

- business goal
- core problem
- desired outcomes and success criteria
- personas and business use cases
- access restrictions posture
- analytics
- business workflow summary
- data model
- explicit assumptions

Before technical planning, derive a draft business-object map from the approved requirements:

- main business object
- secondary business objects
- enum-like lookups
- external references
- any stated or implied reuse candidates

If the approved artifact is wrapped by host tooling such as `<proposed_plan>`, ignore the wrapper and validate the inner document structure only.

## Planning Rules

### App Payload

Resolve:

- application display name
- application code
- template choice
- icon choice/background
- optional description
- optional client type
- optional template-data shape

Rules:

- Resolve exact executable parameter names, aliases, defaults, and validation rules from `get-tool-contract`.
- Treat `create-app` as the canonical app-shell entrypoint with internal Data Forge enrichment already performed by `clio`.
- `code` must start with `Usr`.
- Default the template choice to the standard Freedom UI app shell when the business draft does not override it.
- `useAIContentGeneration` must be `false`.
- If the chosen template-data mode reuses an existing entity schema, require that entity schema name.
- If icon or client-type identifiers are explicit, validate GUID format.
- Do not introduce technical scope that changes the approved business goal, personas, access posture, or MVP boundary without surfacing it as a blocker or a new assumption.

### Main Entity And Lookup Rules

- Use the current `clio` MCP contract and prompts/resources for canonical main-entity selection and lookup display semantics instead of redefining them here.
- Resolve application-shell constraints, main-entity behavior, and localization rules from `docs://mcp/guides/app-modeling`.
- Map synonymous business nouns back to that entity unless the requirements define a distinct business object.
- Apply the naming contract from `AGENTS.md` Global Invariants for all newly planned entities and custom columns.
- Practical reminder: lookup storage aliases such as `...Id` are backend physical names, not canonical business field codes.
- Reuse server-provided display fields when they already satisfy the approved business intent.
- Model enum-like business values as lookup entities first.
- Preserve business semantics for contact and URL fields, but resolve the concrete runtime field type through the live `clio` contract.
- Do not encode executable schema payload field names in the plan. Resolve them at runtime through `get-tool-contract` and `docs://mcp/guides/app-modeling`.
- Keep the model aligned with the approved BA draft. Do not over-engineer additional entities, statuses, or restrictions that were not requested or clearly implied.

### Model Discovery Gate

Run a planning-time reuse assessment for the approved business objects before execution planning begins.
Do not defer this assessment to Agent 4, MCP execution, application-create side effects, or "follow-up discovery during implementation".

#### Triggers

Open the discovery branch for any business object, supporting object, lookup, or reference target that could plausibly map to an existing app or schema.
Treat this as mandatory planning work, not an optional optimization.

This includes, but is not limited to, cases where:

- a business object resembles a standard or already-existing platform concept such as case, request, article, knowledge, activity, comment, account, or contact
- a secondary managed entity could plausibly reuse an existing platform or custom schema
- a reference field has a non-obvious target schema
- the plan may be choosing between `update-entity-schema` and `create-entity-schema`
- the run is an existing-app branch
- a candidate existing `Usr*` schema already appears relevant
- the current discovery step or prior evidence surfaces strong schema candidates through Data Forge

If the approved requirements truly prove a business object is greenfield-only, record that outcome explicitly in `Model Decisions` instead of skipping the assessment silently.
Never treat "the BA draft already named a `Usr*` schema" as proof that the object is greenfield-only.

#### Canonical Discovery Sequence

For the conditional discovery branch, use read-only tools only and resolve candidates in this order:

1. `dataforge-find-tables`
2. `dataforge-find-lookups`
3. `dataforge-context`
4. When a strong candidate is found:
   - `get-app-info` for app-level context when the candidate belongs to an existing app
   - `get-entity-schema-properties` for candidate schema inspection
   - `get-entity-schema-column-properties` only when a specific column remains ambiguous

Do not use `dataforge-initialize` or `dataforge-update` during planning.

#### Required Model Decisions

The plan must record a `Model Decisions` section for:

- the main entity when there is any plausible existing candidate
- every additional business entity
- every new lookup when an existing lookup candidate was considered
- every non-obvious reference field target
- every planned schema creation or extension step referenced later in ordered schema sync

Each decision record must include:

- `business-concept`
- `candidates-considered`
- `chosen-action`: `reuse` | `extend` | `create`
- `chosen-schema`
- `rationale`
- `rejected-candidates`
- `discovery-evidence`

The plan is incomplete if discovery surfaced a strong candidate and the resulting `reuse` / `extend` / `create` choice is not recorded explicitly.
The plan is also incomplete when a plausible candidate existed from the business wording but the record does not say `no suitable candidate found` or otherwise explain why `create` was selected.
The plan is invalid if Ordered Schema Sync references a created or extended schema that does not have a corresponding `Model Decisions` record.

#### Deterministic Choice Rules

- Choose `reuse` when an existing schema already satisfies the required business role without unacceptable coupling cost.
- Choose `extend` when the business role matches an existing custom or main entity and only additional fields or localized behavior are missing.
- Choose `create` only when no suitable candidate exists, or when an explicit architectural reason rules out reuse.
- Record `no suitable candidate found` explicitly when discovery ran and the result still leads to `create`.
- `create` is never allowed as a placeholder choice for "decide later during implementation".

Acceptable reasons for `create`:

- ownership boundary
- unwanted coupling to a platform schema
- lifecycle or semantics mismatch
- the candidate schema is broader than the approved scope

Unacceptable reasons for `create`:

- the BA plan already mentioned a custom entity
- the team already intended to create a new schema
- `Usr*` naming preference without further architectural rationale

#### Discovery Evidence Rule

- missing discovery evidence is a blocker whenever a reuse candidate was plausible from the business wording, approved model, or app/update context.
- weak discovery evidence is also a blocker. Generic statements such as "new schema needed", "custom app requested", or "follow implementation defaults" do not satisfy this requirement.
- outcome-only evidence is a blocker. Writing `greenfield-only` or `no suitable candidate found` without citing at least one attempted read-only tool call does not pass the implementation plan gate. The discovery-evidence field must contain at least one tool name (`dataforge-find-tables`, `dataforge-find-lookups`, `dataforge-context`, `application-get-info`, `application-get-list`, or `get-entity-schema-properties`).
- when DataForge tools fail (e.g. HTTP 401, timeout), cite the attempted call and the fallback tool used. For example: `dataforge-find-tables attempted (401 Unauthorized), application-get-info returned no matching app` is valid evidence for a greenfield-only conclusion.

### Schema Sync Plan

- Resolve whether `create-app` is sufficient for the app shell and which fields still require follow-up DB-first sync.
- Do not add a separate mandatory `dataforge-*` preflight to the standard new-app branch; standalone Data Forge tools are for explicit inspection or remediation only.
- For existing-app work, include the current `clio`-owned discovery and inspection flow instead of hard-coding request semantics here.
- Create lookup entities before entities that reference them.
- Prefer batched lookup seeding inside the current `clio`-owned schema mutation flow; use `create-data-binding-db` only when the workflow explicitly needs a separate binding artifact.
- Extend the template-created main entity via `update-entity-schema`.
- Use `create-entity-schema` only for genuinely additional business objects.
- Do not emit a schema-creation step unless the matching `Model Decisions` record already resolved that exact business concept to `chosen-action: create`.
- Treat omission as non-deletion. For `update-entity-schema`, plan explicit operations only.
- Resolve the preferred post-mutation refresh step through `get-tool-contract` and `docs://mcp/guides/app-modeling`.
- Treat success as valid only when refreshed metadata is available and the schema is not left in `Database update required`.

### Default Rules

- A requirement such as `UsrStatus defaults to New` is incomplete until the plan names the field, the default value, and the step that applies it.
- Seed data alone does not satisfy a default requirement.
- For lookup-backed defaults, the plan must choose an executable mechanism resolved at runtime through the live contract or an explicit page-side handler when the default belongs to page behavior.
- The chosen mechanism must be included in the sync-pages plan and executed. It must never be deferred as `manualCheckPending`.

### Page Sync Plan

Page sync is mandatory when the plan creates a new app or extends the main section entity.

FormPage defaults:

- keep `Name` as header/title when present
- include all approved required non-inherited business fields
- fill in missing explicit requirements with deterministic defaults

ListPage defaults:

- always include `Name`
- always include required non-inherited business fields
- append compact operational fields in this priority order until the grid remains compact: status/lifecycle, priority/severity, type/category, due/start/end date, owner/assignee, code/number, amount
- cap auto-selected columns at 6 unless required fields exceed that number
- exclude inherited audit/system fields unless explicitly requested
- exclude long/rich/blob fields unless explicitly requested or required

Resolve the preferred page execution and verification sequence through `get-tool-contract` and `docs://mcp/guides/existing-app-maintenance`.

When page sync is required:

- embed JSON between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->` in `plan.md`
- materialize the same payload to `output/<AppName>/page-sync-plan.json`
- prefer `bodyPath` references over large inline bodies

### Validation Rules

- Prefer `sync-schemas` for entity mutations and `sync-pages` for page writes.
- Resolve executable parameter names, aliases, defaults, and nested request shapes from `get-tool-contract` instead of hard-coding them in the plan.
- Never add redundant custom lookup columns that duplicate server-provided display fields.
- Never treat seeded rows as implementation of a default rule.

## Plan Output

`technical-annex.md` should explain the technical branch, payload decisions, defaults, blockers, verification strategy, and any planning-time reuse decisions.

`plan.md` should be execution-ready and include:

- app payload
- branch choice and collision handling
- `Model Decisions` with explicit `reuse` / `extend` / `create` records for every ambiguous model choice
- ordered schema sync
- default implementation strategy
- page sync contract when required
- explicit blocker notes when the approved business draft is insufficient for safe execution
