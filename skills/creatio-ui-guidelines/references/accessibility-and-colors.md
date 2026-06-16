# Accessibility and color guidelines

Use this reference when creating or reviewing Creatio Freedom UI pages for WCAG/accessibility.

## Creatio accessibility baseline

- Creatio provides built-in accessibility features for Freedom UI. Since Creatio 8.2.2 Energy, Creatio states compatibility with WCAG 2.0-2.2 AA, Revised Section 508, EN 301 549, and ISO/IEC 40500.
- Accessibility settings are managed in the Accessibility folder in System settings.
- Administrators can configure an accessible desktop color; users can enable it in their profile accessibility settings when configured.


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
