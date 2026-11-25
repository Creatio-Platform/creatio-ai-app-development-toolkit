# `mbcontract-v2-recorded` — a form page whose logic lives in a client module

Not synthesized. Recorded from the MbContract v2 benchmark run of the Classic→Freedom migration
(`migrations/mbcontract-eng103105-v2`, 2026-11-25). Two files from that run:

- `bundle-main.json` is the run's `reads/02-bundle-main.json` (get-page's `bundle.json` for
  `UsrMbContractsV2App_FormPage`), trimmed to the fields a handler row or a card-action row reads:
  `name`, `viewConfig`, `handlers`, `deps`, `args`, `validators`, `converters`. Nothing in them is
  edited.
- `modules/UsrMbContractsV2App_FormPageModule.js` is get-page's `raw.body` for the module the page
  imports, with line ends normalized to LF.

`expected.json` is the plan side of the same run: the page's eight `Handler — …` rows, each with the
`Ported as (row N)` record its build task wrote, and the plan's `Card action — RunProcess` row.

## What it checks (`run-mapper-module-deps.mjs`)

The page declares `define("UsrMbContractsV2App_FormPage", ["UsrMbContractsV2App_FormPageModule"],
function(contractPage) …)`, and every handler only routes into the module:
`await contractPage.refreshCanEditFields(request)`. The run's `--verify` left all eight handler rows and
the Start approval card action unconfirmed:

1. The recorded `built.json` carried `deps` as get-page's source text (`'["…Module"]'`), not an
   array, so verify reported that the page entry carries no `deps`. It also dropped `args`
   (`(contractPage)`), because `assemble.mjs` did not copy that field, so no `contractPage.fn(…)`
   call could be read as the module's.
2. `MbStartApprovalButton` fires `mb.MbStartApprovalButtonClicked`. That request's handler calls
   `contractPage.startApproval(request)`, and the module sends `crt.RunBusinessProcessRequest`. The
   card-action row looked only for an element firing the platform request itself.

With `args` and the module source in the payload (`modules/<schema>.js` → `built.modules`), all
eight rows and the card action close.
