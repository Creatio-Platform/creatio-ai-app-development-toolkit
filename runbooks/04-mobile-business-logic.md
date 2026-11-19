# Mobile business logic (remote module)

The process for adding custom business logic to the Creatio Mobile app: from the developer's request to
a module that the device loads. This runbook owns the whole flow — the preflight, the load order, the
telemetry points, the gates, and the plan and report formats. Paths in it are relative to the toolkit
root, the directory that holds `AGENTS.md`.

Use it whenever a **Freedom UI MOBILE page** needs behaviour that lives in code: reacting to a save, a
data load or an attribute change, running an action from a button, or feeding a page from data that no
entity holds. In the Creatio Mobile app that code is a **remote module** — a TypeScript project built on
the `@creatio/mobile-common` SDK into one script that a Creatio package carries to the device.

This is a **targeted, implementation-ready change**: it produces no BA-style Business Plan, and Gate P
and Gate R do not apply to it. When the logic is an item of a Business Plan that app creation is
applying, "Entered from app creation" below says what changes.

When the same behaviour is also needed on a Freedom UI **web** page, this runbook still owns the run,
and `runbooks/04-web-and-mobile-logic.md` adds the web part and splits the work between helpers.

## What this flow can and cannot deliver

A remote module registers **request handlers** and **virtual data sources**, and calls the SDK services.
That covers extending a built-in request, a custom request behind a button, computed attributes, lookup
and detail filters, navigation, dialogs, device services and data access through the model API.

The SDK has no API for a custom validator, a custom converter, a UI component or an authenticated HTTP
call. When the request needs one of those, do not invent it: offer the route step 3, "Choose the
mechanism", gives — a business rule, a built-in converter, a save handler that blocks with a
dialog, or a business process started from the handler — and say plainly what stays out of reach.

## Preflight (check first)

Run every check before the Load order. Each failed check is a **STOP** with its own message. The
orchestrator's clio MCP availability preflight comes first; these checks add what this flow needs.

1. **clio tool surface.** Call **`get-tool-contract`** and confirm the index lists `get-page`,
   `update-page`, `validate-page`, `get-request-info`, `create-workspace`, `add-package`,
   `push-workspace`, `list-package-files` and `get-package-file`. Use `get-tool-contract`, NOT the
   server's `tools/list`: the workspace and package-file tools are long-tail tools, reachable through
   `clio-run` and absent from `tools/list` even when they work. If any is missing, tell the user
   verbatim:

   > Your clio does not ship the tools this flow needs to deliver a mobile remote module. Update it with:
   > `dotnet tool update clio -g`
   > then re-run this request.

2. **Local toolchain.** Run `node --version` and `npm --version`. The build needs Node.js 22 or newer
   with npm. If either is missing or older, tell the user verbatim:

   > Building a mobile remote module needs Node.js 22 or newer with npm on this machine. Install it from
   > https://nodejs.org, then re-run this request.

   Never install or upgrade Node.js yourself.

3. **Environment.** Call `list-environments` and confirm the target environment is registered. Then
   call `list-package-files` for a package on it that carries files: the workspace and package-file
   tools need cliogate, and this call is the probe. One failed call is not the verdict — a package
   with no `Files` folder fails with the same gate message — so repeat it on a second package. Only
   when both fail, ask the developer to run `clio install-gate -e <environment>` and retry — do not
   run it unasked.

## Load order

0. Read clio `get-guidance` with name `core-rules` and name `routing`, as the clio server requires
   before any operation. Whether `routing` names `mobile-remote-module` or not, step 5 decides
   which guide owns the Creatio-side mechanics.
1. Read this runbook to the end. It defines the flow, the approval gates (Gate L, Gate D), the tool
   sequence, the plan and report formats and the device check. Follow it exactly.
2. Read `context/mobile-sdk-guide.md` before writing any module code, and the parts under
   `context/mobile-sdk/` that its table names for the mechanisms the plan uses;
   `context/mobile-module-project-layout.md` before creating the project, and
   `context/mobile-module-behaviour-check.md` before verifying the build. The installed SDK type
   declarations are the source of truth for the API; the guide says where they are and how to read
   them, and it wins only on the runtime rules the declarations cannot express.
3. Read `context/essentials.md` ("Freedom UI — Mobile Pages") for mobile platform basics.
4. **Before editing a mobile page body** (wiring a button to a request, adding a data source): call clio
   `get-guidance` with name `mobile-page-modification`, then **invoke the `creatio-ui-guidelines`
   skill** and apply its mobile-relevant rules to anything visible you add. When the logic plan
   itself adds something the user sees on a page — a button, a list, a caption — do both **before
   presenting the plan**, so the plan names components and texts that already follow those rules. A
   module that only shows its own dialogs changes no page body and does not trigger this step; the
   text rule in step 6 covers what such a dialog says.
   The UI guidelines are written for web pages. `mobile-page-modification` and the mobile catalog
   (`get-component-info` with `schema-type: "mobile"`) decide which components, containers and
   inputs exist on a mobile page; a guideline that needs one the catalog does not have — a tooltip
   on a label, a web action-button container — does not apply, and the plan need not mention it.
5. Call clio `get-guidance` with name `list`. When the catalog carries `mobile-remote-module`, read it:
   it owns the Creatio-side mechanics (the script contract, delivery, page wiring) and wins over this
   runbook on those. Which package the module goes into is this runbook's rule (step 5) whatever the
   installed guide says. When the guide is absent, this runbook's own mechanics apply — that is not a
   blocker.
6. Resolve every clio MCP tool contract through `get-tool-contract`; do not hardcode payloads.
7. When the request also needs the behaviour on a web page, read `runbooks/04-web-and-mobile-logic.md`
   before step 2 of the flow. The web mechanics it routes to are read by its helpers, not here.

## Product telemetry — emit the shared stages with `workflow: "mobile-business-logic"`

Read `get-guidance name=product-telemetry` for the stage vocabulary and the consent flow, and
`context/product-telemetry.md` for this flow's emission points. Emit with clio MCP
`send-telemetry`. Event names are **flow-agnostic stages**; this flow is identified by the `workflow`
field, so do not invent per-flow event names — clio rejects them.

| Send | With | At the point where you |
| --- | --- | --- |
| `workflow_started` | — | take the first request for mobile logic |
| `clarification_requested` / `user_input_received` | — | ask the developer something the flow waits on / receive their answer |
| `plan_blocked` | `variant=toolchain-unavailable` | fail a Preflight check — emit before the STOP message |
| `plan_presented` | — | present the plain-language logic plan |
| `plan_changes_requested` | — | the developer asks to adjust the plan at **Gate L** |
| `plan_approved` | — | get approval at **Gate L** — before any file is generated |
| `build_started` | — | begin creating the project |
| `work_item_completed` | `variant=module` | confirm the built module on the environment after **Gate D** |
| `work_item_completed` | `variant=page` | finish and validate a page that triggers or consumes the module, once per page |
| `workflow_completed` / `workflow_failed` | — | reach the end of the run |
| `changes_requested` | — | the developer asks for further changes AFTER the run completed. Emit before starting that follow-up work |
| `changes_applied` | — | the follow-up changes are deployed and confirmed |

Telemetry is non-blocking and must never interfere with Gate L or Gate D. If clio rejects an event name
(older clio), stop emitting for the rest of the run and carry on.

- **Gate D emits nothing.** No stage marks the delivery plan or its approval.
- `workflow_completed` means the module is delivered and confirmed on the environment. The device check
  is the developer's and may happen after the run ends.
- When consent is unknown and there is no developer to ask, emit nothing.
- Send `coding_agent` and `plugin_version` only when the installation supplies them; never invent one.

## Gates are MANDATORY

Logic is **plan-first**: inspecting the page and the SDK writes nothing, and both generating code and
delivering it require explicit developer approval **after** you present a plain-language plan.

- **Gate L** — before creating the project or writing any module code. The developer approves *what the
  logic does*, on which pages, and what it cannot do.
- **Gate D** — before ANY write to the Creatio environment (`push-workspace`, `update-page`). The
  developer approves *where it goes*: the environment, the package and the pages that change.
- **The initial request is NOT approval**, and in headless / autonomous mode you present the plan, ask,
  and END THE TURN without writing — never self-approve.
- **A green build is not a working feature.** Nothing in clio runs the Mobile app, so the run ends with
  the device check listed below, reported as *not yet confirmed* until the developer confirms it.

What each plan must contain and the FORBIDDEN-until-approved tool lists are in the "Gate L" and
"Gate D" sections below.

## How the pieces fit

- **The module** is a TypeScript project built on `@creatio/mobile-common` into a single script,
  `main.js`. See `context/mobile-module-project-layout.md`.
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
Creatio Mobile app, unless the developer names an older app version. State in the plan the app version
the module needs: the package's `CHANGELOG.md` names it in the heading of each version, and the newest
entry whose API the module uses decides it (see "The declarations are the API reference" in
`context/mobile-sdk-guide.md`). When the developer names an older app, compile against the newest
package version whose heading names an app version that is not newer. When no heading qualifies —
the app is older than every version the changelog names — take the newest package version that
precedes the oldest heading with an app version.

## Executable contract

Resolve each contract through `get-tool-contract` before the first call. Argument names are not
uniform across tools, so take each tool's names from its own contract instead of carrying them over
from another tool.

The long-tail tools are dispatched by name through `clio-run`; calling one by its own name fails
with a "no such tool" error. `clio-run` takes `{"command": "<tool>", "args": { … }}`, and `args`
holds the tool's own arguments directly. That holds for `send-telemetry` too: its fields go straight
into `args`, and a second `args` object nested inside is rejected as an unsupported field.

| Purpose | Tool |
| --- | --- |
| Confirm the environment and its gate | `list-environments`, `list-package-files` |
| Inspect the mobile page: attributes, component names, data sources, schema name | `get-page` |
| List the built-in mobile requests | `get-request-info` with `schema-type: "mobile"` |
| Find the mobile pages of an app | `list-pages`, `get-app-info` |
| Read the entity behind a page | `get-entity-schema-properties` |
| Find the modules already delivered | `list-packages`, `get-app-info`, `list-package-files`, `get-package-file` |
| Read the schema prefix, the maintainer and the taken package names | `get-schema-name-prefix`, `get-sys-setting`, `list-packages` |
| Read a feature state | `odata-read` |
| Read the file system mode | `get-fsm-mode` |
| Bring an existing package into the workspace | `restore-workspace` |
| Create the local workspace and bring in the page's package (or add a code package) | `create-workspace`, `restore-workspace`, `add-package` |
| Deliver the workspace to the environment | `push-workspace` |
| Confirm the script on the environment | `list-package-files`, `get-package-file` |
| Check a page change without saving it | `validate-page`, `update-page` with `dry-run: true` |
| Wire a page to the module | `update-page`, `validate-page` |

`update-page` is the page tool of this flow although its contract calls it a fallback for
`sync-pages`: the flow changes one page at a time, merges a fragment into the page and reads a dry
run first, and `sync-pages` offers neither the merge nor the dry run.

Shell commands the flow runs locally: `node --version`, `npm --version`, `npm view`, `npm pack`,
`npm install`, `npx tsc --noEmit`, `npm run build`, `node` for the local behaviour check, and a file
copy. `adb` is run only when the developer asks for the check on an emulator or a connected device
(see "Device check").

## Flow

### 1. Understand the request

Restate the behaviour in one or two sentences and name the page it applies to. If the request does not
say which page, or names a web page only, ask — web and mobile pages are separate schemas, and a module
attaches to mobile page schema names. When the answer is "both", the run has a web part: follow
`runbooks/04-web-and-mobile-logic.md` from here on.

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
   - the **package** that holds the page, `page.packageName` — the module goes into it (step 5);
   - the **attribute names** the logic reads or writes, as declared in `viewModelConfigDiff`;
   - the **data source names** in `modelConfigDiff`;
   - the **component names** the logic shows, hides or locks.
2. `get-request-info` with `schema-type: "mobile"` to find the built-in request that marks the moment
   the logic must run (save, load, attribute change, synchronization and so on). An answer resolved
   from the latest catalog with a version warning is the normal case; it does not block the flow.
3. `get-entity-schema-properties` when the logic reads or writes records.
4. Read the SDK declarations without creating a project: `npm view @creatio/mobile-common version` for
   the newest version, then `npm pack @creatio/mobile-common@<version>` into a scratch folder, unpack
   the archive and read `package/index.d.ts` and `package/CHANGELOG.md`. `context/mobile-sdk-guide.md`
   says how to read them. Plan only with classes and methods you found there, and note the app version
   each of them needs.
5. Names and facts the plan states:
   - `get-schema-name-prefix` — the environment's prefix; when it is empty, the plan proposes one
     (see "Names" in step 6);
   - `list-packages` — the `maintainer` of the page's package, which decides where the module goes
     (step 5); for a separate code package, that the name you propose is not taken;
   - `get-sys-setting` for `Maintainer` — needed to tell the developer how the package will arrive
     (see step 9);
   - `odata-read` on the `Feature` entity filtered by `Code` = `EnableMobileSDK`, and its state rows in
     `AdminUnitFeatureState`. The tool takes a structured `filters` object, not a filter string:
     `{"all": [{"field": "Code", "op": "eq", "value": "EnableMobileSDK"}]}`. No record or no state
     row means the default, which is enabled.
6. Confirm the page can be opened in the Mobile app at all, or the delivery cannot be checked: a list
   page is the mobile page of a section placed in a mobile workplace (`odata-read` on `SysModule`,
   column `MobileSectionSchemaUId`); a record page is the object's mobile page
   (`get-related-page-addon` with `schema-type: "mobile"` and the `package-name` of the object's
   package). When neither shows the page, ask the developer how users reach it before going further.
7. Find the modules that already act on the page. Every module on the device shares the page's
   requests, so the new logic runs next to them, and no tool lists them across packages.
   - **Read** the modules in the packages of the application the page belongs to (`get-app-info`),
     the page's own package included — that is where modules for this page are delivered. For each
     package, `list-package-files`: a path `src/mobile/<ModuleName>/main.js` is a module, and a
     package without files fails the call and is skipped. Read each script with `get-package-file`
     and record every handler it registers — its `type`, its `requestType` and its `scopes`; a
     handler with no `scopes` runs on every page, this one included. A script of a few bytes that
     registers nothing is a retired module.
   - **List, do not read,** the modules in the customer's other packages — those whose `maintainer`
     in `list-packages` equals the environment's `Maintainer` setting; read every page of the list
     while `truncated` is true. `list-package-files` names their modules without loading the
     scripts. They serve other pages; a handler among them without `scopes` would still run here,
     so the plan names them under "Already on the page" as not read. Read one only when the
     developer asks or when the device check shows behaviour the plan does not explain.

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
| Compute an attribute that drives visibility or a caption | A handler on `crt.LoadDataRequest` and on `crt.HandleViewModelAttributeChangeRequest` that sets the attribute — see `context/mobile-sdk/computed-text.md` |
| Show data that no entity holds, or that is assembled from several entities | A **virtual data source** |
| Call the server or an external system | A **business process** started with `crt.RunBusinessProcessRequest`; the process makes the call |

Out of reach for a module, to be stated in the plan rather than worked around:

- a field-level validator that marks the field itself — use the blocking save handler above, or an
  entity business rule;
- a custom converter usable in a binding — compute the value into an attribute instead;
- a custom UI component;
- a direct authenticated HTTP call from the device.

### 4. Present the logic plan — Gate L

Present the plan in the format below and wait. See "Gate L".

Ask a question before the plan only when the answer decides what is built and nothing in the request
or on the environment settles it — which page, which record. Every other case the request leaves
open is yours to decide and the developer's to correct: decide it, and list it in the plan.

Four things the plan must not leave implicit:

- **The cases the request does not mention.** An empty value, a record that is not saved yet, a date
  in the future, the action repeated on a record it was already applied to. State what the logic
  does in each under "Choices made", so the developer adjusts a choice instead of finding it on a
  phone.
- **What already acts on the page.** Name the handlers step 2 found on the same requests and say how
  the new logic lives with them: a save the module sends from its own handler passes through every
  save handler on the page, another module's included. Which of two modules' handlers runs first
  follows the package hierarchy: the plan may rely on it only when one package depends on the other
  (see "The order of handlers" in `context/mobile-sdk-guide.md`).
- **Whose data it is.** Anything the module keeps in memory is one value for the whole app (see
  "Runtime rules" in `context/mobile-sdk-guide.md`), and a virtual data source is not told which record's page it
  serves. Say whether the data is shared by every record or kept per record, and how long it lasts.
- **What it assumes.** When the logic depends on a built-in request the module does not send itself,
  name that request as an assumption. Whether the app sends it at that moment shows only on a device.

### 5. Create the workspace and the project

After Gate L:

1. Create a clio workspace with `create-workspace`, or reuse the one the developer names. The workspace
   arrives with its own `AGENTS.md` and solution files that describe C# and Angular work; for the
   mobile module follow `context/mobile-module-project-layout.md` and this runbook, not that file. This flow covers an
   environment with file system mode off: when `get-fsm-mode` reports it on, say in the delivery plan
   that the delivery is not established for that mode.
2. **The module goes into the package that holds the page** — `page.packageName` from step 2. The
   module then travels with the page: when its application is exported or installed on another
   environment, the handlers arrive with the buttons and data sources that need them. List the
   package under `Packages` in the workspace's `.clio/workspaceSettings.json`, run
   `restore-workspace`, and follow "A module inside an existing package" from here on.
   `restore-workspace` downloads from the environment and writes only the local workspace, so it needs
   Gate L and not Gate D. When the logic spans pages in different packages, use the package of the
   page the logic belongs to most and name the others in the plan.

   Use a **separate code package** instead only when the page's package is not the customer's — its
   `maintainer` differs from the environment's `Maintainer` setting, as for a package shipped by
   Creatio or installed from the Marketplace, which a later update replaces — or when the developer
   asks for one. Say in the plan that the module then does not travel with the page's application.
   Add it with `add-package`; pass the package name and the workspace path only, no environment.
   `add-package` scaffolds a C# project into the new package: an assembly-type descriptor and, under
   `Files/`, a `.csproj` with build files and — depending on the clio version — library and source
   folders. A script-only package must not carry them — they would be compiled on the environment at
   every delivery. Before the first push:
   - in `packages/<Package>/Files/`, delete everything the scaffold created: `<Package>.csproj`,
     `Directory.Build.targets`, and `src/cs/` and `Libs/` when they are there. List the folder
     instead of trusting this list; after the cleanup and the staging of step 7 it holds the module
     script and nothing else;
   - in `packages/<Package>/descriptor.json`, set the package's own `Descriptor.Type` to `0` (not the
     `Type` of an entry under `DependsOn`) and remove the `ProjectPath` property. Keep the
     `DependsOn` entries as generated;
   - in the workspace's `MainSolution.slnx`, remove the `<Project …>` line that points at the deleted
     `.csproj`.
   Leave the rest of the package folder as generated.
3. Create the project per `context/mobile-module-project-layout.md` in the workspace, outside `packages/`:
   `<workspace>/mobile-modules/<ModuleName>/`.
4. Run `npm install` in the project.

`push-workspace` installs the workspace copy of every package it holds, so a stale local copy of the
page's package replaces whatever was changed on the environment since it was restored. "A module
inside an existing package" says when to restore again.

### 6. Write the module

Follow `context/mobile-sdk-guide.md`. Rules that hold for every module:

- One module per feature area; one `@CrtModule` class per project, named exactly as the project folder.
- **Names carry a customer prefix.** It is the environment's schema prefix from
  `get-schema-name-prefix`. The module, the package and a data source name start with it
  (`UsrOrderLogic`); a handler `type` and a request `type` start with it in lower case and a dot,
  followed by a PascalCase name without the prefix (`usr.OrderSaveGuard`). When the environment's
  prefix is empty, a prefix is still required: propose one under "Choices made" — the developer's
  company prefix, `Usr` when they have none — and use it for every name.
- Names share one namespace across every module on a device, and clio has no tool that lists the types
  already delivered. Make each name specific — the feature and the purpose — instead of generic.
- A handler that extends a built-in request calls `this.next?.handle(request)` unless stopping the chain
  is the purpose, and returns its result.
- A handler is scoped to the page schema names from step 2, as they are — a Freedom UI page has no
  `_Root` scope. An unscoped handler runs on every page of the app; use that only when the plan says
  so, as it must for logic on the rows of a list or a detail, which carry no scopes.
- **User-visible text.** Text a module shows (a dialog message, a button caption) follows the same copy
  rules as text on a page: short, in the page's language, and saying what the user can do next. When
  porting web behaviour, reuse the web page's texts. Keep them in one constants block of the module.
  Reading them from the page's resources instead is a page change — the strings have to be added to
  the mobile page first — so offer it in the plan only when the developer needs the texts translatable.
- **Lookup values.** Compare and set a lookup by the id of its row, never by its display text, which
  follows the user's language and can be renamed. Read the id from the environment with `odata-read`
  and keep it in the constants block. That id belongs to this environment: another one has the same
  row only when the lookup's records travel there in a package, so name the lookup and the row
  under "Choices made".
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
   stub SDK, as `context/mobile-module-behaviour-check.md` shows, on a table of inputs with the expected outcome of
   each: at least one input per branch of the plan's "How" section, including the one that must change
   nothing. When the logic ports a web handler, run that handler on the same inputs and compare.
   Keep the table: the same inputs become the developer's steps in the device check.
5. Stage the script: copy `out/mobile/<ModuleName>/main.js` to
   `<workspace>/packages/<Package>/Files/src/mobile/<ModuleName>/main.js`. Copy that one file only: the
   device evaluates every `.js` file in the folder, so a second script would load the module twice.
   Note its size in bytes for the delivery plan.
6. When the plan changes a page, prepare the change and try it without saving. Write the fragment
   as `get-guidance mobile-page-modification` describes, run `validate-page` on it, then
   `update-page` with `dry-run: true`. The dry run reads the page from the environment, performs the
   merge and reports what a save would add, replace and reject; it saves nothing, which is why Gate D
   allows it. Fix what it reports and note its result for the delivery plan. A custom request name
   in a button is not checked by either tool — it is proven only on the device.

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
   - `get-package-file` with that path returns the script; its content equals the staged file. Compare
     the content itself — save it and compare the files, or compare the first line, the last line and
     the handler registration. `content-length` counts characters, not bytes, so it is shorter than
     the file whenever the script holds non-ASCII text. The
     `project-error` it also returns for a script-only package — the `.csproj` is unavailable — is
     expected and needs no action.
3. Wire the pages the plan names. For each page: `get-page`, apply the change, `update-page` with a dry
   run, then for real, then `validate-page`. Repeat the dry run here even when step 7 ran one: the
   page may have changed since. The page mechanics — diff shape, target schema, resource
   strings — are owned by `get-guidance mobile-page-modification`. `validate-page` checks the shape of
   the body; it does not check that a data source binding resolves or that a request name has a
   handler. `update-page` is the only tool that checks the bindings, and a custom request is proven
   only on the device.
   - A change merged into the page (`mode: append`) is a JSON object with the `viewConfigDiff`,
     `viewModelConfigDiff` and `modelConfigDiff` keys, each a list of operations. The marker pairs
     the tool contract speaks of belong to a web page body.
   - `update-page` warns that what it saved is not in any workspace and that a later push of the
     page's package from an old copy would undo it. With a separate code package the workspace does
     not hold the page's package, so nothing follows from the warning; for a module inside the
     page's own package, "A module inside an existing package" says what to do.
   - A button that runs a custom request: `"clicked": { "request": "usr.<Name>Request", "params": { … } }`.
     Parameter values may be bindings (`$AttributeName`). Never put `type` or `scopes` inside `params`.
   - A virtual data source: see "Virtual data source on a page" in
     `context/mobile-sdk/virtual-data-sources.md`.

### 10. Device check and report

clio cannot run the Mobile app, so the last step belongs to the developer. Hand over the checklist from
"Device check" and present the report in the format below. Report the run as **delivered, not yet
confirmed on a device** until the developer says the behaviour works. When the developer asked you to
run the check on a device they offered, the report says instead which steps passed there and on
which device.

## A module inside an existing package

The module goes into the package that holds the page by default (step 5). Next to a new code package,
such a delivery differs in four ways. State each of them in the delivery plan.

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

## Entered from app creation

When `runbooks/03-app-implementation.md` hands over a Business Plan item, the developer has already
approved the behaviour at Gate R, so **Gate R stands in for Gate L**. Start at step 2. When the
inspection confirms the item as written — the same pages, a mechanism for every behaviour, nothing
that falls under "Not covered" — build without presenting Gate L, and show the logic plan, filled in
from the inspection, at the top of the delivery plan for information. When it does not, present Gate L
for the difference only, and wait.

Gate D applies unchanged. The run reports under the app's `workflow: "app-creation"`: no
`workflow_started` or `plan_approved` of its own, and `work_item_completed` with `variant=module` and
`variant=page` as this runbook's telemetry table places them.

## Gate L — approve the logic

**Forbidden until approved:** creating the project, `npm install`, writing module code,
`create-workspace`, `add-package`, and everything Gate D forbids. Reading the SDK declarations from a
packed archive (step 2) is allowed.

Present the plan, then offer exactly two choices: **Adjust** or **Approve**. A reply that changes the
behaviour is an adjustment — present the plan again. Only an explicit approval of the presented plan
opens the gate; the original request does not.

## Gate D — approve the delivery

**Forbidden until approved:** `push-workspace`, `update-page` that saves, any `odata-update`, and any
change of a feature state. Reading the environment stays allowed, including `restore-workspace`,
which writes only the local workspace, and `update-page` with `dry-run: true`, which checks a page
change against the environment and saves nothing.

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
  Web pages: <web page schema names, when the run has a web part>
  Module: <ModuleName>   Package: <PackageName> (the page's package | new code package — <why>)

How
  - <moment or action> → <what happens>            [handler on crt.<X>Request, scope <Page>]
  - <button caption> on <Page> → <what happens>    [custom request usr.<Y>Request]
  - <list or field> on <Page> shows <data>         [virtual data source <Z>DataSource]

Page changes
  - <Page>: <button added | data source added | none>

Choices made
  <each case the request does not mention — an empty value, an unsaved record, a repeated action —
  and what the logic does there; "none" when the request settles every case>

Already on the page
  <each handler another module has on the same requests, with its package, and how the new logic
  lives with it; "nothing" when step 2 found none>
  Not read: <modules in the customer's other packages, with their packages; "none">

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
  The latest Creatio Mobile app from the App Store or Google Play, version <version> or later — the
  version the SDK changelog names for the newest API the module uses. When the changelog names none
  for that API: the latest Creatio Mobile app from the store.
```

Keep the bracketed technical column: the developer approves behaviour, and whoever maintains the module
later needs the mapping.

## Delivery plan format (Gate D)

```
Delivery plan — <feature name>

Environment
  <name> — <URL>

Package
  <PackageName> — <the page's package: re-installed in full from the workspace copy restored at
  <time> | NEW code package: only the module script — <why not the page's package>>
  It will arrive <editable | locked>.

What the push also does
  Registers an installed application named "CreatioPackages" on the environment (the workspace has no
  application descriptor); later pushes of this workspace update it.
  Takes one to three minutes. <No compilation and no restart. | EXISTING package with a C# project:
  the package is compiled, and its project files are added to it.>

Script
  Files/src/mobile/<ModuleName>/main.js — <size> bytes, staged in the workspace

Pages that change
  <Page>: <change> — dry run: <what it reported it would add and replace> | none

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
SDK       @creatio/mobile-common <version the project was built against>
Device    the latest Creatio Mobile app from the store, <version> or later
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

1. Update the Creatio Mobile app from the App Store or Google Play to the latest version; it must be
   at least the version the plan named. Open it, go to **Settings**, tap **Synchronize**, and wait
   for it to finish. The app
   reloads with the new scripts. If the synchronization reports an error, repeat it — a failed one
   delivers nothing.
2. Say where to go and what to do, in the app's own words: the section, the record, the tab and the
   field caption as they read on the page.
3. Give one step per row of the behaviour-check table from step 7: the exact value to enter or the
   action to perform, and the exact result to expect — the message text, whether the record is saved,
   what the field shows afterwards. Include the case where nothing special must happen.
   A step counts only when the user can perform it on the page as it is. A field the page hides or
   locks on a condition — a business rule, a visibility binding — can be edited only while the
   condition holds, and a date field is filled from a picker, not typed. Start each step from a
   record state in which its field is on the screen, and say how to reach that state.
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

### When the developer offers an emulator or a connected device

The check stays the developer's unless they ask you to run it and name the device. Then perform the
same steps yourself through `adb`, on that device only:

- First open **Settings** and read the environment address at the top. When it is not the
  environment the module was delivered to, stop and ask the developer to sign the app in to it; never
  sign in yourself, and never discard or save anything open in the app on another environment.
- Synchronize first, as step 1 says, and take a screenshot after every step: what the screen shows is
  the evidence. A system log with no error proves little — it holds nothing of a module that does
  not call `Logger.console`.
- Tap by the coordinates of the device's own resolution; a screenshot shown scaled down needs them
  converted back. A date picker is scrolled, not typed into.
- A record the check changes is test data you were given, not yours to keep changed. Note its values
  before the first step and put them back at the end — through the app, or with `odata-update` when
  the developer allows it — and list in the report what was changed and restored.
- Report each row of the table as passed, failed or not reachable on that page, and keep the run
  *not yet confirmed* for the rows you could not perform.

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
  The page's own package stays. A separate code package may be deleted afterwards; the script then
  left the served content at a later package installation on the environment, not at the deletion;
  tell the developer to expect the inert script on devices until then. Retiring is a Gate D write.
