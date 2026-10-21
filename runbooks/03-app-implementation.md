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

### 4. Place the app in the navigation

#### Provision the planned roles and users first

The placement and the portal grants below name roles as their audience, so create the roles the plan
lists under `roles to create:`, then the accounts under `users to create:`, before any navigation
write. Skip this part when the plan says `roles to create: none` and `users to create: none`.

Call `get-guidance name=administration` FIRST and follow it — it owns the identity model, role kinds and
parents, manager groups, password handling, licenses and the version boundaries. Before assigning users
to an external organization, also read `get-guidance name=external-organizations`. Resolve
`inspect-role` / `manage-role`, `inspect-user` / `manage-user` and `inspect-license` /
`manage-license` through `get-tool-contract`; the `manage-*` tools are destructive, and the approved
plan is the authorization for exactly the roles and accounts it names — nothing more.

- Read the role tree before creating anything: reuse a role the plan names when it already exists under
  the same parent, and ask when a name matches more than one role.
- Create the roles, then each account, then its roles, then its license.
- An external (portal) account gets only the external roles the plan names. When the plan gives it an
  internal role, stop and ask the developer instead of assigning it.
- The password never passes through the agent and never appears in the plan, a file or the report;
  use only the mechanism the guide prescribes.
- When the guide or the environment refuses to create an account or assign its license, report the
  account as not created or not licensed — never work around the check.
- Verify every role and account by reading it back and list the created GUIDs in the report. Accounts
  and memberships are environment data: do not bind them into the package.

#### Place the app

`create-app` leaves the section in the `My applications` workplace, which is granted to
`System administrators` only — so until this step runs, the app is invisible to ordinary users no
matter how complete the schema and pages are. Apply the placement the approved plan states in
`## 2. Roles and Permissions`.

Call `get-guidance name=workplaces` FIRST and follow it — it owns the three-table model, the move
recipe, the data-binding column sets that make the placement transfer to the next environment, and the
destructive-path rules. For a home page, `get-guidance name=home-page` owns `HomePageUId`. Do not
improvise these writes from the tool contracts alone: a workplace bound with the wrong column set
installs on the next environment as an empty, unreachable entry, and one of the binding tools deletes
live records.

If `get-guidance name=workplaces` returns an unknown-topic error, STOP — do not fall back to
improvising the writes, because that is the exact failure the guidance exists to prevent. The topic is
delivered by clio's knowledge library and ships from its `1.13.0` release onward, so an unknown topic
means the installed clio carries an older library, or the library is not active. Call
`get-guidance name=list` to confirm the topic is absent from the catalog (an older clio lists the
names in the error's `availableGuides` instead), tell the developer the placement cannot be
applied safely until the knowledge library is at `1.13.0` or newer, and leave the section where it is
rather than half-applying a navigation change. The same holds for `name=home-page`: without it, report
the home page as created but not reachable.

If the plan does not state a placement, that is a Gate R defect, not something to decide here: stop and
ask the developer (see `../context/business-checklist.md`, "Users, access and ownership").

Tell the developer that navigation is cached, so they must log out and back in to see the app — a
browser refresh is not enough.

#### Open the portal sections to external users

Run this only when the approved plan has a `## 8. Portal section`; skip it otherwise. It needs the
section pages from step 3 and the roles provisioned above.

Call `get-guidance name=portal-sections` FIRST and follow it for each section the plan lists under
`portal sections:`. It sequences the separate portal page, its binding for `All external users`, the
workplace placement, the object grant and the record rules, and routes each step to the guide that owns
it. Do not improvise these writes from the tool contracts alone: an object grant to `All external users`
reaches every external user at once. The approved plan names the audience and the scope; it does not
replace the per-write preview and confirmation that guide requires.

The plan answers the questions that guide asks the developer:

- the section's external surface (its `list columns:`, `form groups:` / `form fields:`, `add page:` /
  `edit page:` lines) is the scope of the dedicated portal page — design that page with exactly those
  fields, never by reusing the internal page;
- `external workplace:` is the workplace the sections are placed in for `All external users` — create
  it or reuse the named one as the plan says;
- `external access:` is the set of operations of the object grant on the section's object;
- `external record scope:` is the record-access decision: `all` keeps every record visible to every
  external user, `own contact` and `own account` need record permissions ON and the record rule that
  guide routes to.

For `own contact` and `own account`, turn record permissions ON for the section's object before the
section is placed or its object is granted: with them OFF, the grant opens every record to every
external user. If they cannot be turned on with the available tools, write neither the placement nor
the grant — leave the section internal-only and tell the developer, as for a missing guide below.

Everything the plan does not settle is still asked as that guide says — a shared lookup the portal page
shows, an object not yet administered by operation permissions, applying rules to existing records. When
another step cannot be applied with the available tools (for example a record rule filtered by the
user's contact or account, once record permissions are ON), tell the developer that step is manual
and do not report the portal section as done without it.

If `get-guidance name=portal-sections` returns an unknown-topic error, STOP: the installed clio carries
a knowledge library older than `1.15.161`. Tell the developer the portal sections cannot be opened safely
until clio is updated, and leave the sections internal-only rather than granting access piecemeal.

Tell the developer that a portal user must log in again after the placement to see the section, and that
the real check is a portal-licensed external user opening it with data visible.

### 5. Build analytics dashboards

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
     section modules (join to `SysWorkplace` for the `Id`/`Name`).
     **Pre-write clobber check — HARD STOP (MANDATORY, before writing).** Read the target workplace's
     current `SysWorkplace.HomePageUId` first and **record the prior value in the implementation
     report** (so an accidental overwrite is detectable and recoverable) — do this even when it is
     unset. If it is already set to a non-empty, non-zero (`00000000-0000-0000-0000-000000000000`)
     value — another app already bound a home page to this shared workplace — then **STOP: do NOT call
     the write tool (`odata-update` / `create-data-binding-db`) until the developer has echoed back the
     exact prior `HomePageUId` value being replaced and explicitly approved the overwrite.** General
     "please confirm" is not enough — require the developer to repeat the exact prior UId, because
     binding is last-writer-wins and a silent overwrite breaks the other app's home page with no signal.
     Surface the existing `HomePageUId` and, if resolvable, which page/app owns it. Only when it is
     unset, or the developer has echoed the prior value and approved, proceed to write.
     Then set `SysWorkplace.HomePageUId` to the home page's `schemaUId` via `odata-update`, ship it as
     a package data binding with `create-data-binding-db` (schema `SysWorkplace`) so it survives a
     transfer, and read `SysWorkplace.HomePageUId` back to confirm — do not trust the install log.
  3. **Edge case only** — if no workplace hosts the app's sections at all, a workplace must be
     created. clio cannot create one today (`SysWorkplace` + `SysModuleInWorkplace` +
     `SysAdminUnitInWorkplace` span tables set up in the Creatio UI); a create-workplace tool is
     not yet available — resolve it through `get-tool-contract` so it is used automatically once
     it lands. Until then, in this rare case, stop and ask the developer to create the workplace in the
     UI, then bind. Do not treat this as the normal path: normally the workplace already exists (step 2).

  **Do NOT** place app-level analytics on the shared platform page `FreedomDashboards` (schema in the
  core `CrtNUI` package). It is a generic, OOTB dashboards page that is not scoped to this app's
  workplace, so the app's analytics would land there instead of on the app's own home page.

  **Known limitation (shared workplace).** When the target workplace is a shared one such as
  "My applications", `SysWorkplace.HomePageUId` is a single per-workplace value, so it is
  last-writer-wins across every composable app that shares that workplace, and the home page is visible
  to everyone with access to it — a wider audience than just this app's users. The pre-write clobber
  check above makes an overwrite explicit (surfaced and confirmed) instead of silent, but it does not
  remove the limitation: a truly app-scoped workplace (each app owning its own home page and audience)
  depends on the create-workplace capability, which is not yet available.
- **Access** — this applies to **§7.1 dashboards only**. Section-dashboard access is a **static
  default: `All Employees`**: every §7.1 dashboard is created visible to everyone (the plan states
  `access rights: All Employees` per dashboard for transparency). Ship the grant with the package per
  `dashboard-rights` so it survives a package transfer (grants are data, not schema, and are otherwise
  lost on transfer). The **§7.2 home page has no per-page access grant** — its audience is the
  workplace it is bound to (`SysAdminUnitInWorkplace`), so do not create `dashboard-rights` for it.
  Role-scoped (least-privilege) dashboard access is out of scope — do not derive per-role grants here,
  not even for the roles created in step 4.

Widgets may draw on any site object named in the plan — the app's own entities and standard platform
entities alike.

### 6. Verify and report

Verify each created section against `list-app-sections`, confirm the app's navigation placement (and
home-page binding) took effect by reading the workplace rows back, confirm the planned dashboards
exist on their host pages, and report operation, page, dashboard, navigation, and acceptance evidence
inline in the conversation.

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

The clio-side error wording for this failure is being improved upstream (clio owns the
diagnostic message and the entity-existence probe). Because this playbook triggers on the failure
**class** rather than one exact string, it holds for both the old wording and the improved
diagnostic — no change is required here when the clio-side wording lands.

## Completion Criteria

✅ The application and all planned sections exist and are verified against `list-app-sections`
✅ The section sits in the workplace the plan states, and that workplace grants the planned roles —
   verified by reading the rows back, not from an install log. `list-app-sections` proves a section
   exists; it says nothing about which workplace it is in
✅ When the plan has a home page, the target workplace's `HomePageUId` points at it (read back)
✅ Every navigation change was mirrored into a package data binding, so the placement survives a
   transfer to another environment
✅ The developer was told a re-login is required for navigation changes to appear
✅ Every section dashboard (`### 7.1`) exists on its section list page's `crt.Dashboards` element with
   its widgets laid out and bound to `DashboardDS`; every workplace chart/metric (`### 7.2`) lives on
   the app's `BaseHomePage`, which is bound to the app's workplace (normally "My applications") via
   `SysWorkplace.HomePageUId` (confirmed by reading it back) — never placed on the shared
   `FreedomDashboards` page
✅ No section was created by varying its caption, and no `compile-creatio` was run speculatively
✅ Execution, page, and acceptance evidence is reported inline in the conversation
✅ When support mode is on and the run returns a final response, include the canonical final support
block sections; sections with no items must be emitted as `None`
