---
name: ui-supplier-record-dense-fields
tags: [ui-guidelines, record-page]
runs: 3
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

We're building a Procurement app in Creatio (Freedom UI). The Supplier object has 38 columns: legal name, trading name, supplier code, status, category, tax ID, VAT number, registration country, incorporation date, payment terms, currency, bank account, IBAN, SWIFT, primary contact, contact email, contact phone, address lines 1-3, city, postcode, country, approval status, approved by, approval date, risk score, last audit date, next audit due, insurance expiry, certifications, preferred flag, diversity classification, parent company, created by, created date, modified by, modified date, internal notes.

Related records: purchase orders, invoices, contracts, audit history, certifications.

Design the Supplier record page: which page template, what goes where, and which components. I will build it with clio afterwards, so describe the structure rather than writing code.
