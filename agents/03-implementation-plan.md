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

When the plan includes standalone page creation (not through `create-app-section`), resolve the page creation flow through `docs://mcp/guides/page-creation`.

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

Agent 3 is the authoritative technical rewrite stage for model choice.
The approved BA draft preserves business intent, but live discovery may amend the technical plan when schema or lookup reuse becomes viable.

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

- business outcome, including problem framing, success signal, and explicit assumptions
- roles and permissions, including personas and access posture
- business workflow summary
- object model
- edge cases and operational constraints

Before technical planning, derive a draft business-object map from the approved requirements:

- main business object
- secondary business objects
- enum-like lookups
- external references
- any stated or implied reuse candidates
- any `planningSignals.reuseCheckRequired` concepts carried forward from Agent 2

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
  Use `tool-names` (array, plural) to target only the tools you need, e.g. `{"tool-names": ["create-app"], "environment-name": "..."}`.
  Omitting `tool-names` returns all 80+ tools (~300 KB) and requires a secondary extraction step.
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

### Plan Amendment Rule

Agent 2 may suggest business concepts, likely schema names, and suspected candidates, but it does not freeze the final technical model.
Live discovery may amend the technical plan after Gate R.
If the BA draft names `Usr*` placeholder schemas or custom lookups but discovery finds a viable existing candidate, Agent 3 must update `Model Decisions`, `technical-annex.md`, and ordered schema sync to reflect the stronger technical choice.
`Model Decisions` are authoritative for execution.
Earlier business wording is not a blocker to `reuse` unless the user explicitly required technical isolation, custom ownership, or separate governance as a business requirement.
This override still applies even if Agent 2, the BA draft, or an earlier plan preferred `create`.

### Model Discovery Gate

Run a planning-time reuse assessment for the approved business objects before execution planning begins.
Do not defer this assessment to Agent 4, MCP execution, application-create side effects, or "follow-up discovery during implementation".

#### `mcp_client.py` invocation cheat-sheet

All `dataforge-*` calls below are made through `scripts/mcp_client.py`.
Use this exact invocation shape — do not invent argparse flags.

```powershell
# PowerShell — pipe JSON via stdin (preferred)
'{"environment-name":"<env>"}' | py -3 scripts\mcp_client.py <tool-name> --args-stdin --timeout 60
```

```bash
# bash — same pattern
echo '{"environment-name":"<env>"}' | py -3 scripts/mcp_client.py <tool-name> --args-stdin --timeout 60
```

There is **no `--args-json` flag**. The only argument sources are:
`<args-json>` (legacy positional, single JSON string), `--args-file <path>`, or `--args-stdin` with piped JSON.
Resolve `<env>` from `output/<AppName>/.creatio-env.json`.

Agent 3 must run `dataforge-status` once before the first explicit `dataforge-*` planning call.

`dataforge-status` itself requires `environment-name`. Example payload:

```json
{"environment-name": "<env from .creatio-env.json>"}
```

An empty body `{}` returns `invalid-request` ("Missing required connection parameters").

- If `status.status == "Ready"`, proceed with the normal active DataForge discovery branch and the current Evidence Ladder.
- If `status.status != "Ready"` or the `dataforge-status` call throws, skip all active DataForge calls for the current session.
- In that unavailable mode, record `dataforge-availability: unavailable` in `plan.md` and `technical-annex.md`.
- When `dataforge-availability: unavailable` is recorded, Agent 3 should not run the reuse/extend/create discovery branch and should not require DataForge-based evidence or fallback proof for the skipped branch.
- Do not add this preflight before passive-enrichment write tools; it applies only to explicit active DataForge use during planning.

#### DataForge Unavailable — Fast Path

When `dataforge-availability: unavailable` is recorded, follow this fast path directly.
Do NOT read or analyze the validator source code in `scripts/workflow_cli.py` to determine what fields or phrases are required. The rules below are the complete specification.

This rule applies to **all** `validate-implementation-plan-doc` failures, not only the unavailable fast path.
On a validator failure, fix the artifact based on the error string returned by the script. The canonical templates already live in this runbook (the `Model Decisions` section below) and in `context/model-discovery-evidence.md` — opening `scripts/workflow_cli.py` to reverse-engineer regexes is wasted work and forbidden.

**Checks that are SKIPPED when DataForge is unavailable:**

- `discovery-evidence` does not need to cite any tool names (`dataforge-*`, `application-get-*`, `get-entity-schema-*` are not required)
- no follow-up discovery (`dataforge-context`) required
- no schema-level confirmation required
- no strong-candidate reuse-first policy checks
- no Evidence Ladder steps

**Checks that STILL APPLY when DataForge is unavailable:**

- all 11 required fields must be present in each decision record
- `tradeoff-escalation` must be `none`
- if `chosen-action: create`, then `rejected-candidates` or `mismatch-evidence` must contain at least one rejection-reason phrase from this list: `no suitable candidate found`, `greenfield-only`, `ownership boundary`, `unwanted coupling`, `lifecycle mismatch`, `semantic mismatch`, `broader than scope`, `field mismatch`, `column mismatch`, `relation mismatch`, `status mismatch`, `shared lookup`, `module coupling`, `does not match`, `does not fit`
- every schema referenced in Ordered Schema Sync with `create`, `extend`, or `update` action must have a matching Model Decisions record

**Template — `create` decision when DataForge is unavailable:**

```
- business-concept: <business name>
  candidates-considered: <known platform candidates>
  chosen-action: create
  chosen-schema: <UsrXxx>
  tradeoff-escalation: none
  rationale: <why create is appropriate given unavailable discovery>
  rejected-candidates: no suitable candidate found — dataforge-status returned unavailable; cannot verify candidate compatibility
  candidate-fit-summary: candidates not inspected — DataForge unavailable
  required-capabilities: <list from approved requirements>
  mismatch-evidence: no suitable candidate found — discovery skipped (dataforge-availability: unavailable)
  discovery-evidence: dataforge-status returned unavailable; active discovery branch bypassed for this session
```

**Template — `reuse` decision for a known platform entity when DataForge is unavailable:**

```
- business-concept: <business name>
  candidates-considered: <schema name>
  chosen-action: reuse
  chosen-schema: <ExistingSchema>
  tradeoff-escalation: none
  rationale: <why reuse — e.g., standard platform entity with known semantics>
  rejected-candidates: none
  candidate-fit-summary: <known capabilities of the platform entity>
  required-capabilities: <from approved requirements>
  mismatch-evidence: none — reuse accepted based on known platform semantics
  discovery-evidence: dataforge-status returned unavailable; reuse based on known platform schema
```

After recording `dataforge-availability: unavailable`, proceed immediately to writing the Model Decisions using these templates and then continue to Schema Sync Plan. Do not spend time analyzing what the validator checks.

#### Discovery Gate

The sections **Triggers**, **Canonical Discovery Sequence**, **Evidence Ladder**, **Deterministic Choice Rules**, and **Discovery Evidence Rule** below apply **only when DataForge is available**.

When `dataforge-availability: unavailable` is recorded, **skip all five sections** and proceed directly to **Schema Sync Plan**.

#### Triggers

Open the discovery branch for any business object, supporting object, lookup, or reference target that could plausibly map to an existing app or schema.
Treat this as mandatory planning work, not an optional optimization.
Any concept listed in `request-spec.json -> planningSignals.reuseCheckRequired` is an automatic trigger.

This includes, but is not limited to, cases where:

- a business object resembles a standard or already-existing platform concept.
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

1. **Default initial discovery is a single `dataforge-context` call** that aggregates candidate tables, lookups, and relations in one round-trip. This is not a "prefer" — it is the required first call:
   ```
   dataforge-context({
     "environment-name": "<env>",
     "candidate-terms": ["<main concept>", "<supporting concept>"],
     "lookup-hints": ["<status phrase>", "<priority phrase>", "<category phrase>"],
     "requirement-summary": "<brief business description>"
   })
   ```
   Use `candidate-terms` for entity candidates, `lookup-hints` for lookup candidates.
   Do **not** pass `schema-name` — that parameter does not exist on this tool.
   Use `dataforge-find-tables` or `dataforge-find-lookups` individually **only as a widen-the-search fallback** after reviewing the batched result; never as the first call.

   **Anti-pattern observed in past runs:** 2× `dataforge-find-tables` + 3× `dataforge-find-lookups` + 2× `dataforge-get-table-columns` instead of one `dataforge-context`. This multiplies network round-trips, surfaces inconsistent evidence, and burns several minutes on parameter-name retries (`term` vs `query`, `lookup-name` vs `schema-name`, empty-`query` rejections). Do not repeat it.

   **DataForge call budget per business concept:** at most **3 active `dataforge-*` calls** during planning — one `dataforge-context`, one schema-level confirmation (`dataforge-get-table-columns` or `dataforge-get-relations`), and one optional `find-*` widen-the-search. Exceeding this budget is a signal to commit a `Model Decision` or escalate to the user, not to keep probing.

2. When a strong candidate is found:
   - `application-get-info` for app-level context when the candidate belongs to an existing app
   - Resolve `package-name` before calling `get-entity-schema-properties`:
     1. `find-entity-schema(schema-name)` → read `package-name` from the entry where `parent-schema-name` is `BaseEntity` or `BaseCase` (the root definition)
     2. `get-entity-schema-properties(schema-name, package-name)` using that resolved package
   - At least one additional schema-level confirmation call:
     - `dataforge-get-table-columns`
     - `dataforge-get-relations`
     - `get-entity-schema-column-properties` when a specific column remains ambiguous

**`dataforge-find-lookups` response field names** (use these when iterating results):
- `similar-lookups[].schema-name` — the lookup entity name (not `"name"`)
- `similar-lookups[].value` — the row display value (not `"caption"`)
- `similar-lookups[].score` — relevance score

**Large response handling:** `dataforge-context` may return 50–80 KB saved to a temp file. Always parse it with Python via `call_mcp_tool` from `scripts/mcp_client.py` rather than PowerShell `ConvertFrom-Json`, which fails on multi-root or header-prefixed output.

Do not use `dataforge-initialize` or `dataforge-update` during planning.
If `dataforge-availability: unavailable` is already recorded for the session, skip this sequence entirely.

#### Evidence Ladder

Candidate discovery signals (`dataforge-context` similar-tables/lookups, `dataforge-find-tables`, `dataforge-find-lookups`) are not sufficient evidence for `create`, and they do not by themselves prove the final `reuse` decision.

For every strong candidate, complete the full ladder before locking the final `Model Decisions` record:

1. Initial candidate discovery (satisfied by the batched `dataforge-context` call above, or by `dataforge-find-tables` + `dataforge-find-lookups` individually)
2. Follow-up confirmation:
   - `dataforge-context` is mandatory (already satisfied when the batched call is used in step 1)
3. Schema-level confirmation:
   - at least one of `dataforge-get-table-columns`, `dataforge-get-relations`, `get-entity-schema-properties`, or `get-entity-schema-column-properties`
   - when using `get-entity-schema-properties`, resolve `package-name` first via `find-entity-schema`
4. Final choice:
   - only after the first three steps may the plan lock the final `reuse`, `extend`, or `create` outcome
   - **begin writing `plan.md` immediately after Evidence Ladder is complete** — do not defer to re-read validator source or workflow scripts before committing to disk

If the candidate remains plausible after step 1, do not stop at arguments such as "broader platform object", "ownership boundary", "unwanted coupling", or "lifecycle mismatch".
Those arguments are valid only when follow-up confirmation and schema-level confirmation show the exact technical mismatch against the approved business model.

#### Reuse-First Choice Rule

Use a reuse-first default after live discovery:

- prefer `reuse` when the candidate already satisfies the approved business role, even if it belongs to a broader platform module or contains extra optional fields
- if discovery surfaces one or more strong candidates, strong candidates resolve to `reuse`
- when several strong candidates exist, choose the most similar candidate from the discovery results and record that schema as `chosen-schema`
- if the most similar strong candidate still needs additive fields, minor localized behavior, or narrow adaptation, keep `chosen-action: reuse` and plan the additive work against that reused schema instead of switching the decision to `extend`
- use `extend` only outside the strong-candidate override path, such as extending the current app-owned custom or main entity after discovery did not surface a stronger reusable schema
- do not choose `create` only because the candidate is broader than needed, belongs to a shared platform module, or was not the placeholder schema named in the BA draft
- do not choose `create` when the only proven gaps are additive or safely extendable, even if the candidate is not a 100% match
- do not choose `create` just because live discovery arrived after an earlier placeholder choice; this applies even if Agent 2, the BA draft, or an earlier plan preferred create
- do not choose `create` because the candidate has extra required fields with existing lookup references or default values; those fields are handleable at page/UI level and are not schema-level capability failures
- do not choose `create` because the candidate has more functionality than the user explicitly requested; user requirements may describe only a subset of the candidate's capabilities, and this is normal
- do not choose `create` because the candidate belongs to a platform module with additional related entities the user did not mention; module dependencies are informational context, not functional blockers unless they prevent the approved business flow
- do not relabel an extra required field with existing lookup values as "forbidden extra semantics" to justify `create`; a required field that references a domain-specific lookup (e.g., EventType with marketing values) is an extra required field with existing lookup references — it can be defaulted at page/UI level and is not a schema-level capability failure; "forbidden extra semantics" applies only when the entity's core domain purpose or lifecycle makes the approved business flow impossible, not when a single required field has domain-flavored lookup values that can be set to a default
- for lookups, exact or near-exact match should default to `reuse`
- create a new lookup only when a required value is missing, forbidden extra semantics cannot be tolerated, unavoidable inherited behavior directly contradicts approved requirements, or separate governance was explicitly confirmed with the user

`reuse-first` means the plan should move toward the existing candidate whenever the majority of approved business requirements match the candidate's capabilities, even if the candidate covers more than what was explicitly requested.

#### Model Decision Finality

DataForge discovery evidence confirmed through the Evidence Ladder is the binding source of truth for model decisions (see AGENTS.md – Discovery Authority Hierarchy). No other reasoning input — user prompt phrasing, BA draft naming, execution-path constraints, tool mechanics, simplicity preferences, or deployment concerns — may override a discovery-confirmed model decision.

Once the Evidence Ladder completes and locks a `chosen-action`, no subsequent reasoning phase may reopen the choice. If the locked choice becomes impossible to implement, that is a blocker to report — not a license to silently switch to `create`.

#### Execution Feasibility Check

After the Evidence Ladder locks a `chosen-action`, verify tool-path feasibility — sequentially, not interleaved with the model decision.

1. Call `get-tool-contract` for the relevant tools. If the contract confirms a viable path, proceed to Schema Sync Plan.
2. If not, make one probe call. If the probe succeeds, proceed.
3. If both fail, escalate to the user: state the Evidence Ladder result, the tool-path constraint, and two concrete options.

Cap: two tool calls total (contract + probe). Do not speculate about alternative sequences — check the contract first. Do not reopen the model decision; if `reuse` is locked but infeasible, the user decides the fallback. Apply AGENTS.md – Decision Convergence throughout.

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
- `tradeoff-escalation`: `none` | `user-confirmation-required`
- `rationale`
- `rejected-candidates`
- `candidate-fit-summary`
- `required-capabilities`
- `mismatch-evidence`
- `discovery-evidence`

Use these carriers explicitly:

- `candidate-fit-summary`: what the strongest candidate already covers
- `required-capabilities`: the approved business capabilities the target model must satisfy
- `mismatch-evidence`: the concrete technical gaps proven by follow-up confirmation or schema-level confirmation
- `discovery-evidence`: the exact tool path used to discover and confirm or reject the candidate
- `tradeoff-escalation`: whether the technical choice is already resolved or still needs a short user decision
- when several strong candidates exist, the rationale or mismatch evidence must show why the chosen schema is the most similar candidate

The plan is incomplete if discovery surfaced a strong candidate and the resulting `reuse` / `extend` / `create` choice is not recorded explicitly.
The plan is also incomplete when a plausible candidate existed from the business wording but the record does not say `no suitable candidate found` or otherwise explain why `create` was selected.
The plan is invalid if Ordered Schema Sync references a created or extended schema that does not have a corresponding `Model Decisions` record.

#### Deterministic Choice Rules

- Choose `reuse` when an existing schema already satisfies the required business role without unacceptable coupling cost.
- If DataForge discovery produced strong candidate(s), choose `reuse` for the most similar candidate and treat that candidate as authoritative for `chosen-schema`.
- Choose `extend` only outside the strong-candidate override path, when the business role matches an existing custom or main entity and only additional fields or localized behavior are missing.
- Choose `create` only when no suitable candidate exists, or when an explicit architectural reason rules out reuse.
- When `create` is considered against a discovered strong candidate, the agent must escalate to the user before locking the decision (see Mandatory User Escalation below).
- Record `no suitable candidate found` explicitly when discovery ran and the result still leads to `create`.
- `create` is never allowed as a placeholder choice for "decide later during implementation".
- If `reuse` or `extend` is technically viable and covers the required capabilities, amend the plan accordingly even when the BA draft named a custom `Usr*` schema or custom lookup.
- If a strong candidate needs only additive extension, the plan must still resolve to `reuse` for the most similar candidate even if the candidate is not a 100% match.
- If live discovery shows a strong reusable candidate, do not preserve a stale create decision from Agent 2 or an earlier plan.
- If multiple strong candidates remain after the Evidence Ladder, the plan must select the single most similar candidate instead of leaving several reusable options open.

For `create` after a strong candidate was found, include an explicit comparison between:

- the approved `required-capabilities`
- the candidate schema shape and behavior documented in `candidate-fit-summary`
- the proven mismatch captured in `mismatch-evidence`

For `reuse` or `extend`, document why the candidate is sufficient rather than re-arguing for a new custom schema.
For strong-candidate reuse, document why the chosen schema is the most similar candidate rather than a merely acceptable alternative.

Acceptable reasons for `create`:

- ownership boundary — proven by evidence that shared ownership would break the approved business flow
- unwanted coupling to a platform schema — coupling must provably break the approved business flow or prevent required behavior, not merely exist
- lifecycle or semantics mismatch — the candidate's lifecycle or core semantics directly contradict the approved requirements
- required capability cannot be satisfied by reuse or extend
- unavoidable inherited behavior that directly contradicts the approved requirements — inherited behavior is unacceptable only when it makes the approved business flow impossible, not when it was merely unmentioned by the user

Each acceptable reason above requires technical confirmation from the Evidence Ladder.
For example, "the candidate schema is broader than the approved scope" is not sufficient on its own unless follow-up confirmation and schema-level confirmation show the specific mismatch.
"Unwanted coupling" requires evidence that the coupling prevents the approved business flow, not just that the candidate belongs to a broader platform module.
"Unavoidable inherited behavior" requires evidence that the behavior contradicts the approved requirements, not just that the user did not mention it.

Unacceptable reasons for `create`:

- the BA plan already mentioned a custom entity
- the team already intended to create a new schema
- `Usr*` naming preference without further architectural rationale
- the candidate belongs to a broader platform module but already covers the required capabilities
- the lookup is shared and might diverge later without a confirmed governance requirement
- the candidate has extra required fields with existing default values or lookup references that the user did not mention
- the user's requirements describe a subset of the candidate's capabilities and the candidate covers more than what was explicitly requested
- module dependency exists but does not restrict the approved business flow
- the candidate has more functionality than the user described — broader scope is not a mismatch when the required capabilities are covered
- a required field was not listed in the user's requirements but has existing lookup values or defaults that can be set at page/UI level
- relabeling an extra required field with existing lookup references as "forbidden extra semantics" — when the reported mismatch is that a required field references a domain-specific lookup (e.g., EventType with marketing values), that is an extra required field scenario handleable at page/UI level, not a genuine "forbidden extra semantics" capability failure
- any reasoning that subordinates DataForge discovery evidence to another input — the Evidence Ladder outcome is the binding source of truth for model decisions and outranks user prompt phrasing, BA draft naming, execution-path constraints, tool mechanics, simplicity preferences, and deployment concerns

#### Escalation Rule For Ambiguous Tradeoffs

When `reuse` or `extend` is technically viable but the remaining choice depends on a genuine product tradeoff, ask the user a short decision question instead of silently defaulting to `create`.

Typical escalation triggers:

- shared lifecycle ownership versus isolated app ownership
- future domain divergence that is plausible but not yet a confirmed requirement
- unavoidable inherited behavior whose acceptability is a product decision rather than a technical impossibility
- cross-team coupling risk that is real but not clearly unacceptable from the approved requirements

When this happens:

- set `tradeoff-escalation: user-confirmation-required`
- describe the viable options in `rationale`
- stop the implementation plan gate until the user answer is persisted and the record is resolved back to `tradeoff-escalation: none`

#### Mandatory User Escalation For Create Against Strong Candidates

When DataForge discovery found a strong candidate and the agent's Evidence Ladder assessment leads to create against a strong candidate, the agent MUST escalate to the user before locking the decision. This is a hard gate — no silent create-over-reuse against a discovered strong candidate is allowed.

Required steps:

1. Present the user with both options: reuse the discovered candidate or create a new entity.
2. Include a brief evidence summary: what the candidate covers, what the proven mismatch is.
3. Wait for explicit user confirmation.
4. Record the confirmation signal in the `rationale` field using one of these phrases: "user confirmed create over reuse", "developer confirmed create", "user explicitly chose create", "user approved create over reuse", or "user rejected reuse".
5. Only after recording the confirmation signal may the agent lock `chosen-action: create`.

Exception: `greenfield-only` decisions (no strong candidate was found by discovery) proceed to `create` without user confirmation.

This rule applies to entities and lookups alike. If discovery found a strong reusable lookup but the agent believes a new lookup is needed, the same escalation applies.

#### Discovery Evidence Rule

- missing discovery evidence is a blocker whenever a reuse candidate was plausible from the business wording, approved model, or app/update context.
- weak discovery evidence is also a blocker. Generic statements such as "new schema needed", "custom app requested", or "follow implementation defaults" do not satisfy this requirement.
- outcome-only evidence is a blocker. Writing `greenfield-only` or `no suitable candidate found` without citing at least one attempted read-only tool call does not pass the implementation plan gate. The discovery-evidence field must contain at least one tool name (`dataforge-find-tables`, `dataforge-find-lookups`, `dataforge-context`, `application-get-info`, `application-get-list`, or `get-entity-schema-properties`).
- when a strong candidate exists, `discovery-evidence` must show at least one initial discovery tool and `dataforge-context`.
- when a strong candidate exists, either `discovery-evidence` or `mismatch-evidence` must cite at least one schema-level confirmation tool (`dataforge-get-table-columns`, `dataforge-get-relations`, `get-entity-schema-properties`, or `get-entity-schema-column-properties`).
- outcome phrases such as `ownership boundary`, `unwanted coupling`, `semantic mismatch`, `lifecycle mismatch`, or `broader than the approved scope` are blockers unless they are backed by follow-up confirmation and schema-level confirmation.
- if the evidence shows the candidate already covers the required capabilities, the plan must resolve to `reuse` unless `tradeoff-escalation: user-confirmation-required` is explicitly recorded.
- if the evidence shows several strong candidates, the plan must identify the most similar candidate and reuse it.
- when DataForge tools fail (e.g. HTTP 401, timeout), cite the attempted call and the fallback tool used. For example: `dataforge-find-tables attempted (401 Unauthorized), application-get-info returned no matching app` is valid evidence for a greenfield-only conclusion.
- exception: when `dataforge-availability: unavailable` is recorded because `dataforge-status` was not Ready or the call threw, treat the active discovery branch as intentionally bypassed for the session instead of failing for missing DataForge evidence.

### Schema Sync Plan

- Resolve whether `create-app` is sufficient for the app shell and which fields still require follow-up DB-first sync.
- Do not add a separate mandatory `dataforge-*` preflight to the standard new-app branch; standalone Data Forge tools are for explicit inspection or remediation only.
- For existing-app work, include the current `clio`-owned discovery and inspection flow instead of hard-coding request semantics here.
- Create lookup entities before entities that reference them.
- Prefer batched lookup seeding inside the current `clio`-owned schema mutation flow; use `create-data-binding-db` only when the workflow explicitly needs a separate binding artifact.
- Extend the template-created main entity via `update-entity-schema`.
- Use `create-entity-schema` only for genuinely additional business objects.
- Do not emit a schema-creation step unless the matching `Model Decisions` record already resolved that exact business concept to `chosen-action: create`.
- When a `Model Decisions` record resolves to `reuse`, the Schema Sync Plan must select the execution path that implements reuse (e.g. `create-app-section` with the existing entity, or existing-app flow). The choice of MCP tools adapts to the model decision — the model decision is not negotiable at execution-planning time.
- When `chosen-action: reuse`, do not plan `create-entity`, `create-lookup`, or `update-entity` steps that duplicate the reused schema's fields into a new entity. The reused schema already exists and is ready — plan only wiring (section registration, page configuration). If the wiring tool fails (e.g., `InsertQuery failed` for a platform entity), do not fall back to creating a new entity with the same fields. Report the existing entity and its capabilities to the user and let them decide the next step.
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
- when the entity uses a custom `UsrName` column as its primary display field (not the
  inherited platform `Name`), edit the FormPage `body.js` directly so the inserted field
  uses the `PDS_UsrName` attribute key with consistent `control` and `label` bindings
- include the title field in the form-page `resources` dict alongside all other
  custom fields: `"PDS_UsrName": "<human-readable caption>"`; omitting it causes the
  field to render without a label in the designer even when the page saves successfully

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
