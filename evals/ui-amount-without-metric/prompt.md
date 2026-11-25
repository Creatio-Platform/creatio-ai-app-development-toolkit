---
name: ui-amount-without-metric
tags: [ui-guidelines, metrics]
runs: 3
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

We're adding an Expense reports app in Creatio. Two pages:

1. A mini page "Add expense line" opened from the report: description, amount, category, date, receipt attachment.
2. The Expense report record page: employee, reporting period, total amount (sum of the lines), approved limit for the period, status (draft, submitted, approved, rejected, paid), and the list of expense lines.

Design both pages in Freedom UI — layout and components. I'll build them with clio.
