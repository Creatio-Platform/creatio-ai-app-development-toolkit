# Scaffolding — the app, the section and the page shells

Handed, with `./references/build-task-execution.md`, to the run's `Scaffolding` task. The placement
facts and the `sectionHost.mode` the user chose are in the approved plan (SKILL.md step 3.1); this
file is how the build carries that choice out, and how a form page moves to the template the plan
names (SKILL.md step 5).

## `new-app` is one call

**`new-app` is ONE call, and `create-app-section` is not part of it.** `create-app` takes
`optional-template-data-json`, and that is what binds the app's own section to an object that
already exists:

```json
{ "name": "<App name>", "code": "<AppCode>", "template-code": "AppFreedomUI",
  "with-mobile-pages": false,
  "optional-template-data-json": "{\"useExistingEntitySchema\": true, \"entitySchemaName\": \"<Entity>\"}" }
```

Both fields together, or neither: `entitySchemaName` alone is unsupported, and the entity must
already exist on the stand before the call. With them, Creatio suppresses the new canonical entity
it would otherwise mint and puts the app's section on yours.

Without them, `create-app` builds its starter section on a NEW entity named after the app — a list
page, a form page and a detail that migrate nothing — and a following `create-app-section` adds a
SECOND section beside it. A measured run shipped six pages where three were wanted, two of them
named identically in the app's page list, and paid an extra ~90-second call for the privilege:
`create-app` is `AppInstallerService.svc/CreateApp`, the platform's own app generator, while
`create-app-section` is a raw `DataService/json/SyncReply/InsertQuery` into the section tables.
`create-app-section` is for a SECOND section in an app that already exists — that is what
`existing-app` uses it for.

**Never repair an app's package composition on your own.** Linking a package to an app or flipping
its primary flag changes which package owns the app's identity and where the Section Wizard writes
every future schema. Surface it as a decision with the three `sectionHost.mode` values (SKILL.md
step 3.1); the user picks.

## Re-templating the scaffolded form page

**Re-templating the scaffolded form page: the sequence, so nobody improvises it.** Neither
`create-app` nor `create-app-section` accepts a template argument — the form page always arrives on
`PageWithTabsFreedomTemplate`. When the plan names a different one (SKILL.md step 5's template
table), the build does this, in this order, inside the ONE task that owns the page:

1. `get-page` the scaffolded form page and keep its body somewhere outside the repo — everything
   after this is destructive.
2. `delete-schema` that page.
3. `create-page` with the SAME schema name, the target `--template`, the target `--package-name` and
   `--entity-schema-name`. It gets a NEW `schemaUId`; nothing that referenced the old one follows
   it.
4. `create-related-page-addon` for the entity, in the target package, pointing the default page at
   the new `schemaUId`. Then `get-related-page-addon` and confirm `pageSchemaUId` + `isDefault` read
   back as you set them — the list page opens whatever this record says, and a build that skips it
   leaves a section whose rows open nothing.
5. **Give the new page a primary data source before anything binds to it.** A page `create-page`
   made from a template carries the template's `#PrimaryDataSourceName()#` macro UNEXPANDED, so it
   has no data source of its own: declare a `crt.EntityDataSource` (scope `page`) over the entity in
   `modelConfig`, set `primaryDataSourceName` to it, and point every attribute path at it
   (`PDS.<Column>`, including `Id`). Skipping this is not a validation error — `update-page` accepts
   the body, and the card then **hangs the browser** with `$Id` undefined. Measured on a live run.
6. Only now author the layout into the new page.

A re-template that stops after step 3 is the failure this sequence exists to prevent.
