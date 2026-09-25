# Migrating a section's Classic dashboards (step 7.7)

Handed, with `./references/build-task-execution.md` and
`./references/classic-to-freedom-mapping.md`, to the task that migrates the section's dashboards. It
runs last, because it writes into the built list page. SKILL.md step 2 found the dashboards and step
4.2's `signals.dashboards` recorded them and the plan's delivery split.

**7.7 Classic dashboards (from step 2).** If `discovery.md` lists any, install the Dashboards
Migrator through clio:
`clio-run-destructive { "command": "install-dashboards-migrator", "args": { "environment-name": "<ResolvedEnvironment>" } }`
— resolve the contract with `get-tool-contract` first, and confirm the environment with the user
before calling, because the install runs a configuration build and restarts the instance. The tool
waits the instance back and probes the package's own `Ping`, so `success` means installed **and**
serving; a refusal names the fix (update clio, or a downgrade the user must decide). A clio that
reports the command as unknown is too old — ask the user to update clio rather than looking for
another route. Then hand the migration itself to the user: System Designer → **Dashboards
migration** → the section (or specific dashboards) → target Freedom UI page = the list page you
built → **Migrate**; results land in the **Dashboards migration log** section. Record the installed
version (`list-packages`) and the migration outcome in `worklog.md`; the DoD row stays open until
both are recorded or `discovery.md` says `none`. A clio too old to carry the verb is the one case
that closes it differently: record the gap in `worklog.md`, leave the task `DONE` rather than
`VALIDATED`, and carry on — the rest of the migration does not wait on it.

**Section dashboards — hand off to the migrator, LAST, and never rebuild them by hand.** When
`signals.dashboards` says the section has 7x dashboards, **`MigrateDashboardsProcess`**
(`CrtDashboardsMigratorApp`) migrates them; it runs last because it needs the *built* page to write
into. Storage model, the target page's ready-made structure, why the binding scan must be
package-agnostic, and the scope boundary: `./references/classic-to-freedom-mapping.md` → *Section
dashboards*.

1. **Confirm the target page** — always the section's Freedom **list** page. `get-page` it and
   confirm a **`crt.Dashboards`** element; if the list template ships none, ADD the tab + container +
   element to **that same page** first (structure and naming convention in the reference cited just
   above). Pass the element's `name` exactly as `get-page` reports it, never one you assumed.
2. **Resolve the parameter codes** with `get-process-signature` `MigrateDashboardsProcess` — never
   invent them. They are `SysModulesSelectedId` (the section's `SysModule.Id`),
   `SysSchemasSelectedId` (the built list page's **`SysSchema.Id`** — its PRIMARY KEY, *not* its
   `UId`; see below), `SysDashboardsSelectionStateFilter` (which dashboards to migrate),
   `DashboardsComponentsSelectedName` (the element `name` from step 1) and `TargetPackageName`
   (where the migrated client unit schema lands).
   - **`SysSchemasSelectedId` is a record Id, and `get-page` cannot give it to you** — it returns
     `schemaUId` / `rootSchemaUId` / `packageUId` / `designPackageUId`, never a `SysSchema.Id`. The
     process filters `SysSchema` on its PRIMARY column, so a `UId` passed here matches NO row,
     collapses to `Guid.Empty`, and the migration silently writes nowhere. Read the Id with
     `execute-esq` on `SysSchema` filtered `Name = '<BuiltListPage>'`, selecting `["Id","UId"]`.
   - **Take the RIGHT row.** A page name matches **one row per replacing layer**, each with its own
     `Id`/`UId` pair — pick the one whose `UId` equals the `schemaUId` `get-page` reported for the
     page you built, not the first row or the newest.
   - **`SysDashboardsSelectionStateFilter` takes a SERIALIZED ESQ FILTER, not a list of ids.** The
     process deserializes the value and runs it against `SysDashboard`, so put the resolved ids in
     an `InFilter` on `Id` — one `ParameterExpression` each, so every run carries its own
     destination's ids. Pass a bare JSON array or a comma-separated list instead and it does not
     deserialize into a filter: the run selects nothing and reports no error. Stand-verified shape,
     which resolved exactly the dashboard named:

     ```json
     {"className":"Terrasoft.FilterGroup","items":{"selectedDashboards":{"className":"Terrasoft.InFilter",
     "filterType":4,"comparisonType":3,"isEnabled":true,"leftExpression":{"className":"Terrasoft.ColumnExpression",
     "expressionType":0,"columnPath":"Id"},"rightExpressions":[{"className":"Terrasoft.ParameterExpression",
     "expressionType":2,"parameter":{"className":"Terrasoft.Parameter","dataValueType":0,"value":"<dashboard id>"}}]}},
     "logicalOperation":0,"isEnabled":true,"filterType":6,"rootSchemaName":"SysDashboard","key":""}
     ```

     Serialize it to ONE line before passing it — the wrapping above is for reading. Further ids are
     further `rightExpressions` entries.
3. **Run once per destination — at most twice.** `TargetPackageName` takes ONE value per run and the
   plan splits the dashboards in two, so a section with both needs **two runs**: one selecting the
   `saveInPackage` dashboards with `manifest.targetPackage`, one selecting the rest with no package.
   One run for everything gives every dashboard the same delivery, silently. **Omitting
   `TargetPackageName` is the supported stand-only route, not a missing input** — such a run is
   expected to succeed; both destination stores are in the reference cited above. **The split is the
   approved plan's, not yours to revise:** to change it, change `saveInPackage`/`skip` in the
   manifest, re-run `--plan`, and get the new split approved.
4. **`run-process` has NO `wait` parameter** — its optional `timeout` (seconds) bounds the HTTP
   request, not the MCP response, so **omit it** for a long migration. Read the outcome from
   `status`.
5. **`status: still-running` is neither success nor failure — do NOT re-run it.** Read the verdict
   from the run's `DashboardsMigrationLog` row, or the newest `SysProcessLog` row for
   `MigrateDashboardsProcess`. A DELIBERATE re-run is safe: already-migrated dashboards come back
   **skipped** and the count does not grow. A count that grows is a migrator defect to report, not
   to work around.
6. **The migrator build must be new enough.** If `get-process-signature` does not list
   `TargetPackageName`, this `CrtDashboardsMigratorApp` build predates it — stop and say so: running
   without it loses a packaged dashboard's delivery silently.
7. **Read the per-dashboard verdict — and treat `Partially migrated` as NOT done.** A run writes one
   `DashboardsMigrationLog` row plus one `DashboardMigrationLog` row per dashboard; this is the
   per-dashboard one, with a status of `Success`, `Skipped`, `Failed` or `Partially migrated`. The
   last means the dashboard EXISTS but something did not reach it — a widget the converter could not
   map, rights it could not bind. Name what is missing and whose it is, put the choice to the user
   (take it as it stands, or try to supply what is missing), and never make that call yourself nor
   report the migration complete without it. For unbound rights: attempt the referenced record only
   for a user GROUP nothing else references, leave a named USER's right out, and say plainly that
   the attempt is best-effort and its result not guaranteed.
8. **Read the result back on the route the PLAN decided — and in the right store.** Confirm each
   migrated dashboard landed where the approved split says it should
   (`./references/classic-to-freedom-mapping.md` → *Section dashboards* → *Where a migrated
   dashboard lands* names both stores and the naming rule); that read fills each entry's `package`
   in `built.dashboards`, which the *Delivery as planned* row checks. **If the migrator logged
   `Success` but you cannot find the schema, you are querying the wrong store — not looking at a
   failed migration.** Never answer a not-found by asking the user to name a package for stand-only
   dashboards: that converts their delivery instead of preserving it.
9. **Know the scope boundary before promising anything** — four things this migration explicitly
   does NOT cover: `./references/classic-to-freedom-mapping.md` → *Section dashboards* → *What this
   migration does NOT cover*.
