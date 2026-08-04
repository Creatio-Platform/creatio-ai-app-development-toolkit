# Agent 03 — App Implementation

## Role

Apply the approved Business Plan on the resolved Creatio environment through clio MCP: create the
application, scaffold its sections, model entities, pages, and data, and build the analytics
(dashboards) from the plan's `## 7. Analytics` section. This runbook covers the post-Gate-R
execution stage where scaffolding tools such as `create-app` and `create-app-section` run.

## Input/Output

- **Input:** Approved Business Plan + Technical Implementation Handoff, and the `<env_name>` resolved
  by Agent 1.
- **Output:** The application, its sections, and its analytics dashboards created and verified on
  the environment, with execution evidence reported inline in the conversation.

## Context

Read `AGENTS.md` for the orchestration contract and `context/INDEX.md` for the smallest relevant
reference set. Resolve the executable MCP contract — tool names, parameters, response shapes, and
`in-progress` semantics — through `get-tool-contract`; do not hardcode payload shapes here.

## Support Mode

When support mode is on, follow `docs://mcp/guides/support-mode` for diagnostic-first behavior,
severity routing, confirmation probes, fail-fast evidence, and reporting. The transient site
reachability retry budget is owned by `docs://mcp/guides/agent-execution`. Do not restate either
policy in this runbook — the playbook below covers a different failure class (DB-side write
contention during scaffolding), not transport or reachability failures.

---

## Steps

### 1. Create the application

Create the application from the approved plan using the current app-creation tool resolved through
`get-tool-contract`. Report the installed application identity inline.

### 2. Scaffold sections sequentially

Create one section at a time with `create-app-section`. **Wait for each section to finish before
starting the next one.** Do not fire multiple `create-app-section` calls concurrently or
back-to-back without confirming completion.

Sequential creation is a correctness rule, not a style preference: section creation takes real time
(roughly 90–100 s per section on a busy environment), and parallel or rapid-fire creation is the
known root cause of the transient DB-write contention handled in **Error Handling** below.

### 3. Model entities, pages, and data

Apply the remaining plan (entities, lookups, pages, bindings) through the tools resolved from
`get-tool-contract`, following `docs://mcp/guides/app-modeling`. Schema and section mutations are
DB-first and immediately runtime-accessible — they do **not** require a separate compile or deploy
step.

### 4. Build analytics dashboards

Build the analytics from the plan's `## 7. Analytics` section. **Run this only after step 3 has
produced the section list pages** — a section dashboard is hosted on its section's list page, so
that page must already exist. Read `get-guidance name=dashboards` first; it routes to the specific
guides (`dashboard-creation`, `dashboard-and-home-page-layout`, `dashboard-design`,
`indicator-widget`, `chart-widget`, `dashboard-rights`, `home-page`). Resolve all tool names and
payload shapes through `get-tool-contract`; do not hardcode them here.

For each dashboard in the plan:

- **Section analytics (`### 7.1`)** — host the dashboard on the section's **list page**
  (`<Entity>_ListPage`, which carries the `crt.Dashboards` element). Create the dashboard page on
  `BaseDashboardTemplate`, resolving the three link-back `optional-properties`
  (`DashboardsEntitySchemaName` = the section entity, `DashboardsElementName`,
  `DashboardsClientUnitSchemaUId` = the ROOT host-page schema UId) from that list page per
  `dashboard-creation`. Lay out and size the widgets per `dashboard-and-home-page-layout`, and bind
  every data-bound widget to the hidden `DashboardDS` source per `dashboard-design`.
- **Workplace analytics (`### 7.2`)** — host app-level analytics on the app's **own home page**, per
  `home-page`. A home page holds its **widgets (metrics and charts) directly** — it is NOT a
  `crt.Dashboards` host, so there is no `DashboardDS` page-data filter to bind. Steps:
  1. Create a `BaseHomePage` page and capture its `schemaUId`. Add the `### 7.2` charts/metrics and
     lay them out per `dashboard-and-home-page-layout`.
  2. **Find the app's workplace and bind the home page to it.** A newly created app always registers
     its sections into a workplace — for a composable/Studio app that is normally **"My applications"**
     (or "Studio"), which already exists. Resolve it by reading `SysModuleInWorkplace` for the app's
     section modules (join to `SysWorkplace` for the `Id`/`Name`). Set that workplace's
     `SysWorkplace.HomePageUId` to the home page's `schemaUId` via `odata-update`, then ship it as a
     package data binding with `create-data-binding-db` (schema `SysWorkplace`) so it survives a
     transfer. Read `SysWorkplace.HomePageUId` back to confirm — do not trust the install log.
  3. **Edge case only** — if no workplace hosts the app's sections at all, a workplace must be
     created. clio cannot create one today (`SysWorkplace` + `SysModuleInWorkplace` +
     `SysAdminUnitInWorkplace` span tables set up in the Creatio UI); a create-workplace tool is
     tracked under ENG-88474 — resolve it through `get-tool-contract` so it is used automatically once
     it lands. Until then, in this rare case, stop and ask the developer to create the workplace in the
     UI, then bind. Do not treat this as the normal path: normally the workplace already exists (step 2).

  **Do NOT** place app-level analytics on the shared platform page `FreedomDashboards` (schema in the
  core `CrtNUI` package). It is a generic, OOTB dashboards page that is not scoped to this app's
  workplace, so the app's analytics would land there instead of on the app's own home page.
- **Access** — dashboards are created with the default `All Employees` read grant (access for
  everyone). Ship those grants with the package per `dashboard-rights` so they survive a package
  transfer (grants are data, not schema, and are otherwise lost on transfer).

Widgets may draw on any site object named in the plan — the app's own entities and standard platform
entities alike.

### 5. Verify and report

Verify each created section against `list-app-sections`, confirm the planned dashboards exist on
their host pages, and report operation, page, dashboard, and acceptance evidence inline in the
conversation.

## Error Handling

### Transient section-creation failure playbook

`create-app-section` can fail with a transient DB-write contention error even though nothing is
wrong with the input. Trigger this playbook on that failure **class** — not on one exact string.
It covers `InsertQuery failed`, `Select query failed`, any message that suggests you "change the
caption", and the richer diagnostic that newer clio versions return for the same condition.

When `create-app-section` fails with an error of this class:

1. **Check existence first — before any retry.** Call `list-app-sections` and check whether the
   section code/name already exists. Under write contention the creation may have partially
   succeeded server-side. If the section is already there, treat it as success and continue — do
   **not** create a duplicate.
2. **Wait 60–120 s.** If the section does not exist, pause to let the contention/lock window clear
   before retrying.
3. **Retry once with the SAME name and SAME caption.** Do not change any input on the retry.
4. **Treat `in-progress` as success-pending.** If the retry returns an `in-progress` result, poll
   `list-app-sections` (roughly every 30 s) until the section appears, up to an overall cap of about
   5 minutes. A section can take ~90–100 s to materialize; an occasional failed poll is tolerable —
   keep polling, do not escalate it into a retry storm. If the cap elapses and the section still has
   not appeared, **stop and report the pending state** to the developer; do not create the section
   again and do not retry.
5. **If the single same-name retry still fails outright** (a hard failure, not `in-progress`),
   **stop and report** the exact error to the developer. Do not retry a second time, do not vary the
   input, and do not compile.

### Do not

- **Do not vary or rename the caption to "probe" the error.** Caption-variation / rename loops
  (for example `Readers → Reader → Members`) waste time and risk creating duplicate sections. The
  caption is not the cause of a transient contention failure — ignore any error text that suggests
  changing it. This mirrors the anti-speculative-retry rule for environment registration in
  `runbooks/01-environment-setup.md`.
- **Do not run `compile-creatio` as a speculative fix during scaffolding.** Section and schema
  mutations are DB-first and immediately runtime-accessible; they do not need a compile. Only run
  `compile-creatio` when a runbook step or the developer explicitly requires it.

### Genuine validation errors are different

If clio returns a **concrete validation error about the input** (for example a genuinely invalid
name), that is not the transient contention class. Fix the input once per the diagnostic and
proceed — the "same-name retry" rule does not apply to real validation failures.

| Error | Action |
|-------|--------|
| `create-app-section` transient failure (`InsertQuery failed` / `Select query failed` / "change the caption" / newer equivalent) | Run the transient section-creation failure playbook above: check existence → wait 60–120 s → single same-name retry → poll `list-app-sections` on `in-progress`. Never vary the caption; never speculatively compile. |
| `create-app-section` returns `in-progress` | Success-pending. Poll `list-app-sections` (~30 s cadence, ~5 min cap) until the section appears. If the cap elapses without the section appearing, stop and report the pending state to the developer; do not re-create or retry. |
| Concrete input validation error | Fix the input once per the diagnostic; do not run the transient playbook. |
| Single same-name retry fails outright | Stop and report the exact error to the developer. No further automatic retries, no caption changes, no compile. |

## Coordination

The clio-side error wording for this failure is being improved under ENG-93089 (clio owns the
diagnostic message and the entity-existence probe). Because this playbook triggers on the failure
**class** rather than one exact string, it holds for both the old wording and the improved
diagnostic — no change is required here when the clio-side wording lands.

## Completion Criteria

✅ The application and all planned sections exist and are verified against `list-app-sections`
✅ Every section dashboard (`### 7.1`) exists on its section list page's `crt.Dashboards` element with
   its widgets laid out and bound to `DashboardDS`; every workplace chart/metric (`### 7.2`) lives on
   the app's `BaseHomePage`, which is bound to the app's workplace (normally "My applications") via
   `SysWorkplace.HomePageUId` (confirmed by reading it back) — never placed on the shared
   `FreedomDashboards` page
✅ No section was created by varying its caption, and no `compile-creatio` was run speculatively
✅ Execution, page, and acceptance evidence is reported inline in the conversation
✅ When support mode is on and the run returns a final response, include the canonical final support
block sections; sections with no items must be emitted as `None`
