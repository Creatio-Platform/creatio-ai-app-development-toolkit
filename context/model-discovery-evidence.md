# Model Discovery Evidence

Use this guide when Agent 3 must decide whether to `reuse`, `extend`, or `create`.
It is a policy reference for evidence quality, not an executable tool contract.

## Strong Candidate Signals

Treat a candidate as strong when any of the following is true:

- `dataforge-find-tables` returns a platform or existing custom schema with the same or adjacent business noun
- `dataforge-find-lookups` returns a lookup whose values or title align with the approved lifecycle or taxonomy
- the approved business wording maps naturally to a known platform concept such as activity, case, article, contact, account, request, knowledge, or comment
- an existing `Usr*` schema or app already appears relevant
- the current run is an existing-app update and a nearby entity already exists in the app

Strong candidate means "keep inspecting", not "reuse automatically".
Strong candidate also means the default end-state is `reuse` or `extend` unless the Evidence Ladder proves a real capability failure.
Do not treat "not a 100% match" as a reason to create something new when the remaining gap is additive or safely extendable.
Do not let Agent 2, the BA draft, or an earlier plan lock in `create` once live DataForge discovery has surfaced a strong reusable candidate.

## Plan amendment after discovery

Agent 2 and the BA draft keep business intent stable, but they do not freeze the final technical schema or lookup choice.
Live discovery may amend the technical plan.

If the BA draft named `Usr*` placeholder schemas or custom lookups, and discovery shows a viable existing candidate, Agent 3 should rewrite the technical plan toward `reuse` or `extend`.
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
- broader module membership
- existing unrelated optional fields
- a platform-owned lookup with the exact lifecycle values already present

Default to `reuse` when the required capabilities are already covered.
Default to `extend` when only additive fields or narrow adaptation are needed.
Choose `create` only when the required capabilities cannot fit or unavoidable inherited behavior is unacceptable.
Apply this rule even if the candidate is not a 100% match. A strong candidate with only additive gaps still belongs in `reuse` or `extend`, not `create`.

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

## Good decision evidence

Good `create` evidence:

- `candidate-fit-summary: Activity covers owner, due date, and completion semantics`
- `required-capabilities: app-owned event task lifecycle, event linkage, lightweight task completion flow`
- `mismatch-evidence: dataforge-context showed the candidate belongs to a broader interaction flow; get-entity-schema-properties confirmed the lifecycle and ownership model do not match the approved object`
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

- `candidate-fit-summary: existing custom case schema already carries the core support workflow`
- `required-capabilities: approved extra diagnostics and escalation fields`
- `mismatch-evidence: get-entity-schema-properties showed only approved supplemental fields are missing`
- `discovery-evidence: dataforge-find-tables, dataforge-context, get-entity-schema-properties`

Additional good `extend` example:

- candidate needs a few additive fields -> `extend`

Good `create` evidence:

- only when required capabilities cannot fit or unavoidable inherited behavior is unacceptable

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

These are conclusions, not evidence.
They fail when they are not tied to `dataforge-context` plus at least one schema-level confirmation call.

## When to ask instead of deciding

Ask the user instead of silently picking `create` when both technical paths are viable and the remaining difference is a product tradeoff.

Typical triggers:

- shared lifecycle ownership versus isolated app ownership
- future domain divergence that is plausible but not yet confirmed
- unavoidable inherited behavior whose acceptability is a product decision
- cross-team coupling risk that is real but not clearly unacceptable

## Greenfield Exception

If the business object is truly greenfield-only:

- still run initial discovery
- record the attempted tools
- say `no suitable candidate found` only after the attempted calls are captured

Greenfield is the exception path.
It must not be used to skip discovery for objects that merely sound custom or already have a planned `Usr*` name.
