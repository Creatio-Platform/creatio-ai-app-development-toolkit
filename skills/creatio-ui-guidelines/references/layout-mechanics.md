# Layout mechanics

Use this reference before every `update-page`: how a component is chosen, how it is placed on the grid, which container settings it takes, and how it keeps the native look. Most rules here are checked by a tool or a measurement. Where a rule's strength is not obvious, its lead sentence names it: **pass/fail**, **default** or **heuristic** (`SKILL.md`, *When rules collide*).

## Choosing the component (source of truth)

This reference names components by UX concept: profile island, field group, detail list, lookup, metric widget. Concrete `crt.*` names drift between versions, and a wrong or renamed type fails to render, so resolve every concept with `get-component-info` against the target environment, never from memory (pass/fail: the type exists in the target catalog).

- **Browse**: list mode returns every type with a description; detail mode adds `whenToUse` / `whenNotToUse` / `synonyms` / `useCases` to choose between similar components.
- **Find** by concept: `search='tab' | 'lookup' | 'chart' | 'profile' | 'list'`.
- **Scope** to the target version with `environment-name`. When the version cannot be resolved (`requiresVersionConfirmation`), tell the user and confirm before building.

**A pre-built combination is a composite: build every part its recipe names (pass/fail).** Designer-listed combinations (Expanded list, Attachments, Next steps, Communication options, Approval list) assemble several components; Approvals, for one, is a module above the profile island plus the approval list. Get the recipe with `get-component-info composite='<caption>'` and build each part. Never hand-build a composite from raw types or insert only the part you recognize. When a plan lists a composite's parts, each part is its own deliverable.

**Record the recipe of every `compositeOnly` type you insert.** When `get-component-info` reports a type as `compositeOnly`, write in your worklog or evidence, not only in your reasoning, the `composite='<caption>'` recipe you fetched and every part it named, so a reviewer can compare the build with the recipe and catch a partial composite.

## Native look

### Match existing styles

- **Match what is already there: this page, or a shipped page on the same template when this one is new (default).** Read the current page (`get-page`) and reuse its conventions for every new element: the ExpansionPanel style (spacing, padding, `borderRadius`, header and collapsed state), input `labelPosition`, container spacing, padding and radius, widget sizes, column count. A differently styled component next to existing ones is a defect.
- **When the page is new or empty**, `get-page` a shipped Freedom page on the same template that has expansion panels and profile islands and copy its conventions, so an added container carries the platform's spacing, padding, `borderRadius` and color, not a bare default.
- **Compare the rendered page with a native page on the same template before calling it done**: `visual-check.md`.

### Native appearance

- **Custom additions do not stand out from the base product (default).** Keep the default component appearance, typography, colors, spacing and borders. A customization that makes the page look different from base Creatio, even "nicer", is a defect. Deviate only for a business priority, as a deliberate, scoped and confirmed decision.
- **Do not restyle components to fix a small nuance or satisfy another rule.** Switching every `crt.Input` to `appearance: "outline"`, or changing fonts, borders or colors across a form to work around one issue, makes the whole form deviate. Fix only the specific field when truly needed.

### Custom CSS

**Custom CSS is a last resort: native inputs first, then warn and confirm (pass/fail).** A visual requirement (color, background, font, text size, spacing, border, size, alignment) is custom CSS once expressed as a `styles` object, a `classes` CSS class, or an `extraStyles` hook (`extraStyles.toggle`, `extraStyles.label`) carrying raw values such as `color`, `fill` or `font-family`; the three count equally, and `extraStyles` is not native because it is a component input. A changed font-family or a hard-coded color is never a native default, since both come from theme tokens. Custom CSS is outside Creatio's upgrade-compatibility guarantees and can break on a future upgrade. The order:

1. Exhaust the component's native inputs (`get-component-info`). If one achieves the look, use it and do not mention CSS.
2. Otherwise tell the user no native option exists, warn about the upgrade risk, and get explicit confirmation before writing `styles`, `classes` or `extraStyles`.
3. If the user declines, apply none: offer the nearest native alternative or say the look is not achievable natively.

"Just apply, don't ask" waives the question, not the one-line upgrade-risk warning.

## Containers

### Containers for grouping inputs

- **Input groups go in a `crt.ExpansionPanel` or a profile island.** An ExpansionPanel is a titled, collapsible field group (it also wraps a list to form a detail); a profile island (`SideAreaProfileContainer`) holds key stable data. Inside either, lay fields out with a `crt.GridContainer` or `crt.FlexContainer` (*Flex vs Grid*). Prefer a panel over a bare grid when a group needs a title or should collapse.
- **Expansion panels stack vertically at full width (pass/fail).** A panel spans the full width of its tab or container, one under another with a gap; never two in one row or in a two-column grid. Two columns apply to the fields inside a panel.

### Flex vs Grid

**Choose by whether the content changes at runtime (default).** A `crt.GridContainer` pins items to fixed `row` / `column` coordinates, so a hidden field or a collapsing panel leaves its slot empty. A `crt.FlexContainer` has no fixed slots; siblings close the gap.

- A group with a field that a business rule can hide or show goes in a flex.
- Collapsible panels, and whatever follows them, stack in a flex.
- Buttons go in a flex because they resize to their label (*Button placement* in `block-actions.md`).
- A grid is for static layouts whose visible items do not change at runtime.

### New island / card container — standard settings

A new island (a `crt.GridContainer` or card-style group) takes these settings, not the Designer defaults. They are the expected native values; when a shipped page on the same template measures otherwise, the measurement wins (*When rules collide* in `SKILL.md`; how to measure: `visual-check.md`).

- **Column spacing:** Large
- **Row spacing:** None
- **Border radius:** Medium
- **Spacing (padding):** Top = Medium, Bottom = Medium, Left = Large, Right = Large
- **Color:** White (the card background)

Resolve the property keys and enums with `get-component-info crt.GridContainer`. "Column spacing" and "Row spacing" are the `gap.columnGap` / `gap.rowGap` object (there are no `columnSpacing` / `rowSpacing` properties); the card look is `color`, `borderRadius` and the per-side `padding` object.

**Plain grid for inputs (not an island).** A bare `crt.GridContainer` that only lays out inputs inside an island, panel or tab has no card chrome:

- **Column spacing:** Large
- **Row spacing:** None
- **Border radius:** None
- **Spacing (padding):** None on all sides
- **Color:** Transparent (the parent shows through)

**Spacing fits the content.** Inputs: no row spacing, column spacing kept so the columns do not touch. Widgets, charts and metrics: proportional row and column spacing, consistent with each other and with the widgets' size, never zero. On the rendered page, gaps between siblings look even.

## Placement

### Layout coordinates and container nesting (avoiding gaps)

- **Read the container's column count `N` before placing fields (pass/fail).** It is a property of each container (`columns` / `columnsCount`). Full width is `colSpan: N` at `column: 1`; a two-column row is `column: 1` and `column: N/2 + 1`, each `colSpan: N/2`. Do not hardcode `12`, `6` or `7`.
- **Why a gap appears:** `layoutConfig` is relative to the immediate parent container, and rows/columns restart at `1` in each nested container; in a container that already has children (a template container) those children keep the rows they declare, and a new child takes the row its place in the layout needs — a free row between them (row 2 between template children at rows 1 and 3) or the next row after them. A field at `row: 3` while `row: 2` is empty reserves a blank row → vertical gap; a `column`/`colSpan` beyond the container's column count wraps to a new row and leaves a blank half.
- **Rows are numbered per container**, never with global numbers reused across groups.
- **Let containers size to content:** `rows: "auto"` with `gap`; no fixed `rows` count or oversized `rowSpan`. One titled group is one container; stack groups with `gap`, not empty rows.
- **An insert's `index` counts the parent's existing children, the template's included:** read them from the parent's node in the `get-page` bundle (`bundle.viewConfig`; `childCount` in `bundle.containers` gives the count). Example: on `PageWithAreaFreedomTemplate`, `CardContentWrapper` already holds the template's `TopAreaProfileContainer` at `row: 1`, so an island inserted into it at `row: 2` gets `index: 1` — `index: 0` would put it ahead of the profile container in `items`. In a grid container the order in `items` follows `layoutConfig` row, then column; the grid still renders by `layoutConfig`, so a wrong `index` does not show on the page, but the Designer and every later insert that relies on the order see the mismatch. The diff mechanics themselves (`operation`, `parentName`, `propertyName`) are owned by clio's `page-modification-components` guide.
- **Several inserts into one parent in one diff:** each insert's `index` is its position, by `layoutConfig` row then column, among the template's children and the other inserts of the diff that land before it in that order — not necessarily the end of `items`. Example: template children at rows 1 and 3 and a new element at row 2 give it `index: 1`, not 2.
- **Sanity-check before saving (pass/fail):** in each container, `row` runs 1..N with no skips, every `column` / `colSpan` is within the column count, every field's `parentName` is its real group container, and `items` order matches row, then column.

### Component alignment

**A component among fields aligns with them on both axes (pass/fail, measured).** A timer, badge, button or read-only value in a field group takes a field's anatomy: caption in the label column, value in the value column. Its left edge lines up with the field values (or with the labels, when its caption sits in the label column), never starting under a label. It takes a whole grid row, its text on the same line as the fields' text in that row; a component shorter than a field row does not ride up against the field above or leave a gap below. Measure on the rendered page: text top and left edge within 2px of the neighbouring fields.
