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
- **Page parameters keep their Classic names.** The process maps its parameters by name; a renamed parameter breaks
  every mapping into it. The Layout's Source column reads `page parameter <Name>`.
- **Each process button is planned by what it does to the step** (the plan's `### Process page` table):

  | Classic | Classic behaviour | Freedom |
  | --- | --- | --- |
  | `onSaveButtonClick`, or tag `SaveData` | validates, saves, completes | completing button, `validate: true` (the template's `SaveButton` for the template's own save button) |
  | `onCancelProcessElementClick` | completes WITHOUT saving; the tag is the result | a button with no `clicked` request, completing, `validate: false` |
  | `onProcessActionButtonClick` | read from the process element's `Buttons` for the tag: `PerformClosePage` completes (saving first with `PerformSaveData`), otherwise the page only closes | as the row above it matches |
  | tag `ClosePage` or any tag with no element entry | closes the page; the step keeps waiting | `crt.ClosePageRequest`, NOT selected as completing |

  With no element read, `onProcessActionButtonClick` falls back to the template default and the row says so (⚠).
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
  ]
}
```

`consent` is `pending` until the user answers the plan (below).

## Consent and re-pointing

The plan lists every step under *Process steps to re-point*. The user approves them with ONE answer and may untick
single steps; record each as `"consent": "approved"` or `"declined"` and re-run `--plan`.

Re-pointing changes the user's process, so it is the orchestrator's job, never a builder's, and runs after the page
is built and only for approved steps:

1. `get-process-page-facts --schema-name <Freedom page>` — the completing-button candidates and data sources.
2. `modify-business-process-as-new-version` with `setElement` on the element: `page` = the Freedom page, `buttons` =
   the candidates the plan selects as completing, each with its `validate`, `dataSources` passed through unchanged
   (`[]` when the page declares none).
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
- `--built.processStandCheck` — the stand check: `{ "pressed": [{ "button": "<Freedom button>", "outcome": "completed" | "open" }] }`.

| Row | ✅ when |
| --- | --- |
| `[process button] …` | the button is on the page with a request the plan allows, and every re-pointed step selects a completing button with the Classic `validate` and never selects an exit |
| way out | a completing button exists and a visible `crt.ClosePageRequest` button no step selects |
| `[process step] …` | the step is re-pointed to the Freedom page in the active version |
| stand check | every button was pressed from the process step with its Classic outcome |

**The stand check is mandatory.** Open the page from a running instance of the process step and press each
button: a completing button must end the step, an exit must leave it waiting. Without the record the row reads
*built, not exercised* and the run is not COMPLETE.
