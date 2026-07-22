# Branding assets — background templates and favicon

Toolkit-owned knowledge for the `creatio-branding-orchestrator` skill. Everything mechanical
about applying branding — the logo slots, the background upload and apply, licenses, size and
file-security limits — is owned by clio and resolved at runtime from
`get-guidance name="branding"` (with `get-guidance name="sys-settings"` for Binary system-setting
writes). This file holds only what clio does not cover: the background templates shipped with the
toolkit, and the favicon.

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

## Favicon

The browser-tab icon is a separate asset from the in-app logos, and clio's branding guidance does
not cover it. It is driven by two system settings, written with clio's sys-setting tools:

| System setting | Type | Role |
|---|---|---|
| `FaviconImage` | Binary | Holds the favicon file — a small square icon (compact SVG, PNG, or ICO). Write it via `value-file-path`, never inline the bytes. |
| `UseFaviconFromSysSettings` | Boolean | Gate: set to `true`, or the platform ignores `FaviconImage` and keeps the stock Creatio icon. |

Apply order: write the icon into `FaviconImage`, then set `UseFaviconFromSysSettings` to `true`.
Both are environment-wide, like the logos and background. An SVG favicon is sanitized before
upload like any other SVG (see the skill's logo step).

**Relogin required — warn the user up front.** A favicon change does not appear on an open
session: the user must log out of Creatio and log back in, and an already-open tab may keep the
old icon until it is closed and reopened, because browsers cache tab icons aggressively. Always
say this whenever the favicon is changed.
