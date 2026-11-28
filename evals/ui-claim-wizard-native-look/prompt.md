---
name: ui-claim-wizard-native-look
tags: [ui-guidelines, stepper, native-look]
runs: 3
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

We're adding a "Report a warranty claim" page in Creatio (Freedom UI) for our service desk. It's used a few times a month per customer, and the order matters: first the product (serial number, purchase date, product model), then the problem (problem type — about 6 values like Not powering on, Noise, Physical damage; severity — Low, Medium, High; description; photos), then the customer contact (reporter — a Contact, preferred contact time) and a final review step.

Our brand team wants the step titles in our brand purple (#6B2FBF) and in our corporate font Roboto Slab, and the Next button in purple too.

Describe how to build this page — template, components, where everything goes — so I can build it with clio. Don't write code.
