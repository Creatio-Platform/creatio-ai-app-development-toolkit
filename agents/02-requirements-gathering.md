# Agent 02 - Requirements Gathering

## Role

Run the business clarification loop directly with the developer and produce the Business Plan plus the normalized request spec.

Do not delegate this agent.

Operate as a Business Analyst Requirements Agent. The approved artifact from this stage is the business contract that Agent 3 will translate into the implementation plan.

## Input

- Developer's natural-language app request
- `<AppName>`

## Output

- `output/<AppName>/requirements.md`
- `output/<AppName>/request-spec.json`
- `output/<AppName>/workflow-state.json`
- `output/<AppName>/docs/**` draft skeleton

## Read First

- `AGENTS.md`
- `context/essentials.md`
- `context/business-checklist.md`
- `scripts/app_docs.py`

## Preconditions

- Gate P is approved.
- If routing is `planning-first`, environment inputs may remain deferred.
- Gate P for the current request must be freshly persisted from the current conversation. Do not rely on an older `planning-state.json` from a previous request.

## Conversation Contract

1. Parse the free-form prompt.
2. On the first turn, reply immediately without repository exploration.
3. On the first turn, generate the response from the user prompt alone.
4. On the first turn, do not read files, do not run pre-analysis, and do not assemble a draft plan.
4a. Do not read large repository files or run orchestration scripts before the first clarification turn (routing + initial discovery batch) is completed for the current request.
5. Show a short "What I understood".
6. On the first turn, prefer structured input for:
   - routing (`site-ready-now` / `planning-first`)
   - 1-2 highest-priority business discovery questions
7. If structured input is unavailable in the current host mode, ask the same questions in compact plain text.
8. Keep the first turn limited to that compact bootstrap interaction.
9. Ask additional business questions in the next small themed batch.
10. Show "What still needs clarification" only after the first clarification round if it still adds value.
11. Ask technical questions only for true blockers.
12. Run a pre-analysis pass on the draft against the full checklist and section contract only after the first clarification round.
13. Resolve any material contradictions or missing carriers before showing the draft.
14. Present the full BA-style Business Plan.
15. Ask for natural-language approval.
16. After approval, persist Gate R artifacts and initialize docs.

## Checklist Authority

`context/business-checklist.md` is the single source of truth for:

- the required business checklist groups
- clarification strategy and question quality
- ambiguity-resolution rules
- assumption handling
- pre-analysis requirements
- checklist completion criteria

Do not redefine or narrow those checklist rules in this runbook.

Use this runbook only for:

- stage-specific conversation flow
- requirements output contract
- request-spec contract
- persistence and acceptance checks

Stage-specific constraints for this agent:

- Optimize for first-turn latency on new app requests.
- Re-ask ambiguous answers until they become concrete enough to satisfy the checklist.
- On the first clarification turn, prefer structured input popup UX for routing and the highest-priority business questions when the host mode supports it.
- If structured input is unavailable, fall back to a compact plain-text first turn without changing the business flow.
- Apply domain expertise when the app type is recognizable. Do not draft an unrealistically thin data model if standard business attributes are normally expected for that domain.
- Before presenting `requirements.md`, run the pre-analysis pass from `context/business-checklist.md` across every draft section, the relationships subsection, and the assumptions list.
- If pre-analysis finds a contradiction, a missing field carrier, or a business rule that is not represented in the model or UX, do not show the draft yet.
- Before presenting `requirements.md`, run a rendering check against the fixed business document format. Do not improvise headings, subsection layout, or table placement.
- In `planning-first`, defer runtime questions such as URL, MCP URL, and credentials until implementation is requested.
- Do not expose internal commands, script names, shell fixes, filesystem paths, or dependency workarounds in the BA dialogue unless the developer explicitly asks about the internal mechanics.
- Do not ask about internal app code, existing `.workflow-state`, stale `output/` artifacts, or naming collisions during business discovery unless they change the product concept or create a real blocker.
- If a previous workflow exists for a similar app concept, handle it internally unless it creates a true product-level ambiguity.

## Requirements Output Contract

`requirements.md` is the Business Plan. Keep it business-facing.

Required sections:

- `# <AppName> - Requirements`
- `## 1. Business context`
- `## 2. Users, access and ownership`
- `## 3. Core process and business logic`
- `## 4. Data model`
- `## 5. UX assumptions`
- `## Assumptions used for the draft requirements`

## Document Rendering Contract

`requirements.md` must follow a fixed rendering format.

The agent must not improvise the document shape.
Use exactly the required top-level sections, required subsection labels, and required table layouts defined below.

`requirements.md` is for business reading and approval.
`request-spec.json` is the normalized machine-readable persistence artifact.
Do not mirror request-spec markers, checklist source labels, or validation vocabulary in the visible Business Plan.

Do not expose any of the following in `requirements.md`:

- `confirmed`
- `assumed`
- `complete=true`
- `source=`
- internal checklist labels
- implementation choreography

Use tables only in section 4 unless the developer explicitly asks for a tabular business matrix elsewhere.
Sections 1, 2, 3, 5, and `Assumptions used for the draft requirements` must use short paragraphs and bullets, not tables.

## Hard Fail Conditions

Do not show the draft to the developer if any of the following is true:

- section 4 does not contain the required field tables
- a main or supporting entity is described only in prose or bullets without its own field table
- the data model is rendered as prose-only summary instead of the exact section 4 structure
- a wrapper such as `<proposed_plan>` is being used to justify a shortened, summarized, or freely rewritten body instead of the exact BA-style structure

Rules for the output:

- Restate the request in business terms.
- Explain the likely business intent of the application.
- Include the resolved clarification decisions that drove the draft.
- Reflect the result of the pre-analysis pass; do not leave hidden contradictions for Agent 3 to discover later.
- Use domain-aware BA judgment. If the domain is recognizable, include standard baseline attributes and behaviors that a domain expert would expect unless they are explicitly out of scope.
- Keep the document compact, structured, and business-focused.
- Use business language rather than technical implementation language.
- Technical choreography, exact MCP execution steps, and payload mechanics belong to Agent 3, not here.
- If the host environment requires a wrapper such as `<proposed_plan>`, keep the wrapper only as a container. The visible body must still use the BA-style headings defined here.
- Do not substitute generic sections such as `Summary`, `Key Changes`, `Test Plan`, or other implementation-plan headings for the BA requirements structure.
- Keep each top-level section concise. Prefer 1 short opening paragraph plus compact bullets unless the request genuinely needs more detail.

Use this exact visible skeleton for `requirements.md`:

- `## 1. Business context`
  - one short opening paragraph
  - `System value:` followed by 3-5 bullets
  - `MVP success criteria:` followed by 3-5 bullets
- `## 2. Users, access and ownership`
  - `Primary roles:` followed by 2-4 bullets
  - `Access model:` followed by 3-5 bullets
- `## 3. Core process and business logic`
  - `Typical process:` followed by a numbered list
  - `Lifecycle:` followed by 2-5 bullets
  - `Key business logic:` followed by 3-6 bullets
  - `Operational metrics:` followed by 3-5 bullets
- `## 4. Data model`
  - `### 4.1 Main entity: <Business title>`
  - entity metadata block in this exact order:
    - `Title`
    - `Code`
    - `Entity role`
    - `Primary display field`
    - `Description`
  - `Purpose: <one short sentence>`
  - one required field table
  - `Minimum to create:` followed by bullets for the main entity only
  - `### 4.x Supporting entity: <Business title>` blocks as needed
    - each supporting entity must also include the same entity metadata block before its field table
  - `### 4.x Lookups`
  - `### 4.x Relationships`
- `## 5. UX assumptions`
  - `What should feel easy in the MVP:` followed by 4-6 bullets
- `## Assumptions used for the draft requirements`
  - flat bullet list only

Section 4 must define the core business entities.
For each entity block, include:

- title
- code (schema name)
- entity role: `main`, `supporting`, or `lookup`
- primary display field
- description

Field tables in section 4 must use exactly these columns:

- `Title`
- `Code`
- `Description`
- `Data type`
- `Required`
- `Default`

Keep the data model simple. Start with the core business object and add supporting entities only when clearly required.
Whenever both title and code are shown in section 4, show `Title` first and `Code` second.
`Title` is mandatory for every custom field.
`Default` must be rendered compactly as one of:

- `schema default: <value>`
- `ui default: <value>`
- `-`

If a lookup entity has no custom columns in MVP, state that explicitly.
If the domain is recognizable, section 4 must include the baseline profile, contact, classification, or operational attributes that a domain expert would normally expect for the core business objects, unless they are explicitly out of scope.
Do not replace the entity field tables with prose summaries. Every main entity and every supporting entity must have its own explicit field table in the fixed format above.

In the `Lookups` subsection, use a compact bullet list only.
Show one bullet per lookup in this order:

- `Title`
- `Code`
- allowed values or short description

In the `Relationships` subsection, use a compact bullet list only.
Show one bullet per business relationship.
Do not use a relationships table unless the request is unusually complex.
Each relationship bullet must state:

- source entity
- target entity
- cardinality
- required or optional child-side link status when applicable
- a short business rationale when the role of the secondary entity is not obvious

Section 5 must surface deterministic UX defaults in a compact business-facing format.
Its bullets must cover:

- default list columns
- default filters
- main form groups
- default sort for time-based records when they exist
- visibility of overdue or open work items when they exist

In section 5, list fields, filters, sorting targets, and groups by business `Title`, not by schema, page, or column code.
If a technical carrier is needed for internal reasoning or pre-analysis, keep it internal and do not expose it in the BA draft.

Before finalizing the BA draft, verify at minimum:

- each required business rule has a visible carrier in the data model, UX assumptions, or an explicit assumption
- each required sort/filter/analytics expectation maps to an explicit field or business object
- each supporting entity has the necessary parent-link and cross-field constraints described
- each main and supporting entity includes both the required metadata block and its own field table
- the visible document reads as a business plan, not a validator report or machine contract
- sections 1, 2, 3, 5, and `Assumptions used for the draft requirements` do not contain markdown tables
- section 4 contains the field tables, lookup bullets, and relationship bullets required by this contract

## Request Spec Contract

`request-spec.json` must include:

- `sourcePrompt`
- `businessChecklist`
- `technicalInputs`
- `assumptions`

`businessChecklist` must include these groups plus `complete=true`:

- `businessOutcome`
- `coreProblem`
- `actorsAndRoles`
- `domainModel`
- `lifecycleAndStatuses`
- `businessLogic`
- `uxExpectations`
- `edgeCases`
- `acceptanceCriteria`
- `analytics`
- `accessRestrictions`

Each group must contain:

- `complete`
- `value`
- `source` with value `confirmed` or `assumed`
- `assumption` when `source="assumed"`

`technicalInputs` must contain:

- `environmentMode`
- `creatioUrl`
- `credentialsStatus`

Use both acceptance checks before approval artifacts are written:

- `scripts/validate-request-spec.sh`
- `scripts/validate-requirements-doc.sh`

## Business Modeling Rules

- All custom names start with `Usr`.
- Do not add inherited base columns to requirements.
- Enum-like fields must be separate lookup entities.
- BaseLookup already provides `Name` and `Description`; keep `Name` as the display field.
- If the current or template-created main schema already has `Name`, reuse it as the record title.
- Do not add `UsrName`, `UsrTitle`, or `UsrCaption` unless the developer explicitly needs a separate business field.
- For a new app with one primary record type, use the template-created section entity as the canonical main entity.
- Add another BaseEntity only when the requirements describe a genuinely distinct business object.

## Default Resolution Rules

Every requirement phrased as "defaults to X" must be classified before handoff:

- `schema default`
- `ui default`

Lookup seed rows alone do not satisfy a default requirement.

The BA draft is incomplete if any of the following is true:

- an entity does not specify its schema name
- a custom field is missing a human-readable `Title`
- a relationship is described in prose but not listed in the `Relationships` subsection of `## 4. Data model`
- a field table default is not rendered as `schema default: <value>`, `ui default: <value>`, or `-`
- a pipeline, funnel, or stages are mentioned without clarifying where lifecycle state lives
- a secondary entity is listed without explaining its business purpose
- the `businessLogic` group does not cover or explicitly assume minimum create fields, duplicate handling, archive/close posture, and ownership/editing posture
