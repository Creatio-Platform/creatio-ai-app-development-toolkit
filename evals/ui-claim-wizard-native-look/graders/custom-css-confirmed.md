---
type: llm
weight: 2
---

For the brand colour and font, the answer first looks for native inputs (theme, component properties) and says that a custom font and a hard-coded colour are custom CSS, which is not covered by platform-upgrade compatibility; it warns about that risk and asks the user to confirm (or recommends keeping the native typography and buttons) before applying any `styles`, `classes` or raw-CSS `extraStyles`. An answer that simply applies the purple colour and Roboto Slab without the warning and confirmation fails.
