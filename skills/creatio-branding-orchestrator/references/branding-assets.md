# Branding assets — logos and background

Product constants for the logo and background steps of `creatio-branding-orchestrator`. This
file carries the *what* (setting codes, shapes, constraints); the *how* (exact tool names,
argument shapes, call order) is resolved at runtime from clio MCP — `get-tool-contract`,
`get-guidance name="theming"`, and `get-guidance name="sys-settings"`. Do not treat command
snippets here as an executable contract.

## Logo slots

Four product slots, each backed by a **Binary** system setting. Write a logo into a slot with
clio's sys-setting update passing a local file path (`value-file-path`); never inline the bytes.

| Slot (where the user sees it) | System setting | Surface |
|---|---|---|
| Login page logo | `LogoImage` | White background |
| Main page logo (shell header) | `MenuLogoImage` | White background |
| Configuration section logo | `ConfigurationPageLogoImage` | White background |
| Freedom UI top panel logo | `CrtAppToolbarLogo` | Dark panel — use the white/light variant when available |

Variant routing: the main logo goes to the three white-background slots; the white/light variant
goes to `CrtAppToolbarLogo`. If no white variant exists, the main logo goes there too.

Related settings:

- `HideSplashScreenLogoImage` (Boolean) — set to `true` whenever custom logos are applied, so the
  stock splash logo does not flash during load. Leave untouched when the user skipped logos.
- `CrtAppToolbarLogoUnderlayColor` (Text, default `transparent`) — background color painted under
  the top panel logo. Change it **only when the user explicitly asks**.

## Logo constraints

- SVG with a transparent background is the recommended format; common raster formats (PNG, JPG,
  WebP) also work. The slots render whatever the Binary setting holds.
- Every SVG is sanitized before upload, whatever its source — no `<script>` elements, no `on*`
  event-handler attributes, no references to external resources — because the platform serves
  them from the app's own origin. This applies equally to files the user provides, logos
  extracted from a site, and the recolored background; nothing is uploaded as-is. After
  sanitizing, confirm the file still renders the same image.
- clio refuses files larger than 10 MB.
- Uploads honor the environment's file-security policy (`FileSecurityMode`,
  `FileExtensionsAllowList` / `FileExtensionsDenyList`, `AllowFilesWithUnknownType`). A refused
  extension is a policy decision — relay it and ask for another format; do not bypass it.
- The UI's own image picker additionally caps uploads via the `MaxImageSize` system setting (MB);
  it does not gate the sys-setting path, but stay within it for consistency.

## Favicon

The browser-tab icon is a separate asset from the in-app logos, driven by two system settings:

| System setting | Type | Role |
|---|---|---|
| `FaviconImage` | Binary | Holds the favicon file. Write it with clio's sys-setting update via `value-file-path`, the same way as the logo slots — never inline the bytes. |
| `UseFaviconFromSysSettings` | Boolean | Gate: set to `true`, or the platform ignores `FaviconImage` and keeps the stock Creatio icon. In the UI this is the setting's "Default value" checkbox. |

Apply order: write the icon into `FaviconImage`, then set `UseFaviconFromSysSettings` to `true`. Both
are environment-wide, like the logos and background.

A favicon is a small square icon — a compact SVG, PNG, or ICO. The same limits as the logos apply:
clio's 10 MB cap and the environment's file-security policy decide which extensions are accepted.

**Relogin required — warn the user up front.** A favicon change does not appear on an open session.
Per Creatio's guidance the user must log out of Creatio and log back in for the new icon to take
effect; a plain page refresh is not enough, because browsers cache the tab icon aggressively (an
already-open tab may keep the old icon until it is closed and reopened). Always state this whenever
the favicon is changed.

## Background

The shell background is driven by the `CrtBackgroundConfig` system setting (Text) holding JSON:

```json
{ "imageId": "<SysImage record id>", "mode": "Image" }
```

`mode` is one of `Color`, `Image`, `AccessibleColor`; image branding always uses `Image`. The
image itself is a record in the `SysImage` entity (`Data` holds the file, `MimeType` its type;
an SVG background is `image/svg+xml`). The shell serves it from
`<app-url>/0/img/entity/hash/SysImage/Data/<imageId>` (the `hash` segment is literal). Note:
`CrtBackgroundConfig` may not appear in the sys-settings catalog listing — read and write it by
code directly.

**Uploading the image (validated path).** Sanitize the recolored SVG before upload, the same as
any logo (see Logo constraints) — the background is served from the app's own origin too. The
`Data` column is a binary stream: writing it
through OData JSON (create or update) does not work — the row is created but the stream stays
empty — and DataService blob updates fail server-side. Upload through the platform's image API
instead, on an authenticated browser session (clio's `get-browser-session` provides one; any
logged-in page works):

```
POST <app-url>/0/rest/ImageAPIService/upload?fileapi<timestamp>&totalFileLength=<bytes>&fileId=<new-guid>&mimeType=image%2Fsvg%2Bxml
Headers:
  Content-Range: bytes 0-<bytes>/<bytes>
  Content-Type: image/svg+xml
  Content-Disposition: attachment; filename=<name>.svg
  BPMCSRF: <value of the BPMCSRF cookie>
Body: the raw SVG bytes
```

The service creates the `SysImage` record itself with `Id` = the `fileId` you passed (generate a
fresh GUID). Verify by fetching the serving URL above — it must return the SVG with
`image/svg+xml`.

Appearance setup page (gallery + preview): the gallery lists `SysImage` records tagged as shell
backgrounds. Register the uploaded image by inserting a `SysImageInTag` row (clio's OData
create):

| Column (OData name) | Value |
|---|---|
| `EntityId` | the new `SysImage` record id (the `fileId` above) |
| `TagId` | `273C2402-7CAE-456B-A9C4-067D2024F1A7` (shell background tag) |

Apply order: upload the image (creates `SysImage`) → insert the `SysImageInTag` row → set
`CrtBackgroundConfig` to the JSON above (ordinary text-setting update). The Appearance page then
shows the image in the gallery as the selected item, renders it in the preview, and the shell
uses it after a refresh.

## Background templates and tokens

Five SVG templates live in `backgrounds/` next to this file. `background-1.svg` is the primary
template — always used unless the user asks to regenerate, then take the next unused template;
once all five have been shown, the user picks which one to reuse.

Every color slot inside a template is a placeholder token: `{{<role>-<stop>}}`, for example
`{{primary-300}}`, `{{primary-500}}`, `{{secondary-200}}`. Recoloring is plain text substitution:
take the palette's full stop values from clio's palette tool (full-stops preview) and replace
each token with the matching hex. No token may survive substitution — a leftover `{{...}}` means
the template asked for a stop the palette preview did not provide; fetch the missing stop rather
than guessing a color.
