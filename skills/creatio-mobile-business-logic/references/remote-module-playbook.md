# Mobile remote module playbook

The process for adding custom business logic to the Creatio Mobile app: from the developer's request to
a module that the device loads. `../SKILL.md` owns the preflight, the load order and the telemetry
table; this file owns the flow, the gates, and the plan and report formats.

## How the pieces fit

- **The module** is a TypeScript project built on `@creatio/mobile-common` into a single script,
  `main.js`. See `./project-layout.md`.
- **The package** carries it: the script sits at `Files/src/mobile/<ModuleName>/main.js` inside a
  Creatio package. The server collects every script under `Files/src/mobile` of every package; no
  manifest entry or schema registers a module.
- **The device** downloads the scripts during synchronization, as `<Package>/<ModuleName>/main.js`, and
  loads them when the synchronization completes. A module therefore reaches a user only after the
  package is on the environment **and** the user synchronizes the app. Installing the package is
  enough on the server side: the installer regenerates the file content it serves, and no separate
  compilation is needed for a package that carries only scripts.
- **The page** stays plain JSON. It never holds handler code; it only names a request (for example in a
  button's `clicked`) or a data source type that the module implements.

The SDK itself is part of the Mobile app, not of the bundle. The API a module can call is the one the
**installed app version** carries, whatever SDK version the project compiled against.

**Versions.** Use the newest published `@creatio/mobile-common` and assume the users run the latest
Creatio Mobile app, unless the developer names an older app version. State that assumption in the plan;
do not try to derive an app version from the SDK changelog.

## Executable contract

Resolve each contract through `get-tool-contract` before the first call. The long-tail tools are
dispatched by name through `clio-run`.

| Purpose | Tool |
| --- | --- |
| Confirm the environment and its gate | `list-environments`, `list-package-files` |
| Inspect the mobile page: attributes, component names, data sources, schema name | `get-page` |
| List the built-in mobile requests | `get-request-info` with `schema-type: "mobile"` |
| Find the mobile pages of an app | `list-pages`, `get-app-info` |
| Read the entity behind a page | `get-entity-schema-properties` |
| Read the schema prefix, the maintainer and the taken package names | `get-schema-name-prefix`, `get-sys-setting`, `list-packages` |
| Read a feature state | `odata-read` |
| Read the file system mode | `get-fsm-mode` |
| Bring an existing package into the workspace | `restore-workspace` |
| Create the local workspace and its code package | `create-workspace`, `add-package` |
| Deliver the workspace to the environment | `push-workspace` |
| Confirm the script on the environment | `list-package-files`, `get-package-file` |
| Wire a page to the module | `update-page` (dry run first), `validate-page` |

Shell commands the flow runs locally: `node --version`, `npm --version`, `npm view`, `npm pack`,
`npm install`, `npx tsc --noEmit`, `npm run build`, `node` for the local behaviour check, and a file
copy.

## Flow

### 1. Understand the request

Restate the behaviour in one or two sentences and name the page it applies to. If the request does not
say which page, or names a web page only, ask — web and mobile pages are separate schemas, and a module
attaches to mobile page schema names.

When the request points at behaviour a web page already has — "make it work like the web page", a page
conversion report listing a handler that was not transferred, a button removed because its request is
unknown, an attribute whose value a web handler computed — take the web handler's source as the
specification: read the web page with `get-page` and describe what each handler does before choosing a
mechanism.

### 2. Inspect the target

Everything in this step is read-only and happens before Gate L, because the plan needs its results.

1. `get-page` for each mobile page involved. Pass `output-directory` (a scratch folder): the tool writes
   the page files to disk and the workspace does not exist yet. Record:
   - the **schema name** — it becomes the handler scope;
   - the **attribute names** the logic reads or writes, as declared in `viewModelConfigDiff`;
   - the **data source names** in `modelConfigDiff`;
   - the **component names** the logic shows, hides or locks.
2. `get-request-info` with `schema-type: "mobile"` to find the built-in request that marks the moment
   the logic must run (save, load, attribute change, synchronization and so on). An answer resolved
   from the latest catalog with a version warning is the normal case; it does not block the flow.
3. `get-entity-schema-properties` when the logic reads or writes records.
4. Read the SDK declarations without creating a project: `npm view @creatio/mobile-common version` for
   the newest version, then `npm pack @creatio/mobile-common@<version>` into a scratch folder, unpack
   the archive and read `package/index.d.ts`. `./sdk-guide.md` says how to read it. Plan only with
   classes and methods you found there.
5. Names and facts the plan states:
   - `get-schema-name-prefix` — the environment's prefix, which may be empty;
   - `list-packages` — the package name you are about to propose is not taken;
   - `get-sys-setting` for `Maintainer` — needed to tell the developer how the package will arrive
     (see step 9);
   - `odata-read` on the `Feature` entity filtered by `Code` = `EnableMobileSDK`, and its state rows in
     `AdminUnitFeatureState`. The tool takes a structured `filters` object, not a filter string. No
     record or no state row means the default, which is enabled.
6. Confirm the page can be opened in the Mobile app at all, or the delivery cannot be checked: a list
   page is the mobile page of a section placed in a mobile workplace (`odata-read` on `SysModule`,
   column `MobileSectionSchemaUId`); a record page is the object's mobile page
   (`get-related-page-addon` with `schema-type: "mobile"` and the `package-name` of the object's
   package). When neither shows the page, ask the developer how users reach it before going further.

Never guess an attribute or component name: a handler that addresses a name the page does not declare
fails silently on the device.

### 3. Choose the mechanism

Prefer the simplest thing that runs offline and needs no code.

| The request is | Use |
| --- | --- |
| Show, hide, lock or require a field on a condition; set a value from a condition | A page or entity **business rule** — no module. Hand back to the page flow. |
| Transform a bound value in one of the built-in ways | A **built-in converter** in the binding — no module. |
| React to save, load, attribute change, open, close, synchronization | A **handler on the built-in request**, scoped to the page |
| Run an action from a button or a menu item | A **custom request** plus its handler; the page names the request |
| Block a save when a value is invalid | A handler on `crt.SaveRecordRequest` that shows a dialog and does not call the next handler |
| Compute an attribute that drives visibility or a caption | A handler on `crt.LoadDataRequest` and on `crt.HandleViewModelAttributeChangeRequest` that sets the attribute |
| Show data that no entity holds, or that is assembled from several entities | A **virtual data source** |
| Call the server or an external system | A **business process** started with `crt.RunBusinessProcessRequest`; the process makes the call |

Out of reach for a module, to be stated in the plan rather than worked around:

- a field-level validator that marks the field itself — use the blocking save handler above, or an
  entity business rule;
- a custom converter usable in a binding — compute the value into an attribute instead;
- a custom UI component;
- a direct authenticated HTTP call from the device.

### 4. Present the logic plan — Gate L

Present the plan in the format below and wait. See "Gate L". Two things the plan must not leave
implicit:

- **Whose data it is.** Anything the module keeps in memory is one value for the whole app (see
  "Runtime rules" in `./sdk-guide.md`), and a virtual data source is not told which record's page it
  serves. Say whether the data is shared by every record or kept per record, and how long it lasts.
- **What it assumes.** When the logic depends on a built-in request the module does not send itself,
  name that request as an assumption. Whether the app sends it at that moment shows only on a device.

### 5. Create the workspace and the project

After Gate L:

1. Create a clio workspace with `create-workspace`, or reuse the one the developer names. The workspace
   arrives with its own `AGENTS.md` and solution files that describe C# and Angular work; for the
   mobile module follow `./project-layout.md` and this playbook, not that file. This flow covers an
   environment with file system mode off: when `get-fsm-mode` reports it on, say in the delivery plan
   that the delivery is not established for that mode.
2. Add a **code package** to it with `add-package`; pass the package name and the workspace path only,
   no environment. A package that holds only module scripts keeps deliveries small and never
   overwrites pages or objects that people edit in the designers.
   `add-package` scaffolds a C# project into the new package: an assembly-type descriptor, a
   `.csproj`, library files and source files. A script-only package must not carry them — they would
   be compiled on the environment at every delivery. Before the first push:
   - in `packages/<Package>/`, delete `Files/src/cs/`, `Files/Libs/`, `Files/<Package>.csproj` and
     `Files/Directory.Build.targets`;
   - in `packages/<Package>/descriptor.json`, set the package's own `Descriptor.Type` to `0` (not the
     `Type` of an entry under `DependsOn`) and remove the `ProjectPath` property;
   - in the workspace's `MainSolution.slnx`, remove the `<Project …>` line that points at the deleted
     `.csproj`.
   Leave the rest of the package folder as generated.
3. Create the project per `./project-layout.md` in the workspace, outside `packages/`:
   `<workspace>/mobile-modules/<ModuleName>/`.
4. Run `npm install` in the project.

**Do not put the module into a package that the designers edit unless the developer asks for it.**
`push-workspace` installs the workspace copy of every package it holds, so a stale local copy of an
application package replaces whatever was changed on the environment since it was restored. When the
developer does want the module inside an existing package, skip `add-package`, bring the package into
the workspace with `restore-workspace`, and follow "A module inside an existing package" from here on.
`restore-workspace` downloads from the environment and writes only the local workspace, so it needs
Gate L and not Gate D.

### 6. Write the module

Follow `./sdk-guide.md`. Rules that hold for every module:

- One module per feature area; one `@CrtModule` class per project, named exactly as the project folder.
- **Names.** A handler `type` and a request `type` always start with the literal `usr.` followed by a
  PascalCase name (`usr.CarVinSaveGuard`). The module, the package and a data source name take the
  environment's schema prefix from `get-schema-name-prefix`, and no prefix when it is empty
  (`UsrOrderLogic` on a `Usr` environment, `CarVinCheck` on one without a prefix).
- Names share one namespace across every module on a device, and clio has no tool that lists the types
  already delivered. Make each name specific — the feature and the purpose — instead of generic.
- A handler that extends a built-in request calls `this.next?.handle(request)` unless stopping the chain
  is the purpose, and returns its result.
- A handler is scoped to the page schema names from step 2. An unscoped handler runs on every page of
  the app; use that only when the plan says so.
- **User-visible text.** Text a module shows (a dialog message, a button caption) follows the same copy
  rules as text on a page: short, in the page's language, and saying what the user can do next. When
  porting web behaviour, reuse the web page's texts. Keep them in one constants block of the module.
  Reading them from the page's resources instead is a page change — the strings have to be added to
  the mobile page first — so offer it in the plan only when the developer needs the texts translatable.
- Keep the rule itself (a calculation, a check) in a plain function that takes values and returns a
  result, apart from the handler. Step 7 runs it without the app.

### 7. Verify locally

All of it must pass before Gate D. A failed check is fixed and re-run, not reported as a caveat.

1. `npx tsc --noEmit` — the code compiles against the installed SDK declarations.
2. `npm run build` — the bundle is produced.
3. Bundle checks, by reading `out/mobile/<ModuleName>/main.js`:
   - the file exists and is the only `.js` file in its folder;
   - it refers to the global `crtSdk` and does not contain the SDK itself (a bundle of a few kilobytes to
     a few hundred, not megabytes);
   - the name passed to `bootstrapCrtModule` equals the folder name.
4. **Behaviour check.** The three checks above pass without one line of the module running, so a wrong
   condition or a save that is never blocked gets through them. Run the built bundle under Node with a
   stub SDK, as `./local-behaviour-check.md` shows, on a table of inputs with the expected outcome of
   each: at least one input per branch of the plan's "How" section, including the one that must change
   nothing. When the logic ports a web handler, run that handler on the same inputs and compare.
   Keep the table: the same inputs become the developer's steps in the device check.
5. Stage the script: copy `out/mobile/<ModuleName>/main.js` to
   `<workspace>/packages/<Package>/Files/src/mobile/<ModuleName>/main.js`. Copy that one file only: the
   device evaluates every `.js` file in the folder, so a second script would load the module twice.
   Note its size in bytes for the delivery plan.

### 8. Present the delivery plan — Gate D

Present the plan in the "Delivery plan format" below and wait. See "Gate D".

### 9. Deliver

After Gate D. For a module inside an existing package, when the package may have changed on the
environment since it was restored — the developer says so, or the approval did not follow the plan at
once — first run `restore-workspace` again and stage the script again (step 7, item 5).

1. `push-workspace` for the workspace. It takes one to three minutes and ends with the installer's log.
   Treat an installation error, or a non-zero exit code with no `Application installed successfully`
   line, as a failed delivery. A package that carries a C# project is also compiled by the push; a
   failure of that compilation after a successful installation is read as "A module inside an existing
   package" says. In a good log:
   - `Files saved in package "<Package>"` and `Application installed successfully` prove the delivery;
   - `Package "<other name>" loaded` lines name packages the workspace does not hold. They are part of
     a normal log; only a package with a `saved` line was written;
   - `Configuration build started … finished` with `File content generation` inside is the server
     refreshing the files it serves, not a compilation.
2. Confirm arrival:
   - `list-package-files` for the package lists the script relative to the package's `Files` folder —
     `src/mobile/<ModuleName>/main.js` — next to an `app-descriptor.json` the installer adds;
   - `get-package-file` with that path returns the script. Its `content-length` equals the size of the
     staged file, and the first line, the last line and the handler registration read the same. The
     `project-error` it also returns for a script-only package — the `.csproj` is unavailable — is
     expected and needs no action.
3. Wire the pages the plan names. For each page: `get-page`, apply the change, `update-page` with a dry
   run, then for real, then `validate-page`. The page mechanics — diff shape, target schema, resource
   strings — are owned by `get-guidance mobile-page-modification`. `validate-page` checks the shape of
   the body; it does not check that a data source binding resolves or that a request name has a
   handler. `update-page` is the only tool that checks the bindings, and a custom request is proven
   only on the device.
   - A button that runs a custom request: `"clicked": { "request": "usr.<Name>Request", "params": { … } }`.
     Parameter values may be bindings (`$AttributeName`). Never put `type` or `scopes` inside `params`.
   - A virtual data source: see "Virtual data source on a page" in `./sdk-guide.md`.

### 10. Device check and report

clio cannot run the Mobile app, so the last step belongs to the developer. Hand over the checklist from
"Device check" and present the report in the format below. Report the run as **delivered, not yet
confirmed on a device** until the developer says the behaviour works.

## A module inside an existing package

The default is a separate code package. A module that the developer wants inside a package the
environment already has is delivered differently in four ways. State each of them in the delivery
plan.

1. **Every restore removes the staged script.** `restore-workspace` replaces the local package folder
   with the environment's copy. Stage the script after each restore, and confirm the file is in the
   package folder before the push; a push without it delivers no script.
2. **The whole package is re-installed** from the workspace copy. Restore again when the package may
   have changed on the environment since the last restore.
3. **A package with a C# project is compiled.** When its `descriptor.json` has `Type` 1 or a
   `ProjectPath`, the push compiles the package after installing it and adds the project files that
   `restore-workspace` generated — `<Package>.csproj`, `Directory.Build.props`,
   `Directory.Build.targets` and build output under `obj/` — to the package. That compilation can fail for a reason outside the
   module, such as another compilation already running, and the push then ends with a non-zero exit
   code although the installation succeeded. When the log has `Application installed successfully`
   and `Files saved in package "<Package>"`, confirm the script as step 9 says and report the
   compilation as an open item. Starting a compilation is the developer's decision, never yours.
4. **Pages are wired after the push, and the package is restored once more after that.**
   `update-page` writes to the environment, so the workspace copy does not hold the new page body and
   a later push would put the old one back. Push first, run `update-page`, then `restore-workspace`:
   the workspace copy then holds the delivered script and the new page body.

An existing package stays in the application it belongs to; the push does not move it.

## Gate L — approve the logic

**Forbidden until approved:** creating the project, `npm install`, writing module code,
`create-workspace`, `add-package`, and everything Gate D forbids. Reading the SDK declarations from a
packed archive (step 2) is allowed.

Present the plan, then offer exactly two choices: **Adjust** or **Approve**. A reply that changes the
behaviour is an adjustment — present the plan again. Only an explicit approval of the presented plan
opens the gate; the original request does not.

## Gate D — approve the delivery

**Forbidden until approved:** `push-workspace`, `update-page`, any `odata-update`, and any change of a
feature state. Reading the environment stays allowed, including `restore-workspace`, which writes only
the local workspace.

Present the delivery plan in the format below, then offer **Adjust** or **Approve**. Approval of Gate L
is not approval of Gate D.

If the `EnableMobileSDK` feature is switched off on the environment (step 2), the device ignores every
module. Say so in the delivery plan and ask the developer to enable it —
`clio set-feature EnableMobileSDK 1 -e <environment>` — rather than changing it yourself.

## Plan format (Gate L)

```
Mobile logic plan — <feature name>

What it does
  <two or three plain sentences, no SDK vocabulary>

Where
  Pages: <mobile page schema names>
  Module: <ModuleName>   Package: <PackageName> (new code package | existing)

How
  - <moment or action> → <what happens>            [handler on crt.<X>Request, scope <Page>]
  - <button caption> on <Page> → <what happens>    [custom request usr.<Y>Request]
  - <list or field> on <Page> shows <data>         [virtual data source <Z>DataSource]

Page changes
  - <Page>: <button added | data source added | none>

Data kept by the module
  <none | what is kept in memory, whether every record shares it or each record has its own, and
  that it is gone when the app restarts>

Assumes
  <each built-in request the logic depends on and does not send itself; "nothing" when none>

Works offline
  <yes | no — which step needs the server and what the user sees without a connection>

Not covered
  <each requested behaviour the SDK cannot deliver, with the offered alternative; "nothing" when none>

Needs on the device
  The latest Creatio Mobile app (the module is built against SDK <newest version>).
```

Keep the bracketed technical column: the developer approves behaviour, and whoever maintains the module
later needs the mapping.

## Delivery plan format (Gate D)

```
Delivery plan — <feature name>

Environment
  <name> — <URL>

Package
  <PackageName> — <NEW code package: only the module script | EXISTING package: re-installed in full
  from the workspace copy restored at <time>>
  It will arrive <editable | locked>.

What the push also does
  Registers an installed application named "CreatioPackages" on the environment (the workspace has no
  application descriptor); later pushes of this workspace update it.
  Takes one to three minutes. <No compilation and no restart. | EXISTING package with a C# project:
  the package is compiled, and its project files are added to it.>

Script
  Files/src/mobile/<ModuleName>/main.js — <size> bytes, staged in the workspace

Pages that change
  <Page>: <change> | none

Feature
  EnableMobileSDK: <enabled by default | switched off — must be enabled first>

Taking it back
  A delivered script stays on devices after its file or package is deleted. To switch the logic off,
  an empty script is delivered in its place.

After the delivery
  I confirm the script on the environment. It starts working on a phone after the user synchronizes
  the Mobile app; I will give you the steps to check it there.
```

How the package will arrive: the `push-workspace` contract describes a package new to the environment
as locked. A package whose `Maintainer` in `descriptor.json` equals the environment's `Maintainer`
system setting can arrive editable instead. Compare the two and state the one that applies;
either suits a code package, which changes only through the next push.

## Report format

```
Mobile logic — <feature name>: delivered, not yet confirmed on a device

Module    <ModuleName>, <n> handlers, <n> custom requests, <n> virtual data sources
Package   <PackageName> on <environment>
Script    Files/src/mobile/<ModuleName>/main.js — confirmed on the environment
Project   <local path to the project>
Pages     <Page>: <change> (validated) | none changed

Check on a device
  1. <step>
  2. <step>

Not covered
  <as in the plan>

To change the logic later
  Edit the project, rebuild, and deliver again through this flow; the script on the environment is
  build output and is never edited in place.
```

## Device check

The developer checks by hand, on an ordinary phone with no cable and no debugger. Give steps that need
nothing else, adapted to the feature:

1. Open the Mobile app, go to **Settings**, tap **Synchronize**, and wait for it to finish. The app
   reloads with the new scripts. If the synchronization reports an error, repeat it — a failed one
   delivers nothing.
2. Say where to go and what to do, in the app's own words: the section, the record, the tab and the
   field caption as they read on the page.
3. Give one step per row of the behaviour-check table from step 7: the exact value to enter or the
   action to perform, and the exact result to expect — the message text, whether the record is saved,
   what the field shows afterwards. Include the case where nothing special must happen.
4. If the previous behaviour is still there, close the app completely, start it again and repeat.
5. If it still does not work, in **Settings** tap **Send log** and send the log back. An error thrown
   by a handler is there as an `ERROR Type: JSError` entry with its message and a line number inside
   the script; it does not name the module, which is why every thrown message starts with the module
   and handler name.

When the log shows nothing, the usual causes are a page the user does not actually open (another
workplace, another page for the same record), a scope that does not match the page schema name, and a
synchronization that did not complete.

A module cannot be traced step by step on a store build of the app: `Logger.console` output is not in
the log that **Send log** sends. To see an intermediate value, deliver a version that shows it in a
temporary dialog, and remove that dialog in the final delivery. A computer with USB debugging can read
the same output with `adb logcat`.

## Changing or retiring a module

- **Change:** edit, rebuild, run the behaviour check, stage, push, confirm, synchronize the device. The
  same two gates apply.
- **Retire:** deleting a delivered script is not a reliable way to withdraw it. A device can keep
  receiving a script after its application is deleted, after the package is pushed without the script,
  and after a push that regenerates file content with the script absent from the package. A push that
  carries the script does replace its content. So, to switch a module off:
  1. replace `main.js` in the package with an inert script that registers nothing — `(() => {})();` —
     and push;
  2. confirm on a device, after synchronization, that the behaviour is gone;
  3. remove every page reference to the module's requests and data sources, because a button whose
     request has no handler does nothing when tapped.
  Deleting the package afterwards is optional. The script then left the served content at a later
  package installation on the environment, not at the deletion; tell the developer to expect the inert
  script on devices until then. Retiring is a Gate D write.
