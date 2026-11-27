# Pre-configured process pages

A business process opens a pre-configured page as one of its steps and waits for the user. The page has no object
of its own: its fields bind to page parameters the process element fills and reads back, and its buttons end the
step or leave it open. The engine recognises such a page from its seed chain — a layer that defines
`BasePageProcessTemplate`, `BasePageSimpleProcessTemplate`, `BasePageLeftContainerProcessTemplate` or
`BasePageRightContainerProcessTemplate` — and plans it with the profile below. An empty `entitySchemaName` alone is
not a process page.

## What the profile changes

- **No section, list page, add mini page or primary data source.** `planMeta.sectionSchema`, the section's on-stand
  `signals` and the section host in `placement` do not apply; `placement.targetPackageEditable` still does. The page
  is named after its schema (`<Schema> (process page)`).
- **No object, even when the Classic chain names one.** The Pages group's row is *Bound to the process
  parameters*, not *Bound to the EXISTING object*, and the build tasks are titled after the page, not the entity.
  `--verify` closes that row when the read page's `modelConfig` names no primary data source, fails it when it
  names one, and leaves it open while the page or its `modelConfig` was not read. The scaffolding steps are in
  `./build-scaffolding.md` → *A process page*.
- **Page parameters keep their Classic names.** The process maps its parameters by name; a renamed parameter breaks
  every mapping into it. The Layout's Source column reads `page parameter <Name>`.
- **Each process button is planned by what it does to the step** (the plan's `### Process page` table):

  | Classic | Classic behaviour | Freedom |
  | --- | --- | --- |
  | `onSaveButtonClick` | validates, saves, completes | completing button, `validate: true` (the template's `SaveButton` for the template's own save button) |
  | `onCancelProcessElementClick` | completes WITHOUT saving; the tag is the result | a button with no `clicked` request, completing, `validate: false` |
  | `onProcessActionButtonClick` | read from the process element's `Buttons` for the tag: `PerformClosePage` completes (saving first with `PerformSaveData`), otherwise the page only closes | as the row above it matches |
  | the above with no element entry: tag `SaveData` | ⚠ template default: validates, saves, completes | completing button, `validate: true` |
  | the above with no element entry: any other tag (`ClosePage` too) | ⚠ template default: closes the page; the step keeps waiting | `crt.ClosePageRequest`, NOT selected as completing |

  A button hidden by default is still a process button: a rule or binding may show it.

  Two processes may treat the same tag differently (their elements' `Buttons` differ). The plan then says the
  behaviour differs by step, and each re-pointed step is checked against its own element: the button closes the
  page with `crt.ClosePageRequest` and is selected as completing only where that step's entry completes it.

  A button the template does not route — a customer click handler among the process buttons, or one whose body
  calls the template's process API (`cancelProcessElement`, `completeExecution`, …) — is listed with ⚠: read its
  handler, decide with the user what it does to the step, and record it in `manifest.processPage.handlers`
  (`{ "<Classic button name>": "complete-save" | "complete-no-save" | "close-open" }`) before the plan is
  approved. Until then its body is ported like any handler, and a page whose only way to end the step is such a
  handler keeps the way-out row at ⚠. Once recorded, the button is built and checked like a routed one; the
  handler itself does not run on the Freedom click, so the plan names it and any other work it does moves into the
  process or a page handler.
- **The page always keeps a way out:** at least one completing button and one exit that leaves the step open (the
  Freedom template's `BackButton` / `CloseButton`), even where the Classic page removed its Close. A hide rule never
  removes that exit.

Why the element decides: in Freedom UI the Pre-configured page process element names the buttons that complete the
step, and the runtime appends `crt.CompleteProcessElementRequest` to exactly those buttons, after the button's own
requests and with the element's `validate` flag. The page code alone cannot end a step. `crt.SaveRecordRequest`,
`crt.ClosePageRequest` and `crt.CancelRecordChangesRequest` are all valid on a completing button, and so is no request.

## Discovery: the process steps

The plan is incomplete (⛔ *process steps not recorded*) until `manifest.processPage` records the steps that open
the page. clio cannot search processes by page, so:

1. **Ask the user** which business processes, and which steps in them, open this page. An answer of "none" is valid.
2. For each step, read the process with `describe-business-process` and take from the Pre-configured page element:
   its name, the `Buttons` entries (`Tag`, `PerformClosePage`, `PerformSaveData`), and whether a conditional flow
   leaves the element on its result.
3. Record it:

```json
"processPage": {
  "stepsResolved": true,
  "evidence": "the user named the delivery process",
  "steps": [
    { "process": "UsrDeliveryProcess", "element": "CheckDelivery", "caption": "Check the delivery",
      "buttons": [{ "tag": "SaveData", "performClosePage": true, "performSaveData": true }],
      "resultBranches": false, "consent": "pending" }
  ],
  "handlers": { "UsrApproveButton": "complete-save" }
}
```

`consent` is `pending` until the user answers the plan (below).

## Consent and re-pointing

The plan lists every step under *Process steps to re-point*. The user approves them with ONE answer and may untick
single steps; record each as `"consent": "approved"` or `"declined"` and re-run `--plan`. The consent is
not part of the plan version, so the approval in `decisions.md` still matches the re-run plan.

Re-pointing changes the user's process, so it is the orchestrator's job, never a builder's, and runs after the page
is built and only for approved steps:

Read each tool's arguments from `get-tool-contract` before you call it.

1. `get-process-page-facts` on the Freedom page — the completing-button candidates and data sources.
2. `modify-business-process-as-new-version`, changing the element's page to the Freedom page, with the buttons the
   plan selects as completing (each with its `validate`) and the page's data sources passed through unchanged.
3. `set-active-business-process-version` on the new version. Rollback is activating the previous version; running
   instances stay on the version they started in.

Do NOT re-point a step whose process branches on the element's result (`resultBranches: true`): the result set
becomes the Freedom buttons, so the old conditions may stop matching. The migration result gives the user the
manual steps instead — which Freedom button stands for which Classic tag. A declined step, a clio refusal, or a step
nobody named gets the same manual steps, and its row stays open until a decision (`--decide D<N>`) records them.

## Verify

The `Process page` rows of `--verify` read, besides the page itself, two fields the orchestrator writes into
`<migration-folder>/process.json` (beside `evidence.json`; `--from` merges them into the payload):

- `--built.processSteps` — `describe-business-process` of each re-pointed step:
  `[{ "process", "element", "page", "active", "buttons": [{ "name", "validate" }] }]`;
- `--built.processStandCheck` — the stand check: `{ "pressed": [{ "button": "<Freedom button>", "outcome": "completed" | "open", "process", "element" }] }`.
  `process` / `element` name the step the press ran in; they are required for a button whose behaviour differs by
  step, which is judged per press against that step's element.

| Row | ✅ when |
| --- | --- |
| `[process button] …` | the button is on the page with a request the plan allows, and every re-pointed step selects a completing button with the Classic `validate` and never selects an exit |
| way out | a completing button exists and a visible `crt.ClosePageRequest` button no step selects |
| `[process step] …` | the step is re-pointed to the Freedom page in the active version |
| stand check | every button was pressed from the process step with its Classic outcome |

**The stand check is mandatory.** Open the page from a running instance of the process step and press each
button: a completing button must end the step, an exit must leave it waiting. Without the record the row reads
*built, not exercised* and the run is not COMPLETE.

## Processes a migrated page starts

A button or request that starts a business process (`ProcessModuleUtilities.executeProcess`, `runProcess`,
`crt.RunBusinessProcessRequest`, …) reaches the process's own user-task pages. They are not in the migrated page's
chain, and `ProcessInModules` does not list a process the page code starts, so without this step they stay Classic
while the plan says *Connected processes: none*. When the page or its section starts a process, the plan is
incomplete (⛔ *started processes not followed*) until `manifest.launchedProcesses` records each one:

1. For each process the banner names, read it with `describe-business-process` and take each Pre-configured page
   step: the element name, the page it opens, and whether that page is Classic or Freedom UI.
2. A process the code names at runtime (no literal name): ask the user which process it is and record it, or say in
   `evidence` why none can be named.
3. Record it:

```json
"launchedProcesses": {
  "resolved": true,
  "processes": [
    { "name": "MbApproveContractProcess", "caption": "Approve contract",
      "userTasks": [{ "element": "ApproveContractPageUserTask", "page": "MbApproveContractProcessPage",
                      "ui": "classic", "decision": "pending" }] }
  ]
}
```

`userTasks: []` records a process with no user-task page. `boundary: "<why>"` in place of `userTasks` records why
its pages are out of this migration's scope; the plan states it.

The plan lists the processes under **Processes this page starts**, and the `Connected processes` line names them.
Every Classic user-task page is a decision the user takes with the plan: `"decision": "migrate"` (a separate run of
that page, planned with the process-page profile above) or `"keep-classic"`. Until it is recorded, its
`[process user task]` row reads ⚠ *decide with the user*. A page to migrate keeps the row open until its own run is
done and `<migration-folder>/process.json` records it as `"processPagesMigrated": [{ "page": "<Classic page>",
"freedomPage": "<Freedom page>" }]`.
