---
name: ui-project-record-lists-actions
tags: [ui-guidelines, record-page, related-lists]
runs: 3
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

We're building an Office renovation app in Creatio (Freedom UI). The Renovation project object has: name, code, client (Account), client contact, site address, project manager, status (Draft, Planning, In progress, On hold, Completed, Cancelled), health (Green, Amber, Red), priority (Low, Medium, High, Critical), start date, planned end date (projects usually run 12–24 months), next site inspection due (every 1–2 weeks), budget, actual cost, critical project (yes/no), notes.

Related records: work packages (name, phase, responsible, start, end, estimated hours, spent hours, status), materials (item, quantity, unit, unit price, supplier), change orders (number, title, amount, status, requested on), and site photos (file, caption).

Users open a project to check whether it is on track and to update work packages and materials during the week. On the page they need to: submit a change order (several times a week), export the project to PDF, recalculate the cost, archive the project, and copy it as a template (the last three a few times a year).

Design the Renovation project record page: template, what goes where, which components, how the related lists work, and any metrics or charts. I will build it with clio afterwards, so describe the structure rather than writing code.
