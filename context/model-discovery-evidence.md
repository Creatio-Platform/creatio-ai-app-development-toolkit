# Model Discovery Evidence

Use this guide when Agent 3 must decide whether to `reuse`, `extend`, or `create`.
It is a policy reference for evidence quality, not an executable tool contract.

## DataForge Tool Parameter Contract

Use this table when invoking `dataforge-*` tools through `scripts/mcp_client.py`.
Parameter names are exact — past sessions burned several minutes on `term` vs `query` and `lookup-name` vs `schema-name` retries.

| Tool | Required params | Optional params | Notes |
|------|-----------------|-----------------|-------|
| `dataforge-status` | `environment-name` | — | Empty body `{}` returns `invalid-request`. Returns `status.status == "Ready"` when usable. |
| `dataforge-context` | `environment-name`, `candidate-terms` (array) | `lookup-hints` (array), `requirement-summary` (string) | **Default first discovery call.** Do **not** pass `schema-name`. Response top-level keys: `similar-tables`, `similar-lookups`. May return 50–80 KB; parse with Python via `call_mcp_tool`, never PowerShell `ConvertFrom-Json`. |
| `dataforge-find-tables` | `environment-name`, `query` (non-empty string) | — | `query` (not `term`, not `name`). Empty string is rejected. Response: `similar-tables[]`. Fallback only — use `dataforge-context` first. |
| `dataforge-find-lookups` | `environment-name`, `query` (non-empty string) | `schema-name` (filter by lookup) | `schema-name` (not `lookup-name`). `query` is required and must be non-empty (use a single letter such as `"a"` if you only want to scope by `schema-name`). Response: `similar-lookups[]`. |
| `dataforge-get-table-columns` | `environment-name`, `table-name` | — | Schema-level confirmation. Response: `columns[]` with `name`, `caption`. |
| `dataforge-get-relations` | `environment-name`, `table-name` | — | Schema-level confirmation. Response: relation list. |

### Anti-pattern: `find-lookups` is not a "list rows of a known lookup" tool

`dataforge-find-lookups` searches **lookup display values across the catalog** for a query string.
It is **not** the right tool to enumerate the rows of a single lookup whose schema name you already know:
passing `{schema-name: "<UsrSomeLookup>", query: "a"}` returns matches against lookup *values* containing "a", not the full row set.

To verify or list the rows of a known lookup, do one of:
- include the lookup name in `lookup-hints` of the next `dataforge-context` call;
- call `dataforge-get-table-columns` on the lookup table to confirm structure, then trust seeded values;
- query the lookup rows directly via the schema-level tools after locking the Model Decision.

## DataForge Response Field Reference

When iterating `dataforge-find-lookups` results, use the correct field names:

| Field in response | Meaning |
|-------------------|---------|
| `similar-lookups[].schema-name` | Lookup entity name (not `"name"`) |
| `similar-lookups[].value` | Row display value (not `"caption"`) |
| `similar-lookups[].score` | Relevance score (lower = more relevant in some versions) |

When iterating `dataforge-find-tables` / `dataforge-context` similar-tables:

| Field | Meaning |
|-------|---------|
| `similar-tables[].name` | Entity schema name |
| `similar-tables[].caption` | Human-readable table caption |
| `similar-tables[].description` | AI-generated semantic description |



## Strong Candidate Signals

Treat a candidate as strong when any of the following is true:

- `dataforge-find-tables` returns a platform or existing custom schema with the same or adjacent business noun
- `dataforge-find-lookups` returns a lookup whose values or title align with the approved lifecycle or taxonomy
- the approved business wording maps naturally to a known platform concept.
- an existing `Usr*` schema or app already appears relevant
- the current run is an existing-app update and a nearby entity already exists in the app

Strong candidate means "finish the Evidence Ladder, then lock the strongest reusable choice".
Strong candidates resolve to `reuse` unless the Evidence Ladder proves a real capability failure.
When several strong candidates exist, choose the most similar candidate from live discovery and reuse that schema.
Do not treat "not a 100% match" as a reason to create something new when the remaining gap is additive or safely extendable.
Do not let Agent 2, the BA draft, or an earlier plan lock in `create` once live DataForge discovery has surfaced a strong reusable candidate.

## Plan amendment after discovery

Agent 2 and the BA draft keep business intent stable, but they do not freeze the final technical schema or lookup choice.
Live discovery may amend the technical plan.

If the BA draft named `Usr*` placeholder schemas or custom lookups, and discovery shows a viable existing candidate, Agent 3 should rewrite the technical plan toward `reuse`.
`Model Decisions` become the source of truth for execution.
This rewrite is mandatory even if the earlier plan already leaned toward `create`.

## Evidence Ladder

Use the full ladder for every strong candidate:

1. Initial discovery
   - `dataforge-find-tables`
   - `dataforge-find-lookups`
2. Follow-up confirmation
   - `dataforge-context`
3. Schema-level confirmation
   - `dataforge-get-table-columns`
   - `dataforge-get-relations`
   - `get-entity-schema-properties`
   - `get-entity-schema-column-properties`
4. Final decision
   - only after the previous steps may the plan lock `reuse`, `extend`, or `create`
   - if one or more strong candidates remain, pick the most similar candidate and lock `chosen-action: reuse`

## What To Compare

When rejecting a strong candidate, compare the candidate against the approved model explicitly:

- semantic similarity: does the candidate represent the same business thing or only a nearby platform concept
- field or column shape: are the required fields already present or safely extendable
- lifecycle or status model: do the candidate states and transitions fit the approved workflow
- relation shape: do the candidate links, ownership model, and parent-child semantics fit the approved business object

## When broader is still reusable

A broader platform entity or shared lookup can still be reusable.
The following do not block reuse on their own:

- extra optional columns
- extra required fields that already have default values or existing lookup references
- broader module membership or platform module dependencies
- existing unrelated optional fields
- a platform-owned lookup with the exact lifecycle values already present
- the candidate covering more capabilities than the user explicitly requested
- the candidate belonging to a module with additional related entities the user did not mention

Default to `reuse` when the required capabilities are already covered.
If a strong candidate is the most similar match and only additive fields or narrow adaptation are needed, still keep the final decision at `reuse`.
Use `extend` only outside the strong-candidate override path, such as expanding the current app-owned custom baseline after stronger reusable candidates were ruled out.
Choose `create` only when the required capabilities cannot fit or unavoidable inherited behavior directly contradicts the approved requirements.
Apply this rule even if the candidate is not a 100% match. A strong candidate with only additive gaps still belongs in `reuse`, not `create`.

### User requirements as a subset

User requirements often describe only a subset of a candidate's capabilities.
When the majority of approved business requirements match what DataForge discovered, that is sufficient for `reuse` — even if the candidate has additional required fields, broader module scope, or more features than the user explicitly requested.

The candidate having more than what was asked for is a strength, not a mismatch.
Extra required fields with existing lookup values or defaults are a page-level concern (set a default on the form), not a schema-level capability failure.
Module dependencies are informational context about the candidate's origin, not functional blockers unless they prevent the approved business flow from working correctly.

Do not treat "the user didn't mention this field" or "the user didn't ask for this functionality" as evidence against reuse.
Do not treat a required field with existing lookup values as "unavoidable inherited behavior" that blocks reuse.
Do not treat module membership as "unwanted coupling" when the candidate's core business semantics match the approved requirements.

## Required Model Decision Carriers

Every ambiguous `Model Decisions` record should tell the full story:

- `candidates-considered`
- `candidate-fit-summary`
- `required-capabilities`
- `mismatch-evidence`
- `discovery-evidence`

`candidate-fit-summary` should say what the best candidate already provides.
`required-capabilities` should restate the approved business needs in technical comparison form.
`mismatch-evidence` should name the proven gaps, not just the conclusion.
When several strong candidates exist, the decision record should say why the chosen schema is the most similar candidate.

## Good decision evidence

Good `create` evidence:

- `candidate-fit-summary: Contact provides person identity and communication fields but lacks the required workflow and ownership semantics`
- `required-capabilities: app-owned workflow lifecycle, custom status tracking, assignment and resolution trail`
- `mismatch-evidence: dataforge-context showed the candidate belongs to a broader CRM entity; get-entity-schema-properties confirmed the lifecycle and ownership model do not match the approved object`
- `discovery-evidence: dataforge-find-tables, dataforge-context, get-entity-schema-properties`

Good `reuse` evidence:

- `candidate-fit-summary: Contact already provides the required person identity and communication fields`
- `required-capabilities: reusable person record with standard communication semantics`
- `mismatch-evidence: Account was rejected because it models organizations rather than individual people`
- `discovery-evidence: dataforge-find-tables, dataforge-context, get-entity-schema-properties`

Additional good `reuse` examples:

- exact lookup match -> `reuse`
- broader entity with all required capabilities covered -> `reuse`

Good `extend` evidence:

- `candidate-fit-summary: current app-owned custom schema already carries the approved support workflow baseline after stronger reusable candidates were ruled out`
- `required-capabilities: approved extra diagnostics and escalation fields`
- `mismatch-evidence: dataforge-context and get-entity-schema-properties showed no stronger reusable schema; only the current app-owned baseline needs approved supplemental fields`
- `discovery-evidence: dataforge-find-tables, dataforge-context, get-entity-schema-properties`

Additional good `extend` example:

- extend the current app-owned baseline outside the strong-candidate override path

Good `create` evidence:

- only when required capabilities cannot fit or unavoidable inherited behavior is unacceptable

## Discovery Primacy

DataForge discovery evidence confirmed through the Evidence Ladder is the highest-authority input for model decisions. Reasoning from any other source — user prompt phrasing, BA draft naming, execution-path constraints, tool mechanics, simplicity preferences, deployment concerns — is subordinate and cannot override confirmed discovery. If the Evidence Ladder confirms a strong candidate, the model decision is `reuse` regardless of what other reasoning inputs suggest.

## Bad decision evidence

Bad reasoning patterns:

- `broader platform object`
- `ownership boundary`
- `semantic mismatch`
- `custom app requested`
- `we will create our own`
- `the business plan already named Usr...`
- `shared platform lookup may diverge later`
- `candidate is broader than needed`
- `candidate has extra required fields the user didn't mention`
- `candidate belongs to a module with dependencies`
- `candidate has more functionality than requested`
- `user didn't specify all candidate fields`
- `required field not in user requirements`
- `module coupling to a broader platform area`
- any reasoning that overrides confirmed DataForge discovery with a subordinate input such as user prompt phrasing, BA draft naming, execution-path constraints, tool mechanics, or simplicity preferences

These are conclusions, not evidence.
They fail when they are not tied to `dataforge-context` plus at least one schema-level confirmation call.

## When to ask instead of deciding

Ask the user instead of silently picking `create` when both technical paths are viable and the remaining difference is a product tradeoff.

Typical triggers:

- shared lifecycle ownership versus isolated app ownership
- future domain divergence that is plausible but not yet confirmed
- unavoidable inherited behavior whose acceptability is a product decision
- cross-team coupling risk that is real but not clearly unacceptable

## Tool Feasibility vs Policy Deliberation

- Tool feasibility does not change the Evidence Ladder's model decision. If the ladder confirmed `reuse`, the decision stays `reuse` regardless of tool limitations.
- Do not speculate about tool behavior — call `get-tool-contract` or make a probe call. Max one reasoning block of uncertainty, then act.
- Sequence: lock model decision → `get-tool-contract` → one probe if needed → escalate to user if infeasible. Total reasoning budget: one block.
- Platform limitations (e.g., `InsertQuery failed`) are tool-path constraints, not evidence against the model decision. Report as execution blockers; let the user decide the fallback.

## DataForge Unavailable

When `dataforge-availability: unavailable` is recorded (because `dataforge-status` was not Ready or threw), the active discovery branch is bypassed for the session. Use these templates directly instead of analyzing the validator.

Good `create` evidence when DataForge is unavailable:

- `candidates-considered: <none confirmed — DataForge unavailable>`
- `candidate-fit-summary: candidates not inspected — DataForge unavailable`
- `required-capabilities: app-owned custom workflow lifecycle, custom status tracking, priority assignment, owner assignment`
- `mismatch-evidence: no suitable candidate found — discovery skipped (dataforge-availability: unavailable)`
- `discovery-evidence: dataforge-status returned unavailable; active discovery branch bypassed for this session`
- `rejected-candidates: no suitable candidate found — dataforge-status returned unavailable; cannot verify candidate compatibility`

Good `reuse` evidence when DataForge is unavailable (for a known platform entity that the approved business model maps to):

- `candidates-considered: <PlatformEntity>`
- `candidate-fit-summary: standard platform entity with known semantics matching the approved business concept`
- `required-capabilities: <from approved requirements>`
- `mismatch-evidence: none — reuse accepted based on known platform semantics`
- `discovery-evidence: dataforge-status returned unavailable; reuse based on known platform schema`
- `rejected-candidates: none`

Key rule: for `create` actions, `rejected-candidates` or `mismatch-evidence` must still contain a rejection phrase such as `no suitable candidate found`, `lifecycle mismatch`, `semantic mismatch`, `does not match`, etc. This check applies regardless of DataForge availability.

## Greenfield Exception

If the business object is truly greenfield-only:

- still run initial discovery
- record the attempted tools
- say `no suitable candidate found` only after the attempted calls are captured

Greenfield is the exception path.
It must not be used to skip discovery for objects that merely sound custom or already have a planned `Usr*` name.
