# Accessibility and color guidelines

Use this reference when creating or reviewing Creatio Freedom UI pages for WCAG/accessibility.

## Creatio accessibility baseline

- Creatio provides built-in accessibility features for Freedom UI. Since Creatio 8.2.2 Energy, Creatio states compatibility with WCAG 2.0-2.2 AA, Revised Section 508, EN 301 549, and ISO/IEC 40500.


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

## Contrast rules

- Minimum contrast ratio for standard and small text: **4.5:1**.
- Minimum contrast ratio for large text: **3:1**.
- Validate custom color pairs with a contrast checker before applying.
- Pay special attention to widgets, tabs, Area backgrounds, chart values, glassmorphism effects, and desktop wallpapers.
- Prefer dark solid desktop backgrounds. Light wallpapers can reduce contrast for overlay text and widget values.
- Avoid glassmorphism when text or chart values become harder to read.

## Freedom UI color guidance

- Widget Color parameter in Freedom UI Designer and Dashboard Designer shows WCAG-compliant colors; choosing from it is usually safe.
- Pipeline, Sales pipeline, Full pipeline, Doughnut, and Progress bar widgets use preset accessible color sequences and are not user-configurable.
- Tabs and Area backgrounds require manual validation because text/background combinations can fail contrast.
- **Assign status colors from a consistent semantic scale, and always pair the color with text.** When you color a status, use one meaning-to-color scale across the app: green = on-track / ready / positive / done; amber = draft / paused / needs attention; red = stopped / overdue / at-risk / lost; neutral gray = inactive / not started. The same state uses the same color everywhere, the label states the status in words (color is never the only signal), and every pair meets the contrast minimums above.

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
