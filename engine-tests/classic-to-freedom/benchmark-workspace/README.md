# `MbMigrationBench`: a Classic test app for migration runs

A small, synthetic Classic UI app for trying the `classic-to-freedom-migration` skill on a stand you
own. Install it on a clean stand, migrate it, and compare the result before and after a toolkit
change. It holds no customer data: every name, record and line of code here is made up.

This folder is a clio workspace. The package source is `packages/MbMigrationBench/`. The tests under
`engine-tests/` do not load it, and the release zip does not ship it.

## What is in it

The domain is "Service contracts": one section with a contract page, its details, and two sister
document pages. Each part is there because migrations get it wrong:

| Pattern | Where it is | What a migration has to handle |
|---|---|---|
| Package prefix that differs from the stand setting | Every schema is `Mb…`, every column `Mb…`; the stand's `SchemaNamePrefix` stays `Usr` | Generated names follow the package convention (`Mb…`, `mb.` for requests), not the stand setting |
| Section with an edit page | `MbContractSection`, `MbContractPage`; registered in `SysModule` / `SysModuleEntity` / `SysModuleEdit` | List page and record page, both reachable from the app |
| Detail registered on a base page | `MbBaseDocumentPage` adds the **History** tab with `MbDocumentLogDetail` inside the tab insert; `MbContractPage` and both document pages inherit them | A detail that the page's own layer never declares is still found and decided on |
| Detail with summaries, quick filters and a menu | `MbContractItemDetail`: a "Total / Active items" label, the "Active only" and "Due in 30 days" toggles saved to the user profile, and a "Deactivate selected" menu item | Each feature gets a Freedom counterpart or an explicit decision |
| Read-only detail | `MbContractPaymentDetail` (no add, edit, copy, delete or open) | The detail stays read-only |
| Static disabled fields | `MbAmount` and `MbApproved` on the contract page, `MbTotal` on the item page, `MbIsPosted` on the document pages (`"enabled": false` in the diff) | Fields stay read-only |
| Wizard-owned business rules | `businessRules` of `MbContractPage`: End date required when status is Active; Approval comment visible when approved; Start date editable only in Draft; Contact filtered by Customer. `businessRules` of `MbReturnNotePage`: Return reason required when the amount is above 0 | Each rule is migrated as a page rule or an entity rule, or listed as not migrated |
| Entity-level business rule | `MbContractBusinessRule`, a business-rule add-on of the `MbContract` object: Approval comment required when approved. Freedom pages apply it; Classic pages do not | The object rule is found and kept, and told apart from the page rule on the same field |
| Code-owned rules | `rules` of `MbContractPage`: Customer and End date editable only while `MbCanEditFields` is true (false when the contract is Closed) | Read-only state driven by an attribute survives the migration |
| Sister pages with shared logic | `MbDeliveryNotePage` and `MbReturnNotePage` both use `MbDocumentTotalsMixin` for the **Post** button. Posting writes `MbIsPosted` to the record first and changes the page, the History line and the amount only when that write succeeds; it recalculates the contract amount as active items plus posted delivery notes minus posted return notes; `MbContractPage` uses the same method when an item changes, so the amount has one definition | The shared logic stays shared, not copied into each page |
| Page that writes data when it opens | `MbContractPage.mbAssignNumber` increments the `MbContractLastNumber` system setting when a new contract card opens | A browser check of the new-record page changes data; the migration has to say so |
| Process with a Classic process page | The **Start approval** button (declared on the contract page, and again on `MbContractSection` for a card opened from the list) runs `MbApproveContractProcess`: Start, then a pre-configured page step that opens `MbApproveContractProcessPage` (parent `BasePageProcessTemplate`), then End. The step passes the `ContractId` process parameter to the page, which declares it as an attribute; the page's **Approve** button writes the comment and the approved flag, then completes the step. On an approved contract the page's button is disabled; the section's copy cannot bind to the card's method, so it stays enabled and says the contract is already approved | The page is recognised as a process page, and the process that opens it is found and decided on |
| Section action and selection | "Close selected contracts" in the section actions | The action is migrated or listed |

Demo data ships with the package:

- one account, "Northwind Demo Ltd";
- two contacts: "Alex Demo" belongs to the account, "Sam Outsider" does not, so the Contact filter shows;
- two contracts: "Annual service contract" (Active, approved, amount 2100 = items 1200 + 450 + posted
  delivery note 450) and "Pilot contract" (Draft, not approved, the record for the approval flow);
- three items, one of them inactive; one item is due in 2099, so the "Due in 30 days" toggle always hides it;
- two payments;
- two delivery notes, D-0001 posted and D-0002 not posted, and one return note, R-0001, not posted, so the
  **Post** button is reachable on both sister pages and the posted state shows on D-0001;
- two log lines;
- `MbContractLastNumber = 2`.

## Install

Use a clean stand with Classic UI available (the base Classic schemas such as `BaseSectionV2`
must exist). From this folder:

```bash
clio push-workspace -e <environment>
```

The package installs locked (`InstallType 1`), like a package from a customer's archive. To edit
it on the stand afterwards, install it with `--unlock`, and set the stand's `SchemaNamePrefix` to
`Mb` while you edit, or new schemas get the `Usr` prefix.

Open the section in Classic UI at `<stand>/0/Nui/ViewModule.aspx#SectionModuleV2/MbContractSection`.

## Reset to the baseline

A click-through changes the shipped records: approving a contract, posting a document, closing a
contract, deactivating an item and opening a new contract card (it increments
`MbContractLastNumber`). The columns the app writes are force-updated in the package data, so an
install puts them back. A plain second `clio push-workspace` does not, because the stand skips package
data that has not changed since its last install. To restore the baseline, mark the package data as
old on the stand, then push again:

```sql
UPDATE d SET ModifiedOn = '2000-01-01'
FROM SysPackageSchemaData d JOIN SysPackage p ON p.Id = d.SysPackageId
WHERE p.Name = 'MbMigrationBench';
```

Rows the click-through added (log lines from **Post**, new contracts and documents) stay: delete them
by hand if a run needs the exact baseline.

## Change it

1. Install the package unlocked and set `SchemaNamePrefix` to `Mb` on the stand.
2. Change the app on the stand.
3. Export it back into this folder: `clio restore-workspace -e <environment>`.
4. Keep only the `en-US` resource and data files (the workspace `.gitignore` drops the others).
5. Delete `packages/MbMigrationBench/Files/app-descriptor.json` if the export wrote one: it pins the
   platform version of the stand it came from.
6. Set `SchemaNamePrefix` back to `Usr`.

A schema without a parent (the mixin) must keep its full JSON `metadata.json`. The diff form that
pages with a parent use fails to install for it.

A detail that a base page adds must sit inside the tab insert, not in an insert of its own. The
generated content of a child page applies the base page's diff twice, and the duplicate removal keeps
the second copy of the tab, so a separate detail insert ends up in the copy that is thrown away.

A card opened from the section list shows the section's card buttons, not the page's own
`LeftContainer` buttons, so a page button also needs an entry in the section's
`CombinedModeActionButtonsCardLeftContainer` that calls it through `onCardAction`.

The process was generated from a template, not drawn in the process designer. In its
`metadata.json`, each mapping of the page step keeps, in `GT5`, the id that the pre-configured page task
gives to that parameter. With any other value the step gets no page and the process fails when it starts.

## Tested on

Creatio 10.2.959 (MSSQL, .NET Framework), the only stand it has been installed on; the workspace's
`ApplicationVersion` says the same. The package depends on `CrtBase`, `CrtNUI`,
`CrtUIPlatform7x`, `CrtWizards7x` and `CrtProcessDesigner`.
