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
- `output/<AppName>/page-sync/*.body.js` when page bodies are materialized outside `plan.md`

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

- Resolve exact executable parameter names, aliases, defaults, and validation rules from `tool-contract-get`.
- `code` must start with `Usr`.
- Default the template choice to the standard Freedom UI app shell when the business draft does not override it.
- `useAIContentGeneration` must be `false`.
- If the chosen template-data mode reuses an existing entity schema, require that entity schema name.
- If icon or client-type identifiers are explicit, validate GUID format.
- Do not introduce technical scope that changes the approved business goal, personas, access posture, or MVP boundary without surfacing it as a blocker or a new assumption.

### Main Entity And Lookup Rules

- For a new app with one primary record type, treat the template-created section entity from `application-create` as the canonical main entity.
- `application-create` itself stays scalar-only; localized entity captions are handled only by follow-up schema tools.
- Use the current `clio` MCP contract and prompts/resources for canonical main-entity selection and lookup display semantics instead of redefining them here.
- When refreshed application context exposes `canonical-main-entity-name`, use it as the primary selector for the app’s main entity. Fall back to the section entity that matches the app code only when the canonical field is absent.
- Map synonymous business nouns back to that entity unless the requirements define a distinct business object.
- Apply the naming contract from `AGENTS.md` Global Invariants for all newly planned entities and custom columns.
- Practical reminder: lookup storage aliases such as `...Id` are backend physical names, not canonical business field codes.
- Reuse `Name` when it already exists.
- Never plan duplicate title-like columns when `Name` is already present.
- Model enum-like business values as lookup entities first.
- Preserve semantic text field types in schema plans: use `Email`, `PhoneNumber`, and `WebLink` for email, phone, and URL fields instead of downgrading them to generic `ShortText`.
- For lookup entities, rely on inherited `Name` and keep it as `PrimaryDisplayColumn`.
- For entity schema payloads, plan `title-localizations` and `description-localizations` as localization maps with an `en-US` entry; legacy scalar `title` and `description` fields are rejected by MCP.
- Keep the model aligned with the approved BA draft. Do not over-engineer additional entities, statuses, or restrictions that were not requested or clearly implied.

### Schema Sync Plan

- Resolve whether `application-create` is sufficient for the app shell and which fields still require follow-up DB-first sync.
- For existing-app work, include explicit discovery through `application-get-list` and `application-get-info`.
- Create lookup entities before entities that reference them.
- Prefer inline lookup `seed-rows` in `schema-sync`; use `create-data-binding-db` only when the workflow explicitly needs a separate binding artifact.
- Each `seed-rows` entry must use the shape `{"values": {"Name": "...", "Description": ""}}` — clio auto-generates `Id` when absent. Flat objects such as `{"Name": "..."}` (without the `values` wrapper) are rejected by clio and produce an error.
- Extend the template-created main entity via `update-entity-schema`.
- Use `create-entity-schema` only for genuinely additional business objects.
- Treat omission as non-deletion. For `update-entity-schema`, plan explicit operations only.
- Canonical entity flow is `application-create -> schema-sync -> application-get-info`.
- Refresh once through `application-get-info` after the schema-sync batch completes.
- Treat success as valid only when refreshed metadata is available and the schema is not left in `Database update required`.

### Default Rules

- A requirement such as `UsrStatus defaults to New` is incomplete until the plan names the field, the default value, and the step that applies it.
- Seed data alone does not satisfy a default requirement.
- For lookup-backed defaults, the plan must choose one of:
  1. `default-value` with `default-value-source: "Const"` set to the seeded row GUID on the column's `update-entity` operation in `schema-sync`
  2. A `crt.CreateRecordRequest` handler in the FormPage `SCHEMA_HANDLERS` block that sets the field value on new-record open
- The chosen mechanism must be included in the page-sync plan and executed. It must never be deferred as `manualCheckPending`.

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

Required execution sequence for each page:

1. `page-list`
2. `page-get`
3. edit body
4. `page-sync`
5. `page-get` again for verification

Fallback page sequence:

1. `page-list`
2. `page-get`
3. `page-update` with `dry-run: true`
4. `page-update`
5. `page-get` again for verification

When page sync is required:

- embed JSON between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->` in `plan.md`
- materialize the same payload to `output/<AppName>/page-sync-plan.json`
- prefer `bodyPath` references over large inline bodies

### Validation Rules

- Prefer `schema-sync` for entity mutations and `page-sync` for page writes.
- Resolve executable parameter names, aliases, and required fields from `tool-contract-get` instead of hard-coding them in the plan.
- Keep `operations` / `update-operations` as native arrays.
- For fallback `create-data-binding-db`, prefer omitting `binding-name` for default lookup seeding so the binding defaults to `<schema-name>`; include `binding-name` only when a distinct binding artifact is explicitly required. Always pass `rows` as a JSON string of `[{"values": {...}}]`.
- Pass MCP booleans such as `dry-run`, `is-required`, and `extend-parent` as booleans, not strings.
- Never add `Name`, `Description`, `UsrName`, `UsrTitle`, or `UsrCaption` as custom lookup columns.
- Never treat seeded rows as implementation of a default rule.
- For `create-lookup`, `create-entity-schema`, and `update-operations` with `action: add`, `title-localizations` must include a non-empty `en-US` value after trim.
- If a business title is missing, derive a non-empty fallback from the schema/column code and place it in the `en-US` localization entry instead of sending blank text.
- For `action: modify`, never send blank/whitespace localization values; omit the localization fields to preserve the existing caption.

## Plan Output

`technical-annex.md` should explain the technical branch, payload decisions, defaults, blockers, and verification strategy.

`plan.md` should be execution-ready and include:

- app payload
- branch choice and collision handling
- ordered schema sync
- default implementation strategy
- page sync contract when required
- explicit blocker notes when the approved business draft is insufficient for safe execution
