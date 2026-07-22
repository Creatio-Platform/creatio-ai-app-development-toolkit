# Branding assets

Toolkit-owned knowledge for the `creatio-branding-orchestrator` skill. Everything mechanical
about applying branding — the logo slots, the favicon settings, the background upload and apply,
licenses, size and file-security limits — is owned by clio and resolved at runtime from
`get-guidance name="branding"`. This file holds only what clio does not ship: the background
templates bundled with the toolkit.

## Background templates and tokens

Five SVG templates live in `backgrounds/` next to this file (`background-1.svg` …
`background-5.svg`). Which template to use and when to rotate is decided in the skill's
Background step; this section covers only the recoloring mechanics.

Every color slot inside a template is a placeholder token: `{{<role>-<stop>}}`, for example
`{{primary-300}}`, `{{primary-500}}`, `{{secondary-200}}`. Recoloring is plain text substitution:
take the palette's full stop values from clio's palette tool (full-stops preview) and replace
each token with the matching hex. No token may survive substitution — a leftover `{{...}}` means
the template asked for a stop the palette preview did not provide; fetch the missing stop rather
than guessing a color.
