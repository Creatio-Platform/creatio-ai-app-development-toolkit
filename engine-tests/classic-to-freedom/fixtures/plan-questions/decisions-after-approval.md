# Delivery check — decisions

The same section migrated without plan questions: the plan was approved after three answers, and the build stopped
on every behaviour and package question below. The `Plan question:` line on each says whether discovery could have
asked it.

## D1 — Products list totals use the Summaries component
- Kind: directive
- Decided by: user
- Quote: "use the Summaries component for the product totals"
- Scope: run
- Expectation: The products list on the process page shows its totals in a Summaries panel.

## D2 — Process step that opens the page
- Kind: answer
- Decided by: user
- Asked: Which business process opens the delivery check page?
- Quote: "the Create delivery process; I will re-point it myself"

## D3 — Target package
- Kind: answer
- Decided by: user
- Asked: Which package receives the new pages?
- Quote: "UsrApp"

## Plan approval
- Asked: Approve the plan so the build can start?
- Answer: "approved"
- Plan version: plan-000000000001
- Approved by: user

## D4 — Promotional limits editable with the "Change usage limits" right
- Kind: answer
- Decided by: user
- Asked: Should the usage-limit page follow the locked page or the list that let right holders edit promotional limits?
- Quote: "promotional limits plus the right, like the list"
- Plan question: missed

## D5 — Usage limits open in their own page
- Kind: answer
- Decided by: user
- Asked: Keep editing limits in the list, or open each in its own page?
- Quote: "open them in a page"
- Plan question: missed

## D6 — Billing type and Purchase type become dropdowns
- Kind: answer
- Decided by: user
- Asked: Show Billing type and Purchase type as dropdowns? It changes the two fields of the product line on every page.
- Quote: "dropdowns"
- Plan question: missed

## D7 — Step parameters stay editable, as in Classic
- Kind: answer
- Decided by: user
- Asked: Keep Order, Request and Account editable on the process page, or read-only?
- Quote: "editable, as in Classic"

## D8 — Products list: whole-list lock plus opening the line page
- Kind: answer
- Decided by: user
- Asked: Lock the whole products list, open each line in its page, or both?
- Quote: "both"
- Plan question: missed

## D9 — The dropdown setting is made in UsrBillingBase
- Kind: answer
- Decided by: user
- Asked: Both fields are defined in package UsrBillingBase, and the setting cannot be changed from UsrApp. Make the change in UsrBillingBase, on the product-line page only, or not at all?
- Quote: "change it in UsrBillingBase"
- Plan question: missed

## D10 — The product-line save stops on a past-period date, as in Classic
- Kind: answer
- Decided by: user
- Asked: The built save stops without saving when the activation date is in a past period. Keep the Classic dialog, or show the error on the field?
- Quote: "keep it as in Classic"
- Plan question: build-only — the page-code check found the save path only once the handler was written

## D11 — Shared helper functions live in one module
- Decided by: orchestrator
- Decision: The two helpers both pages copied are moved into one module.
