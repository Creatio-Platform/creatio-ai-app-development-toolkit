# `mbcontract-v2-recorded` — pages whose logic lives in client modules

Not synthesized: get-page reads of five Freedom pages of the MbContract v2 benchmark, a migration in which
every Classic method of a page was ported into a client module the page imports.

- `bundle-<page>.json` — get-page's `bundle.json` of each page, trimmed to the fields a handler or
  card-action row reads: `name`, `viewConfig`, `handlers`, `deps`, `args`, `validators`, `converters`.
  Nothing in them is edited.

  | page key | file | `deps` | `args` |
  | --- | --- | --- | --- |
  | `main` | `bundle-main.json` | `UsrMbContractsV2App_FormPageModule` | `(contractPage)` |
  | `list` | `bundle-list.json` | `UsrMbContractsV2App_ListPageModule` | `(listPage)` |
  | `child:MbContractItem` | `bundle-child-mbcontractitem.json` | `UsrMbContractsV2App_MbContractItemMiniPageModule` | `(itemPage)` |
  | `child:MbDeliveryNote` | `bundle-child-mbdeliverynote.json` | `@creatio-devkit/common`, `UsrMbContractsV2DocumentTotals` | `(sdk, mbDocumentTotals)` |
  | `child:MbReturnNote` | `bundle-child-mbreturnnote.json` | `@creatio-devkit/common`, `UsrMbContractsV2DocumentTotals` | `(sdk, mbDocumentTotals)` |

- `modules/UsrMbContractsV2App_FormPageModule.js` — get-page's `raw.body` of the form page's module, line
  ends normalized to LF.

`expected.json` is the plan side, per page: each `Handler — …` row with the `Ported as (row N)` record
its build task wrote (13 rows: 8 on the form page, 1 on the list page, 2 on the item mini page, 1 on
each note page), and the form page's `Card action — RunProcess` row.

Every handler only routes into its module through the name the page's factory gives it
(`await contractPage.refreshCanEditFields(request)`), and `deps` is get-page's source text, not an
array. The form page's `MbStartApprovalButton` fires `mb.MbStartApprovalButtonClicked`, whose handler
calls `contractPage.startApproval(request)`, the module function that sends
`crt.RunBusinessProcessRequest`; the template's Save button fires `crt.SaveRecordRequest`, whose page
handler calls `contractPage.refreshStartApprovalEnabled`, which sends nothing.

## What `run-mapper-module-deps.mjs` asserts on it

- Without `args` each handler row is ⚠ and names `args`; with `args` all 13 read ✅, each through its
  page's own name for the module.
- The Run-process card action is ✅ through the Start approval button, its handler and the module
  function it calls. Without that button it is ⚠: the Save button's handler is never credited.
- It is ⚠ without the module source, naming `modules/<schema>.js`.
