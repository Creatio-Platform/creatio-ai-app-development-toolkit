# Product Telemetry Contract

This file owns ONE thing: **where each CAADT flow's telemetry stages land** — which gate of which
workflow emits which stage.

Everything else about telemetry is owned by clio and MUST be read from there, not restated here:

- **`get-guidance name=product-telemetry`** — the stage vocabulary, the `workflow` and `variant`
  fields, the consent flow and withdrawal, the payload rules, and the non-blocking rule.
- **`get-tool-contract`** for `send-telemetry` — the authoritative executable schema.

Read the guidance article before your first emission of a run. Do not infer the vocabulary from this
file; a stage name spelled from memory is rejected by clio's allow-list.

The one field this repository supplies: use the static Analytics Context from the installed skill or
rule for `coding_agent` and `plugin_version`.

## Which `workflow` value a CAADT flow reports

`workflow` identifies the flow; the stage names are shared. Pick the value for the flow you are
actually running.

| You are running | `workflow` | Gate P / Gate R applies |
| --- | --- | --- |
| App creation or business-shaped feature work | `app-creation` | Yes |
| Classic→Freedom UI migration | `classic-to-freedom-migration` | No — that skill has its own plan and approval |
| Freedom UI web→mobile page conversion | `mobile-page-conversion` | No — Gate M / Gate S instead |
| Branding / theming | `branding` | No — single final confirmation instead |
| A targeted, implementation-ready edit to an existing app | `app-maintenance` | No |

**Being exempt from Gate P/R is not being exempt from telemetry.** That exemption is exactly why those
flows used to report nothing: the old event names hung off the app-creation gates, so a flow that
skipped those gates emitted nothing at all, no matter how the instructions were worded. Their
emission points are their own gates instead, listed below.

## Where each flow's stages land

The stages are generic; the *points* are each flow's own gates.

| Flow | `plan_presented` | `plan_approved` | `work_item_completed` | Notes |
| --- | --- | --- | --- | --- |
| `app-creation` | the BA-style Business Plan is shown in full | Gate R confirmation | per created section/page | `build_started` after Gate R, once runtime context is available |
| `classic-to-freedom-migration` | the engine-written `plan.md`, presented verbatim | explicit approval, before the first Freedom artifact | per migrated page (`variant=page`) | `plan_blocked` with `variant=engine-gate` on each `⛔` run |
| `mobile-page-conversion` | the plain-language conversion plan | **Gate M** | per built mobile page; also on **Gate S** registration (`variant=section`) | `plan_blocked` with `variant=feature-disabled` when the `mobile-page-converter` flag is off |
| `branding` | the single final summary | confirmation of that summary | per applied asset (`variant=theme` / `logo`) | palette confirmation is a `user_input_received` |
| `app-maintenance` | — (skips planning) | — | per applied change | `plan_skipped` at the start makes the skip explicit |

Two rules that decide *when*, and that this table depends on:

- **Emit at the point named, not batched at the end.** A stage recorded after the fact cannot show
  where a run stopped, which is the whole point of a funnel.
- **`work_item_completed` is per unit, and a run that changed anything sends at least one.** One event
  per created or applied unit — a schema, a column, a page, a section, a mobile page, a registration —
  each with its own `variant`, at the moment that unit is verified. Not one summary event, and never
  zero. Measured runs skipped it exactly when there was most to report: runs that applied two, three
  and seven units sent none, so their terminal stage claims a finished workflow with no evidence of
  what it produced. `workflow_completed` says a run ended; only `work_item_completed` says how much
  it delivered, and per-unit counts are what separate a real build from a one-line edit.
- **`workflow_started` goes at the first user input of the flow**, and it is also the call that
  persists a first-run consent decision — see the guidance article for that interaction.

## Overlay skills have no workflow of their own

`creatio-schema-naming` and `creatio-ui-guidelines` supply rules to whichever flow is running. They
MUST NOT open a telemetry session of their own — the enclosing flow already reports its stages, and a
second session double-counts the same run.

The single exception is a standalone invocation: the developer called the overlay directly, no other
CAADT flow is active, and the run still changes the environment. That is a targeted edit — report it
as `app-maintenance` so the change is not invisible.
