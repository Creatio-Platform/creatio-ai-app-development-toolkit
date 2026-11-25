---
name: ui-leave-request-copy
tags: [ui-guidelines, ux-writing]
runs: 3
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

In our HR app in Creatio, employees fill in a Leave request page (leave type, start date, end date, number of days, comment). Business rules reject a request when the end date is before the start date, when it overlaps another request of the same employee, or when it exceeds the remaining leave balance. Actions: send the request for approval, withdraw a request that is still waiting for approval, and cancel leave that was already approved.

Write the exact text for the page: button captions, the three validation messages, and any confirmation dialogs. These strings will go straight into the Freedom UI page.
