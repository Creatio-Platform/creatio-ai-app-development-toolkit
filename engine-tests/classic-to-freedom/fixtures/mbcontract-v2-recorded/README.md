# `mbcontract-v2-recorded` — pages whose logic lives in client modules

Not synthesized. Recorded from the MbContract v2 benchmark run of the Classic→Freedom migration
(`migrations/mbcontract-eng103105-v2`, 2026-11-25).

- `bundle-<page>.json` — the run's `reads/*-bundle-*.json` (get-page's `bundle.json`) for the five pages
  whose handler rows the run left unconfirmed, trimmed to the fields a handler or card-action row reads:
  `name`, `viewConfig`, `handlers`, `deps`, `args`, `validators`, `converters`. Nothing in them is edited.

  | page key | file | `deps` | `args` |
  | --- | --- | --- | --- |
  | `main` | `bundle-main.json` | `UsrMbContractsV2App_FormPageModule` | `(contractPage)` |
  | `list` | `bundle-list.json` | `UsrMbContractsV2App_ListPageModule` | `(listPage)` |
  | `child:MbContractItem` | `bundle-child-mbcontractitem.json` | `UsrMbContractsV2App_MbContractItemMiniPageModule` | `(itemPage)` |
  | `child:MbDeliveryNote` | `bundle-child-mbdeliverynote.json` | `@creatio-devkit/common`, `UsrMbContractsV2DocumentTotals` | `(sdk, mbDocumentTotals)` |
  | `child:MbReturnNote` | `bundle-child-mbreturnnote.json` | `@creatio-devkit/common`, `UsrMbContractsV2DocumentTotals` | `(sdk, mbDocumentTotals)` |

- `modules/UsrMbContractsV2App_FormPageModule.js` — get-page's `raw.body` for the form page's module,
  line ends normalized to LF. It is the one module a row needs the source of: the Start approval card
  action.

`expected.json` is the plan side of the same run, per page: its `Handler — …` rows, each with the
`Ported as (row N)` record its build task wrote (13 rows: 8 on the form page, 1 on the list page, 2 on
the item mini page, 1 on each note page), and the form page's `Card action — RunProcess` row. Those are
the 14 rows of the reopen.

## What it checks (`run-mapper-module-deps.mjs`)

Every handler only routes into its module through the name the factory gives it:
`await contractPage.refreshCanEditFields(request)`, `await mbDocumentTotals.setNewDocumentDate(…)`.
The run's `--verify` left all 13 handler rows and the Start approval card action unconfirmed:

1. The recorded `built.json` carried `deps` as get-page's source text (`'["…Module"]'`), not an array,
   so verify said the page entry carries no `deps`. It also dropped `args`, because `assemble.mjs` did
   not copy that field, so no `alias.fn(…)` call could be read as the module's.
2. `MbStartApprovalButton` fires `mb.MbStartApprovalButtonClicked`, whose handler calls
   `contractPage.startApproval(request)`; that module function sends `crt.RunBusinessProcessRequest`.
   The card-action row looked only for an element firing the platform request itself.

With `args` in the payload all 13 rows close. With the form page's module source as well
(`modules/<schema>.js` → `built.modules`) the card action closes too.
