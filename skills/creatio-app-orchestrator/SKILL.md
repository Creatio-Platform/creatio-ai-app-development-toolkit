---
name: creatio-app-orchestrator
description: Use when the user asks to create, generate, scaffold, build, add, or plan a Creatio app or a new section — for example "create a Todo app" or "add an Orders section". Apply proactively for any new-app or new-section request, even when not explicitly selected: this skill is the entrypoint that produces the Creatio app Business Plan and technical implementation handoff and then applies the approved plan through clio MCP.
---

# Creatio App Orchestrator

Use this skill as the entrypoint for CAADT workflows.

## File resolution (read first)

All toolkit files referenced in this skill live under the **toolkit root** — the
directory that contains AGENTS.md, which is the parent of the `skills/` folder
this file lives in (`../../` from this file). Resolve every path below against that
toolkit root, not your current working directory.

If you cannot read `../../AGENTS.md`, STOP: tell the user the CAADT toolkit files
are not accessible from this session, and do not produce a plan from memory.

## Load Order

1. Read `../../AGENTS.md` for the active orchestration contract.
2. Read `../../context/product-telemetry.md` for telemetry consent, event checkpoints, and payload shape.
3. Read `../../context/INDEX.md` to choose the smallest relevant reference set.
4. For environment setup, read `../../runbooks/01-environment-setup.md`.
5. For requirements gathering, read `../../runbooks/02-requirements-gathering.md`.
6. For post-Gate-R implementation and scaffolding (including the transient section-creation failure playbook), read `../../runbooks/03-app-implementation.md`.
7. For executable helper behavior: resident tools (`get-tool-contract` index: `resident=true`) are called natively; every other tool is invoked via `clio-run <command>` regardless of transport. `../../runtime/scripts/mcp_client.py` is an **explicit opt-in escape hatch** for hosts with no native MCP transport — not the default fallback (see "Core Rules" below and `../../AGENTS.md`, "clio MCP availability preflight"). Also read `../../runtime/scripts/workflow_validators.py`.

## Analytics Context

Use these values for CAADT product telemetry when calling clio telemetry tools:

- `coding_agent`: your host coding agent (for example `Claude Code`, `Codex`, `GitHub Copilot CLI`, or `Cursor`).
- `plugin_version`: the installed plugin version from the plugin manifest (`plugin.json` `version`).

## Product telemetry — the stage vocabulary plus your `workflow` value

Read `../../context/product-telemetry.md` for which gate emits which stage. Event names are **flow-agnostic stages**; which flow it
was travels in the `workflow` field. Read `get-guidance name=product-telemetry` for the vocabulary and
the consent flow — clio owns both, along with the allow-list that validates them — and never spell a
stage from memory. Send the Analytics Context values above on every event.

- **Full app generation or business-shaped feature work** → `workflow: "app-creation"`. Map the stages onto
  this flow's gates: `plan_presented` when the BA-style Business Plan is shown in full, `plan_approved` at
  Gate R, `build_started` once runtime context is available, `work_item_completed` per created
  section/page. The legacy `session_started` / `business_plan_*` / `implementation_*` names still work but
  are deprecated — prefer the stages.
- **A targeted, implementation-ready change** to an existing app → `workflow: "app-maintenance"`, with
  `plan_skipped` at the start to make the skipped planning explicit. These runs skip Gate P/R, so they have
  no approval stage — but they are not exempt from telemetry, which is exactly the gap this closes.
- **A run you delegate to another skill** (Classic→Freedom migration, web→mobile conversion, branding) →
  that skill owns its own emission points and its own `workflow` value; do not emit on its behalf.

Both flows this skill owns emit the same stages; only the points differ:

| Send | `app-creation` — at the point where you | `app-maintenance` — at the point where you |
| --- | --- | --- |
| `workflow_started` | take the first request | take the first request |
| `clarification_requested` / `user_input_received` | ask a discovery question / receive the answer | ask anything the change waits on / receive the answer |
| `plan_presented` | show the full BA-style Business Plan | — |
| `plan_skipped` | — | start the run (makes the skipped planning explicit) |
| `plan_changes_requested` | receive a change request before Gate R | — |
| `plan_approved` | get Gate R confirmation | — |
| `build_started` | begin implementing, once runtime context is available | begin the first write |
| `work_item_completed` | finish each section/page (`variant` = `section` / `page`) | finish each applied change |
| `workflow_completed` / `workflow_failed` | reach the end of the run | reach the end of the run |
| `changes_requested` | the developer asks for more changes after completion | same |
| `changes_applied` | those follow-up changes are applied and verified | same |

`build_started` is emitted in **both** flows, even though a targeted edit has no approval boundary before
it — that keeps "how many runs actually reached the writing phase" a single query across every workflow
instead of a per-flow special case.

Telemetry is non-blocking: never let it gate or delay the user's task, and if clio rejects an event name
(older clio), stop emitting for the rest of the run and carry on.

## Core Rules

- Pages are separate for web and mobile: before any page edit, read `../../context/essentials.md` ("Freedom UI — Mobile Pages") and target web, mobile, or both as the requirement needs. Required even in autonomous/pre-approved runs.
- **Lookup/enum values are package data, never a runtime write.** Seed them inline via `sync-schemas`'s row-seeding parameter (name resolved via `get-tool-contract`) when the entity is created in that batch (preferred), or with `create-data-binding-db` when the entity already exists outside that batch — both are DB-first and install immediately, no compile step involved. Never seed lookup values through runtime OData/DataService calls or raw SQL: those bypass the platform, so the row lands in the table but the value doesn't surface as real package data. Details: `../../context/essentials.md`, "Data Binding And Schema Inspection".
- **UI/UX is mandatory, not optional.** Whenever the workflow creates or edits Freedom UI pages (`create-app`, `create-app-section`, `create-page`, `update-page`, `sync-pages`), you MUST invoke the **`creatio-ui-guidelines`** skill **before** authoring page bodies and apply its rules (layout/containers, component choice, lookups, fields, accessibility), then run its review checklist **before** treating page work as done. Do not design pages from memory — these rules are easy to miss and skipping them produces the recurring defects (selection-window lookups, layout gaps, single-field islands, Title-case captions, missing tooltips, non-accessible components).
- **Navigation placement and audience are mandatory, not optional.** A section that exists is not a section a user can reach: `create-app` places it in the `My applications` workplace, which is granted to `System administrators` only, and a home page is reachable only through a workplace whose `HomePageUId` points at it. So (a) in the FIRST discovery batch — not a later round, and never as a defaulted assumption — you MUST secure the developer's decision on WHERE the app belongs in the left navigation and WHO should see it — a new workplace named for the app (recommend this when scaffolding), `My applications`, or a named existing one — per `../../context/business-checklist.md`, "Users, access and ownership", and carry it in `## 2. Roles and Permissions`; and (b) before any navigation write you MUST call `get-guidance name=workplaces` (plus `name=home-page` when the plan has a home page) and follow it, then verify the placement by reading the rows back and confirm the change shipped as a package data binding — see `../../runbooks/03-app-implementation.md`, "Place the app in the navigation". Do not improvise these writes from tool contracts alone and do not silently choose the placement yourself: a workplace bound with the wrong column set installs on the next environment as an empty unreachable entry, one of the binding tools deletes live records, and navigation is cached so the developer must be told to log out and back in.
- **Analytics is mandatory, not optional.** Every app-creation Business Plan MUST include a populated `## 7. Analytics` section, and the agent MUST propose it proactively **as an expert in the app's business domain** — the dashboards, KPIs, and widgets an experienced practitioner would expect for each role and section, never generic filler (never wait for the developer to ask). Plan `### 7.1 Section analytics` (per-section **dashboards**, ~2-3 per section unless the developer asks for more; each dashboard carries **at least 5 widgets** — a metric band plus charts/lists) and `### 7.2 Workplace analytics` (the app's **single home page**, with **at least 10 widgets** since it aggregates the whole app). At implementation time build them per `../../runbooks/03-app-implementation.md` step 5, following `get-guidance name=dashboards` (routes to `dashboard-creation`, `dashboard-and-home-page-layout`, `dashboard-design`, `indicator-widget`, `chart-widget`, `dashboard-rights`, `home-page`); §7.1 dashboards are hosted on the section list page's `crt.Dashboards` element (grouped by section in the plan); §7.2 is **one** `BaseHomePage` (charts/metrics on a single page, NOT multiple dashboards) bound to the app's workplace — normally the already-existing **"My applications"** (found via `SysModuleInWorkplace`) — through `SysWorkplace.HomePageUId`, never on the shared core `FreedomDashboards` page. Only in the rare case where no workplace hosts the app's sections must one be created (clio cannot create a workplace today; resolved via `get-tool-contract`, tracked under ENG-88474); before binding a shared workplace's `SysWorkplace.HomePageUId`, run the pre-write clobber check (surface, don't silently overwrite an existing home page). Each §7.1 dashboard states `access rights: All Employees` — a **static default**: dashboards are created visible to everyone (the role a dashboard is for drives its **content**, not its access); the implementation applies that static grant via `dashboard-rights`. The §7.2 **home page has no per-page access rights** (its audience is the workplace). Role-scoped least-privilege is out of scope here (future roles work). The workflow validator fails a plan whose `## 7. Analytics` is missing or empty.
- **Schema naming is mandatory, not optional.** Whenever the workflow creates or names data-model elements (`create-entity-schema`, `update-entity-schema`, `create-lookup`, and the objects/columns implied by `create-app`/`create-app-section`), you MUST invoke the **`creatio-schema-naming`** skill **before** choosing object, title, column, field, lookup, Guid/UId, or relation-object names, and apply its rules together with `../../context/naming-conventions.md`. Do not invent names from memory — inconsistent or non-conventional names are hard to correct after the schema is published.
- **Web→mobile page conversion is a dedicated skill.** Whenever the task is to make an existing Freedom UI web page available in the Creatio Mobile app (convert/port a page to mobile, build a mobile list/form page, or register a converted page as a mobile section/workplace), invoke the **`creatio-mobile-page-conversion`** skill — it loads the conversion playbook, invokes `creatio-ui-guidelines` before authoring the mobile body (satisfying the UI/UX rule above for its `create-page`/`update-page` calls), and enforces the conversion gates (Gate M before any write, Gate S before any section registration). Do not convert from memory or skip the gates. Note the delegate's **preflight**: the converter is an experimental clio feature off by default (`mobile-page-converter`), so on an environment where the flag is not enabled the skill STOPS and asks the operator to run `clio experimental --name mobile-page-converter --enable` first — a Business Plan that references only Gate M/Gate S will hit this precondition before either gate.
- Keep the visible planning artifact in the BA-style Business Plan format defined by `../../AGENTS.md`.
- Follow `../../context/product-telemetry.md` for CAADT product telemetry; use the installed Analytics Context values when calling clio telemetry tools.
- Resolve executable clio MCP tool contracts through `get-tool-contract`; do not invent payload shapes.
- **Run a clio MCP availability preflight before the first clio operation; the STOP decision is a deterministic gate, not a judgement call the agent can reason past.** If native clio MCP tools are surfaced to the host (e.g. `get-tool-contract` is a resident tool-call), proceed. If no native tools are surfaced, that is **not automatically a blocker** — run the gate script `../../runtime/scripts/clio_mcp_preflight.py` and act on its exit code and sentinel: **State B `usable` (exit 0, `PREFLIGHT: clio-mcp-usable`)** means clio is healthy but the host isn't surfacing native tools — **first recommend the developer connect native clio MCP** (generic; defer per-host how-to to `../../README.md` / `../../docs/install.md`, never hardcode agent-specific steps) and retry, and only if that cannot be done fall back to the stdio wrapper (explicit opt-in, framed in plain language: slower, no progress, not the recommended path) — and when you present the choice, list the **connect-native option first and marked recommended**, never lead with the wrapper; **State C `blocked` (exit 3, `BLOCKER: clio-mcp-unavailable`)** means STOP and return the gate's **prerequisites blocker** verbatim (install .NET, install clio via `dotnet tool install clio -g` — or add an existing install to PATH — and register the environment via `clio reg-web-app`). On State C do not self-bootstrap: **do not install** or download the .NET SDK, do not change PowerShell `ExecutionPolicy`, and do not silently register environments. A registered-but-**unresponsive** server is State C — one bounded probe, then the blocker; do not retry indefinitely. Full contract in `../../AGENTS.md`, "clio MCP availability preflight".
- Resident tools (`get-tool-contract` index: `resident=true`) are called natively when the host exposes clio MCP as native tool-calls; every other tool is invoked via `clio-run <command>` regardless of transport. `../../runtime/scripts/mcp_client.py` is an **explicit opt-in escape hatch** for hosts with no native MCP transport — never the default degraded path and never the automatic response to an unavailable server; run it only after the developer explicitly opts in. Do not reverse-engineer its CLI contract when native calls are available (see `../../AGENTS.md`, "clio MCP transport preference").
- Before the first schema or page edit, resolve a writable package context up front: on an existing/installed app confirm the target package is unlocked and editable, otherwise unlock or select/create a writable package before editing. Do not discover the write rejection mid-run.
- Use `../../context/business-checklist.md`, `../../context/essentials.md`, `../../context/naming-conventions.md`, `../../context/clio-cli-reference.md`, and `../../context/model-discovery-evidence.md` as the canonical repository references.
- Treat `../../.mcp.json` as the plugin MCP connection definition; it starts the global `clio mcp-server` process through the host coding agent. This native MCP and the `mcp_client.py` wrapper must point at the same `clio`, so they share one config and one registered-environments list (single clio context).
