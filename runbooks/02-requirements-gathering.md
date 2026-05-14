# Agent 02 - Requirements Gathering

## Role

Run the business clarification loop directly with the developer and produce the Business Plan.

Do not delegate this agent.

This agent is for full app generation or business-shaped feature work only.
Do not invoke Agent 2 for targeted changes such as adding a concrete object, column, page element, handler, or lookup row when the request is already implementation-ready.

Operate as a Business Analyst Requirements Agent. The approved artifact from this stage is the business contract that drives the implementation plan.

## Input

- Developer's natural-language app request
- `<AppName>`

## Read First

Read these repository files for the BA stage:
- `AGENTS.md`
- `context/business-checklist.md`
- `context/essentials.md` (only the sections needed for the current question batch)

## Preconditions

- Gate P is approved.
- Environment inputs are deferred until after Gate R approval.

## Conversation Contract

1. Parse the free-form prompt.
2. Apply first-turn latency rules from `AGENTS.md` (UX Contract): reply immediately from the prompt, use structured input when the host supports it, otherwise compact plain text.
3. On the first turn, ask the main 3-5 business discovery questions.
4. Do not read large repository files or run heavy setup steps before the first clarification round completes.
5. Ask additional business questions in the next small themed batch.
6. Show "What still needs clarification" only after the first clarification round if it still adds value.
7. Ask technical questions only for true blockers.
8. Run a pre-analysis pass on the draft against the full checklist and section contract only after the first clarification round.
9. Resolve any material contradictions or missing carriers before showing the draft.
10. Present the full BA-style Business Plan followed immediately by the Technical Implementation Handoff in the same message.
11. Ask for natural-language approval using this exact closing line:
    > "Does this Business Plan look good? If yes, provide your Creatio URL and credentials to proceed with implementation."
12. After approval, validate the documents inline, collect runtime inputs, run Agent 1 to set up the environment, then implement using clio MCP tools.

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
- persistence and acceptance checks

Stage-specific constraints for this agent:

- Optimize for first-turn latency on new app requests.
- Re-ask ambiguous answers until they become concrete enough to satisfy the checklist.
- On the first clarification turn, prefer structured input popup UX for routing and the highest-priority business questions when the host mode supports it.
- If structured input is unavailable, fall back to a compact plain-text first turn without changing the business flow.
- Apply domain expertise when the app type is recognizable. Do not draft an unrealistically thin data model if standard business attributes are normally expected for that domain.
- Before presenting the Business Plan, run the pre-analysis pass from `context/business-checklist.md` across every draft section, the relationships subsection, and the assumptions list.
- If pre-analysis finds a contradiction, a missing field carrier, or a business rule that is not represented in the model or UX, do not show the draft yet.
- Before presenting the Business Plan, run a rendering check against the fixed business document format. Do not improvise headings, subsection layout, or table placement.
- Defer runtime questions such as URL and credentials until after Gate R approval.
- Internal mechanics, script paths, workflow-state collisions, and stale artifacts are governed by the global invariants in `AGENTS.md`.
- Do not expose internal commands, script names, shell fixes, filesystem paths, or dependency workarounds in BA dialogue unless the developer explicitly asks about the internal mechanics.
- Do not surface workflow-state collisions, stale artifacts, or similar internal repository details in BA dialogue unless they create a genuine product-level ambiguity.

## Requirements Output Contract

The Business Plan is the business-facing requirements document.

The Business Plan is presented inline in the visible conversation body. The deliverable for this stage is the plan visible in the conversation plus the developer's natural-language approval — not a file. Saving a copy to disk is neither required nor a substitute for the inline presentation.

Host-mode plan hooks (e.g., `exit_plan_mode`, IDE plan-approval dialogs, system-injected approval popups) do not substitute for presenting the Business Plan inline. The full 7-section body must appear in the visible conversation before the developer approves; a summary block inside a host approval dialog is not the Business Plan and clicking "approve" on it does not satisfy Gate R.

Required sections:

- `# <AppName> - Requirements`
- `## 1. Business Outcome`
- `## 2. Roles and Permissions`
- `## 3. Object Model`
- `## 4. Lifecycle and Statuses`
- `## 5. Business Logic`
- `## 6. UX Expectations`
- `## 7. Edge Cases and Exceptions`

## Document Rendering Contract

The Business Plan must follow the exact BA-style structure defined in `AGENTS.md` and `context/business-checklist.md`.
The agent must not improvise the document shape.

Do not expose any of the following in the Business Plan:

- `confirmed`
- `assumed`
- `complete=true`
- `source=`
- internal checklist labels
- implementation choreography

Use tables only in `## 3. Object Model` unless the developer explicitly asks for a tabular business matrix elsewhere.
Sections `1`, `2`, `4`, `5`, `6`, and `7` must use short paragraphs and bullets, not tables.

## Pre-Write Self-Check

Before presenting the Business Plan to the developer, verify the assembled draft contains all seven sections in the exact order:

1. `## 1. Business Outcome`
2. `## 2. Roles and Permissions`
3. `## 3. Object Model`
4. `## 4. Lifecycle and Statuses`
5. `## 5. Business Logic`
6. `## 6. UX Expectations`
7. `## 7. Edge Cases and Exceptions`

If any required section is absent, renamed, or out of order, do not present the draft.
Regenerate the missing section from conversation context or business discovery before presenting.

## Hard Fail Conditions

Do not show the draft to the developer if any of the following is true:

- a required top-level section is missing, renamed, reordered, or merged
- `## 3. Object Model` does not contain the required field tables
- a main or supporting entity is described only in prose or bullets without its own field table
- the object model is rendered as prose-only summary instead of the required `## 3. Object Model` structure
- a wrapper such as `<proposed_plan>` is being used to justify a shortened, summarized, or freely rewritten body instead of the exact BA-style structure

Rules for the output:

- Restate the request in business terms.
- Explain the likely business intent of the application.
- Include the resolved clarification decisions that drove the draft.
- Reflect the result of the pre-analysis pass; do not leave hidden contradictions for the implementation stage to discover later.
- Use domain-aware BA judgment. If the domain is recognizable, include standard baseline attributes and behaviors that a domain expert would expect unless they are explicitly out of scope.
- Keep the document compact, structured, and business-focused.
- Use business language rather than technical implementation language.
- Technical choreography, exact MCP execution steps, and payload mechanics belong to the implementation stage, not here.
- Keep business concepts and technical schema decisions separate. Agent 2 may name a likely business object or platform concept, but must not lock `reuse`, `extend`, or `create` as a final technical decision when that choice may depend on live discovery during implementation.
- When the BA draft shows a likely schema code or custom lookup name, treat it as a planning placeholder rather than a binding implementation commitment.
- If the host environment requires a wrapper such as `<proposed_plan>`, keep the wrapper only as a container. The visible body must still use the BA-style headings defined here.
- Do not substitute generic sections such as `Summary`, `Key Changes`, `Test Plan`, or other implementation-plan headings for the BA requirements structure.
- Keep each top-level section concise. Prefer 1 short opening paragraph plus compact bullets unless the request genuinely needs more detail.

Use this exact visible skeleton for the Business Plan:

- `## 1. Business Outcome`
- `## 2. Roles and Permissions`
- `## 3. Object Model`
  - `### 3.1 Main entity: <Business title>`
  - entity metadata block in this exact order:
    - `Title`
    - `Code`
    - `Entity role`
    - `Primary display field`
    - `Description`
  - `Purpose: <one short sentence>`
  - one required field table
  - `Minimum to create:` followed by bullets for the main entity only
  - `### 3.x Supporting entity: <Business title>` blocks as needed
    - each supporting entity must also include the same entity metadata block before its field table
  - `### 3.x Lookups`
  - `### 3.x Relationships`
- `## 4. Lifecycle and Statuses`
- `## 5. Business Logic`
- `## 6. UX Expectations`
- `## 7. Edge Cases and Exceptions`

`## 1. Business Outcome` must include:

- business goal
- core problem / pain point
- success signal or expected result
- explicit assumptions that remain in scope

`## 2. Roles and Permissions` must include:

- actors and responsibilities
- access posture or ownership limits
- persona notes when they materially affect behavior

`## 3. Object Model` must define the core business entities.
For each entity block, include:

- title
- code (schema name)
- entity role: `main`, `supporting`, or `lookup`
- primary display field
- description

Field tables in section 3 must use exactly these columns:

- `Title`
- `Code`
- `Description`
- `Data type`
- `Required`
- `Default`

Keep the object model simple. Start with the core business object and add supporting entities only when clearly required.
Whenever both title and code are shown in `## 3. Object Model`, show `Title` first and `Code` second.
`Title` is mandatory for every custom field.
`Default` must be rendered compactly as one of:

- `<business default value>`
- `-`

Do not use implementation labels such as `schema default` or `ui default` in the visible BA draft.
If a lookup entity has no custom columns in MVP, state that explicitly.
If the domain is recognizable, `## 3. Object Model` must include the baseline profile, contact, classification, or operational attributes that a domain expert would normally expect for the core business objects, unless they are explicitly out of scope.
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

`## 6. UX Expectations` must surface deterministic UX defaults in a compact business-facing format.

Its bullets **must use these exact text labels** (colon included) — the validator checks for them verbatim:

- `default list columns:` — followed by comma-separated field Titles, e.g. `default list columns: Title, Status, Priority`
- `default filters:` — followed by the filter field Title, e.g. `default filters: Status`
- `main form groups:` — followed by a description, e.g. `main form groups: Details (Title, Description), Assignment (Status, Assignee)`

Also include when applicable:

- default sort for time-based records
- visibility of overdue or open work items

In `## 6. UX Expectations`, list fields, filters, sorting targets, and groups by business `Title`, not by schema, page, or column code.
If a technical carrier is needed for internal reasoning or pre-analysis, keep it internal and do not expose it in the BA draft.

Before finalizing the BA draft, verify at minimum:

- each required business rule has a visible carrier in the object model, lifecycle/statuses, business logic, UX expectations, or an explicit assumption
- each required sort/filter/analytics expectation maps to an explicit field or business object
- each supporting entity has the necessary parent-link and cross-field constraints described
- each main and supporting entity includes both the required metadata block and its own field table
- the visible document reads as a business plan, not a validator report or machine contract
- sections `1`, `2`, `4`, `5`, `6`, and `7` do not contain markdown tables
- `## 3. Object Model` contains the field tables, lookup bullets, and relationship bullets required by this contract

Before presenting the draft for approval, save the Business Plan to a temp file and validate using the platform-appropriate command:

**Windows (PowerShell):**
```powershell
# Validate Business Plan
Get-Content "$env:TEMP\<appname>-plan.md" -Raw | py -3 -c "
import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
from runtime.scripts.workflow_validators import validate_requirements_doc
validate_requirements_doc(sys.stdin.read())
print('Business Plan validation PASSED')
"
```

**macOS / Linux (bash):**
```bash
python3 -c "
import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
from runtime.scripts.workflow_validators import validate_requirements_doc
validate_requirements_doc(sys.stdin.read())
print('Business Plan validation PASSED')
" < /tmp/<appname>-plan.md
```

If validation raises `WorkflowError`, fix the artifact and re-validate before presenting for approval.

## Business Modeling Rules

- Business Plan codes are plain PascalCase without any prefix (e.g., `TodoList`, `Status`). Do not add or assume a prefix — clio MCP applies it during implementation.
- Do not add inherited base columns to requirements.
- Enum-like fields must be separate lookup entities.
- For canonical main-entity rules, record-title assumptions, and lookup display semantics, follow the current `clio` MCP app-modeling guidance instead of restating those mechanics here.
- Add another BaseEntity only when the requirements describe a genuinely distinct business object.
- If a recognizable business concept might map to an existing platform or custom schema, describe the concept in business terms and leave the final `reuse` / `extend` / `create` decision to the implementation stage after live model discovery.
- When that ambiguity exists, note it in the Technical Implementation Handoff "Reuse Discovery Signals" block so the implementation stage opens the discovery branch for that concept.

## Default Resolution Rules

Every requirement phrased as "defaults to X" must be explicit before handoff.
State the target field and default value in business language.
Leave the enforcement mechanism to implementation planning under the current `clio` MCP guidance.

The BA draft is incomplete if any of the following is true:

- an entity does not specify its schema name
- a custom field is missing a human-readable `Title`
- a relationship is described in prose but not listed in the `Relationships` subsection of `## 3. Object Model`
- a field table default is not rendered as an explicit business default value or `-`
- a pipeline, funnel, or stages are mentioned without clarifying where lifecycle state lives
- a secondary entity is listed without explaining its business purpose
- the `businessLogic` group does not cover or explicitly assume minimum create fields, duplicate handling, archive/close posture, and ownership/editing posture

## Technical Implementation Handoff

Present the Technical Implementation Handoff immediately after the 7-section Business Plan in the same message, before asking for approval.

This block is **not** a BA section. It is not numbered and not subject to BA format rules.
It is consumed by the implementing code agent running in a separate session with clio MCP tools.

### Format

```
---

## Technical Implementation Handoff

**Environment:**
- Name: <env_name or "Not yet configured">
- URL: <URL or "Deferred">
- Runtime: <.NET Core / .NET Framework or "Deferred">

**Schema naming note:** Business Plan codes (e.g., `TodoTask`) are prefix-free base names. During implementation, clio MCP applies the environment's SchemaNamePrefix — actual schema codes in Creatio will reflect that prefix (e.g., `UsrTodoTask` if the prefix is `Usr`).

**Reuse Discovery Signals:**
<For each business concept that might map to an existing platform entity:>
- Business concept: <concept name>
  - Why ambiguous: <reason>
  - Suspected candidates: <comma-separated list of prefix-free base names>
<If none: "None — all entities are new custom objects.">
```

### Population rules

- Set `Environment` to its deferred values; populate `Reuse Discovery Signals` from the business analysis (any concept that might map to an existing platform or custom entity).
- Do not expose internal checklist markers, validation vocabulary, or tool payloads in this block.
