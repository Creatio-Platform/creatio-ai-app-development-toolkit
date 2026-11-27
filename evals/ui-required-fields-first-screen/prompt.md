---
name: ui-required-fields-first-screen
tags: [ui-guidelines, record-page]
runs: 3
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

We're building a Fleet leasing app in Creatio (Freedom UI). The Lease contract object has these columns: contract number, lessee (Account), lessee contact, vehicle, VIN, start date, end date, monthly payment, currency, deposit, mileage limit per year, status, insurance company, insurance policy number, insurance valid until, maintenance package, delivery address, delivery date, signed by, signed date, internal notes.

A contract can't be saved without: contract number, lessee, vehicle, start date, end date, monthly payment, insurance policy number and insurance valid until.

Related records: payments, damage reports, mileage readings.

Design the Lease contract record page: which page template, what goes on which tab or island, and which components. I will build it with clio afterwards, so describe the structure rather than writing code.
