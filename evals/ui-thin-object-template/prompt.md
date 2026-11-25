---
name: ui-thin-object-template
tags: [ui-guidelines, record-page, template]
runs: 3
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

In our Office app in Creatio there is a Meeting room object with four columns: name, floor, capacity, has projector. Rooms are booked through a Bookings object (room, organizer, start, end, subject).

Design the Meeting room record page in Freedom UI: which page template and what goes where. I'll build it with clio.
