---
name: ui-collections-worklist
tags: [ui-guidelines, list-page]
runs: 3
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

I run the accounts receivable team at a mid-size commercial bank: 6 collectors, about 4,000 open invoices at any time, roughly 180 of them past due. In our Creatio app the Invoices object has: invoice number, customer, amount, due date, days overdue, last contact date, last contact outcome, promise-to-pay date, assigned collector, risk grade, and the customer's total exposure.

My collectors open the Invoices section first thing in the morning and work from it all day. Design that section's list page in Freedom UI: what it shows, in what order, and why. I'll build it with clio.
