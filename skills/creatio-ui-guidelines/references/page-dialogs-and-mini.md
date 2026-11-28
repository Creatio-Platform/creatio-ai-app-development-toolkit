# Dialogs and mini pages

Use this reference for mini pages, modals and add or edit forms. Where a rule's strength is not obvious, its lead sentence names it: **pass/fail**, **default** or **heuristic** (`SKILL.md`, *When rules collide*).

## Adding and editing data

- Prefer a mini page for creating or editing when the task is focused, role-specific or step-limited.
- Order fields by how users fill them in (*Field layout and order* in `block-fields.md`). Use validation, input and lookup filtering, defaults and auto-substitution; configure the fields copied with a record.
- Do not overload create flows with information needed only later.

### Mini pages

- **A mini page names what it creates and carries the fields that define the record.** Caption it with the object (*New <object>*), not *New record*; put on it the required fields and the few that make the record meaningful at creation.
- **Values filled in for the user are valid**: a suggested number, code or date does not duplicate an existing record or contradict its state. Use the platform's sequence or leave the field to the user.
- **Columns follow the values.** One column by default; two when the fields are short and pair by meaning (a number beside its date); long text takes the full width. Labels: *Label position*.

### Label position

- **Inputs in one group share one label position, and no component is restyled to get it.** Prefer a concrete value (`"above"` or `"left"`). Never change a component's `appearance` (`crt.Input` `legacy` to `outline`) to make a position render: the base look wins. If an explicit position needs that, keep the default appearance; `"auto"` is acceptable on a record page when it renders consistently.
- **Every field on a mini page or a modal sets `labelPosition: "above"` explicitly (pass/fail).** A `left` label column squeezes the input at that width, and the default `auto` switches between `left` and `above` by container width, so a field without the property can render its label beside the input. The one exception is a wide page, size L or XL, where `left` may be set if it reads cleanly; on S and M it is `above`. One position across the dialog. Shipped mini pages write `above` on each field with the default appearance; do not switch to `outline` to make it render.

## Dialogs and modals

- Dialogs follow the styling of Creatio mini pages: predictable title, button placement and hierarchy.
- **A focused set of action parameters is collected in a modal, not a full page.** When an operation needs a few self-contained inputs (closing an opportunity with a loss reason), ask for exactly those: required ones marked, instructions above the inputs, one primary confirm action.
- Labels: *Label position*. Explanatory text comes before the fields and buttons that depend on it.
- Use consistent action labels ("Save", "Cancel", domain result verbs) and Plain style for neutral close and cancel.
- Dialog errors say what the user can do next, without admin-only technical text.

### Text-heavy modals

Lots of copy gets typography, spacing and hierarchy, not a wall of text.

- **The shell comes from the template**: title, close icon, actions row and outer padding are not restyled. Configure only the content area.
- **Typography through the `labelType` preset**, never `labelFontSize` / `labelLineHeight` / `labelStyle`, which fight the preset and break theme switching. A subheading you add: `labelType: "headline-3"` (≈ 18/24). Explanatory copy: `labelType: "body"` (≈ 13/20), muted through the `labelColor` theme token (design reference `#757575`, never hardcoded). Hints: `labelType: "caption"` (≈ 12/16), muted. Weight: `labelThickness`.
- **Spacing through `gap` and `padding` `SizeEnum` keywords** (`none`, `small`, `medium`, `large`), not pixels. A control and its description share a column flex with a small gap (≈ 8px); blocks are separated by `medium` or `large` (≈ 16px). The pixel figures are intent to compare against, not values to write. No paragraph runs into the next block without a gap; everything aligns to one left edge.
- **Long or conditional explanations go into a tooltip beside the control**, with a link to the instruction when there is one; visible copy stays one short line.
- If the content cannot be reduced, a full page may fit better than a modal.

## Traps

- A mini page from "+ Add" keeps the caption *New record* → *Mini pages*.

- A mini page or modal field left at `labelPosition: "auto"` renders its label beside the input → *Label position*.
