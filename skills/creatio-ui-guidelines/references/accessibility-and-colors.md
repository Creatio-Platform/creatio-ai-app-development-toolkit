# Accessibility and color guidelines

Use this reference when creating or reviewing Creatio Freedom UI pages for WCAG/accessibility.

## Creatio accessibility baseline

- Creatio provides built-in accessibility features for Freedom UI. Since Creatio 8.2.2 Energy, Creatio states compatibility with WCAG 2.0-2.2 AA, Revised Section 508, EN 301 549, and ISO/IEC 40500.


- **Checked on every page you build, not only in an audit (pass/fail).** Standard and small text has at least 4.5:1 contrast, large text 3:1, custom tabs, areas, charts, backgrounds, images, dialogs and components included. Every component's accessible name (title, `aria-label`, tooltip, alt text) carries a real value, never empty or a placeholder default. Colour supports information and is never its only channel.

## WCAG principles to apply

### Perceivable

- Provide text alternatives for images, icons, audio, video, charts, and non-text content.
- Avoid images of text. If unavoidable, provide the same text in an accessible format.
- Preserve structure when content reflows or is displayed responsively.
- Do not rely only on color, shape, position, sound, or icon shape to convey meaning.
- Ensure contrast between text/icons/chart lines and background.

### Operable

- All interactive functionality must be available through keyboard.
- Give users enough time; provide options to disable or extend time limits when relevant.
- Avoid flashing content. Nothing should flash more than 3 times per second.
- Navigation and page titles must be clear and consistent.

### Understandable

- Use clear, simple language.
- Avoid unexplained jargon, abbreviations, and project-specific codes.
- Ensure pages and dialogs behave predictably.
- Provide labels, instructions, validation, and error messages that help users avoid and correct mistakes.

### Robust

- Prefer native HTML semantics and built-in Creatio components.
- For custom components, update programmatic names, roles, values, and states.
- **Check every component for its accessibility parameters and that they are filled.** For each component on the page, verify it exposes the accessibility properties it should (accessible name / `aria-label`, label/caption, tooltip, alt text, title) AND that those properties are actually populated — not left empty or at their default. An empty accessibility property is as bad as a missing one; do not assume a component is accessible just because the property exists.

## Freedom UI page criteria (WCAG 2.2 AA — no-code guide)

Beyond the principles above, verify these page-design criteria. Each maps to a WCAG Success Criterion (SC).

### Inputs, forms & validation
- **Meaningful element name (SC 4.1.2):** fill each element's `Title` (top of the properties panel) with a meaningful value — even when the title is visually hidden, assistive tech uses it. An icon-only "add contact" button must be "Add contact", not "Button 1".
- **Error identification, suggestion & prevention (SC 3.3.1 / 3.3.3 / 3.3.4):** clearly identify input errors and offer correction hints (label/tooltip). Mark required fields at the point of entry (or via business rules), not at a later step. For critical/irreversible actions, add a confirmation step or Undo (e.g. a "Confirm order" step before submit).
- **Avoid redundant entry (SC 3.3.7):** never ask the user to re-enter data the system already knows — pre-populate connection lookups (e.g. Account on a Contact created from an account), default addresses, and values carried from process steps.

### Element size & appearance
- **Minimum target size ≥ 24×24 px (SC 2.5.8):** some Creatio controls (e.g. "S"-size buttons) are smaller than 24 px — leave gap/spacing around them (container gap ≥ 8 px) so the effective target area is adequate; always space independent buttons apart.
- **Consistent identification (SC 3.2.4):** the same function uses the same icon, label, tooltip, and position across all pages (always "Save", never "Submit"/"Update" for the same action; "Customer Name" labeled the same everywhere).

### Page structure
- **Page title (SC 2.4.2):** keep the `PageTitle` label on every page — it drives the visible title and the browser-tab title, and on record pages auto-fills with the record's primary display value. Edit/move/restyle it, but never delete it.
- **Heading hierarchy (SC 1.3.1):** use Label heading levels H1 → H2 → H3 top-to-bottom; exactly one H1 per page/modal; add lower levels only when the structure genuinely needs them.
- **Bypass blocks / skip links (SC 2.4.1):** the Freedom UI shell already provides bypass mechanisms — keep customizations inside the main content area and do not alter `BaseShell`/`MainShell`, so skip-link behavior is preserved.
- **Consistent navigation (SC 3.2.3):** repeated navigation and controls appear and behave the same across pages; if you build a custom layout, apply the same pattern across related pages.
- **Consistent help (SC 3.2.6):** place inline help in the same region across pages (e.g. help icons always immediately right of the field label).

### Localization, links & status
- **Language of page/parts (SC 3.1.1 / 3.1.2):** translate every element (titles, labels, button text) into all enabled languages; don't mix languages on a page unless intended (mark such inputs "Localizable text").
- **Link purpose in context (SC 2.4.4):** link text must convey its destination on its own or with adjacent text — avoid a bare "Click here"; prefer "View pricing table".
- **Status messages (SC 4.1.3):** surface meaningful status messages where needed (e.g. a success message on the Save action); rely on Creatio's built-in notification/validation mechanisms.

### Screen-level decisions: order, focus, and keyboard

Native components bring their own roles, names, and keyboard behaviour. A conformant component is still not a conformant page: the decisions below are made when you compose the page, and they are where real audits fail. Check each on the rendered page, not in the schema.

- **Reading order and focus order follow the visual order (SC 1.3.2, 2.4.3).** Screen readers and the Tab key follow the order of a container's `items`: in a grid container that order follows `layoutConfig` row, then column; in a flex container it is the order the children were inserted (`index`). A field that sits first visually but was inserted last is read and reached last. Make the order match the order a user fills the page in (how `index` counts is in layout-mechanics.md, *Layout coordinates and container nesting*).
- **Heading levels describe the structure, not the look.** This complements *Heading hierarchy* above: choose a heading's level by its place in the page, never because its size looks right; never skip a level for a smaller look, and never fake a heading with bold body text.
- **Every function works from the keyboard alone, with no trap (SC 2.1.1, 2.1.2).** This covers the buttons you add, inline-editable lists, custom components, and every dialog. Esc closes a dialog or mini page and focus returns to the control that opened it; while a modal is open, focus stays inside it.
- **Focus stays visible (SC 2.4.7).** Native components draw their focus indicator; custom CSS that removes or recolours it fails (custom CSS is a last resort — see *Custom CSS* in layout-mechanics.md).
- **The focused element is never entirely hidden (SC 2.4.11).** Sticky page headers, a stepper's footer with its buttons, pinned list headers, and side panels can cover the element that has focus. Tab down a long page and a long list and confirm the focused element never disappears beneath them.
- **Nothing changes context on focus or on a value change alone (SC 3.2.1, 3.2.2).** A business rule that shows, hides, or fills fields when a value changes is a change of content and is fine. A handler that navigates, opens another page, saves, or starts a process when a field gets focus or a value changes is a violation — put that behind a button.

### Screen-level decisions: hover, drag, zoom, and text spacing

- **Nothing is revealed only on hover.** Tooltips, `i` help icons, row actions, and any hover-revealed content must also appear on keyboard focus, stay while the pointer is over them, and be dismissible without moving focus (SC 1.4.13). Information the user must see every time does not go into a tooltip at all — see the guidance-channel rule in block-fields.md, *Field guidance*.
- **Every drag has a non-drag path (SC 2.5.7).** Wherever the page lets a user drag — reorder items, move a card between stage columns, drop a file, resize a panel — confirm on the rendered page that the same result is reachable without dragging: a button, a menu action, or an editable field (for example the record's stage field or progress bar instead of dragging its card). If a native component offers only the drag path, report it; do not hand-build a replacement.
- **The page works at 200% zoom and reflows (SC 1.4.4, 1.4.10).** At 200%, nothing is clipped, overlapping, or unreachable — with the side panel open and inside every dialog. At 400% (equivalent to a 320 CSS px wide viewport) content reflows into one column without scrolling in two directions; data lists are the allowed exception. Fixed widths or heights set through custom CSS are the usual cause of a failure.
- **Overriding text spacing loses nothing (SC 1.4.12).** With line height at 1.5 times the font size, paragraph spacing at 2 times, letter spacing at 0.12 times, and word spacing at 0.16 times, no caption, button, tooltip, or helper line is clipped or overlaps. Custom-styled labels and long translated captions fail this first.
- **A tight target is never fixed by removing the keyboard path.** Where a pointer target is small (see *Element size & appearance* above), the keyboard route to the same action must be complete.

## Contrast rules

- Minimum contrast ratio for standard and small text: **4.5:1**.
- Minimum contrast ratio for large text: **3:1**.
- Validate custom color pairs with a contrast checker before applying.
- Pay special attention to widgets, tabs, Area backgrounds, chart values, glassmorphism effects, and desktop wallpapers.
- Prefer dark solid desktop backgrounds. Light wallpapers can reduce contrast for overlay text and widget values.
- Avoid glassmorphism when text or chart values become harder to read.

### Non-text contrast, placeholders, and disabled controls

- **Non-text elements need 3:1 against what is next to them (SC 1.4.11):** input and control boundaries, focus indicators, icons that carry meaning, checkbox and toggle states, chart marks and lines, and progress-bar segments. Native components on the default theme are built for this; check every custom colour, every Area background placed behind inputs, and every custom icon.
- **Placeholder text is content.** Where it sits on a non-default background or has been restyled, it must still meet the text minimum above — and it is never the only label of a field.
- **Disabled and read-only content stays legible.** Disabled controls are exempt from the contrast minimums, but a user needs to read a disabled or read-only value to understand why it cannot change; do not grey custom-styled disabled content further than the platform does.
- **A coloured status chip must pass as text.** A pale tint with dark text of the same hue usually passes; a saturated fill with white text usually fails at small sizes. Validate the exact pair, and keep the status in words (see *Freedom UI color guidance*).

## Freedom UI color guidance

- Widget Color parameter in Freedom UI Designer and Dashboard Designer shows WCAG-compliant colors; choosing from it is usually safe.
- Pipeline, Sales pipeline, Full pipeline, Doughnut, and Progress bar widgets use preset accessible color sequences and are not user-configurable.
- Tabs and Area backgrounds require manual validation because text/background combinations can fail contrast.
- **Assign status colors from a consistent semantic scale, and always pair the color with text.** When you color a status, use one meaning-to-color scale across the app: green = on-track / ready / positive / done; amber = paused / waiting / needs attention; red = a problem that needs action — stopped / overdue / failed / at-risk; neutral gray = draft / inactive / not started / closed, and a routine outcome of the process such as *Lost* or *Rejected*, which must not look like a failure (`visual-judgement.md`). The same state uses the same color everywhere, the label states the status in words (color is never the only signal), and every pair meets the contrast minimums above.

## Recommended multi-series chart order

For bars, stacked bars, lines, and stacked areas with multiple series, use this order to maximize distinction between adjacent series:

1. Blue — `#0058EF`
2. Burnt coral — `#BE1B5A`
3. Dark turquoise — `#08857E`
4. Rusty orange — `#F86700`
5. Light blue — `#009DE3`
6. Purple — `#B87CCF`

If combining bars and lines, validate carefully because similar colors can appear near each other and reduce distinction.

## Tab and title colors

For tabs, configure colors in the Appearance block of the Tabs layout element. Styles include “Fully colored,” “Partially colored,” and “Plain white.” Validate all selected/unselected title colors and tab panel colors.

Recommended tab/title colors include:

- Blue `#0058EF`
- Burnt coral `#BE1B5A`
- Dark turquoise `#08857E`
- Steel blue `#1566B9`
- Vivid purple `#9641A9`
- Cadmium red `#E00022`
- Forest green `#0B6A32`
- Violet `#7848EE`
- Navy blue `#4F43C2`
- Dark blue `#0D2E4E`

Do not assume black, gray, red, green, white, or light tones are valid in every tab configuration. Validate the exact foreground/background pair.

## Area backgrounds

- Avoid Area background colors behind text or chart values unless contrast is verified.
- Light and bright colors often reduce readability. Use them only when they satisfy contrast in the actual component context.

## Progress bars

- Progress bar colors are predefined. Darker colors improve stage readability.
- Recommended progress bar colors: gray `#757575`, blue `#0058EF`, green `#0B8500`, red `#B61303`.
- Avoid light progress bar colors because they reduce stage readability.

## Images, icons, and non-text content

- Informative images must have descriptive alternative text.
- Decorative images must have empty alt text, presentation role, or be implemented as decorative CSS background.
- CSS images that convey information must have an accessible label on the containing element.
- Icon buttons must have visible labels, tooltips, or accessible names.
- Charts and complex diagrams need a text alternative or data table when the information is not otherwise available.

## Verifying accessibility on the rendered page

Accessibility is checked while the page is built, not as a closing pass, and it is checked on the rendered page, not in the schema. Run these checks in this order — each catches what the previous one misses:

1. **Accessibility tree and automated checks.** Read the live accessibility tree of the rendered page, and run an automated checker when the environment has one. This catches missing or empty accessible names, wrong roles, and some contrast failures — a minority of real issues: necessary, never sufficient.
2. **Keyboard only.** Without the mouse, complete the page's primary task: create or edit the record and save it, go through every stepper step, open and close each dialog and mini page. Watch the focus order, that focus stays visible and is never hidden under sticky areas, that nothing traps focus, and that Esc closes and returns focus. This finds more real defects than any other single check.
3. **Zoom to 200%, then 400%**, with the side panel open. When the browser cannot zoom, emulate it by narrowing the viewport to half, then a quarter, of the desktop width. Is anything clipped or unreachable?
4. **Greyscale.** View the page without colour, applied in the browser for inspection only, never to the page. Is any meaning lost? This is the check for SC 1.4.1, and it doubles as a hierarchy check.
5. **Screen reader** through the primary task, when one is available. Nothing replaces hearing the page read aloud; an agent usually has none, and then says so.
6. **Text spacing override.** Apply the SC 1.4.12 values from *Screen-level decisions: hover, drag, zoom, and text spacing* in the browser, for inspection only, and look for clipping.

**Say what you verified and what you did not.** "Accessibility tree and keyboard pass clean on create and edit; zoom checked at 200% only; no screen reader available" is a useful finding. "Accessible", with no method named, is not. Put this statement in the audit's *Accessibility notes* section (`../assets/templates/audit.md`; rules in *Audit output template* in `review-checklists.md`).
