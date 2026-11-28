# Buttons and actions

Use this reference for buttons, menus and actions: placement, how many in the header, styles, icons. Long-running and destructive actions: `ux-writing.md` §6 and §7. Where a rule's strength is not obvious, its lead sentence names it: **pass/fail**, **default** or **heuristic** (`SKILL.md`, *When rules collide*).

### Button placement

- **Page-level actions** (save, refresh, run a process) go in the header's `ActionButtonsContainer`, top right; how many: *Header actions*.
- **Context-specific actions** (fill a field, run a calculation) go next to the component that shows their result, so cause and effect connect.
- **Actions on the record a profile island represents** (Escalate, Assign to me) go inside that island below its fields, in a `crt.FlexContainer`: one or two there, the rest in a menu.
- **Wrap buttons in a `crt.FlexContainer`, not directly on a grid.** Flex adapts to label length and translation and keeps heights aligned. A button beside an input ("Calculate" beside a value) shares one flex with it.
- **A button is visible and active only when it can be used**, by record state and user rights; state-dependent actions that no longer apply are hidden ("Send for approval" once under approval).

### Header actions

**The header keeps one or two frequent actions as buttons; the rest go into one actions menu (default).** An action used on most visits stays a button; an occasional one goes under one menu button such as *Actions*. Three or more separate header buttons need a reason named in the plan.

### Button styles

- **One Primary button per context**, for the main action or the active dialog action. It may be green instead of the default blue for a step that starts or activates a process; the label still carries the meaning (`Start`, `Activate`), and no other ad hoc button colors appear. Save and Apply stay the default primary.
- At most one **Secondary** button for positive confirmation per context; **Plain** buttons freely for neutral actions.
- **A primary action with close variants is a split button** (Save / Save and new / Save and close); it counts as the single primary.
- **Reports print through the platform's Print button**, whose dropdown follows the reports registered for the object; a hand-built report button drifts out of date. Resolve it via `get-component-info`.

### Icons

- An icon matches the action unambiguously; every icon button has a tooltip and accessible text.
- **A set of related actions or menu items gets distinct, fitting icons** from the Freedom UI library, in one style, so items are told apart at a glance. Quick filters: *Filters and search* in `page-list.md`.

### Button vs menu action vs checkbox

- A visible button for actions used on most visits that change data or start a process; a menu action for rare ones; a checkbox for state data that runs no process.
