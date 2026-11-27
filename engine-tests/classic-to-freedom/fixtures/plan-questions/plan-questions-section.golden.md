### Questions before approval

> Only you can answer these, and the build needs the answers: a behaviour choice on a page, a change outside the target package or to the whole object, a page that writes data when it opens. They are asked before you approve the plan, the independent ones together; an open one keeps the plan from being approved.

| # | Question | Kind | Pages | Answer |
| --- | --- | --- | --- | --- |
| 1 | Billing type and Purchase type on a product line open a selection window. Show them as dropdowns instead? Both fields are defined in package UsrBillingBase, so the change is made there and applies on every page that shows them. | Change outside the target package | `child:UsrProductLine` | D9 |
| 2 | The usage-limit page locks its fields for everyone, while the usage-limit list let users with the "Change usage limits" right edit promotional limits. Which should the new page follow? | Behaviour choice | `child:UsrUsageLimit` | D10 |
| 3 | Usage limits are edited inside the list today and nothing opens a usage-limit page. Keep editing in the list, or open each limit in its own page? | Behaviour choice | `child:UsrUsageLimit` | D11 |
| 4 | The process page shows Order, Request and Account at the top, and the Classic step lets the user change them. Keep them editable, or show them read-only? | Behaviour choice | `main` | D12 |
| 5 | The product-line page locks single fields by order status. In the products list on the process page a cell cannot be locked per row: lock the whole list, open each line in its page instead of editing in the list, or both? | Behaviour choice | `main`, `child:UsrProductLine` | D13 |

