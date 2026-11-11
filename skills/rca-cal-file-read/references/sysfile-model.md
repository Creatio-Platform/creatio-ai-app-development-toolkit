# rca-cal-file-read — the SysFile model, file kinds, and the schema diff

Part of `rca-cal-file-read`. The listing and fetch recipes in `SKILL.md` already use the right columns;
open this file when a `SysFile` column behaves unexpectedly, when you need to tell what kind of file a row
is, when you read a `Data` entry's localization, or for an `Update` × schema entry you want to compare with
its previous version.

## SysFile model (what is on disk vs what you filter on)

Every attachment is a row in `SysFile` — the generic Creatio file entity — filled by
`ConfigurationActivityLogFileStorage`:

| Column | Meaning |
|---|---|
| `Id` (Guid) | Primary key — this is what `get_text_file_content` takes as `fileId`. |
| `RecordId` (Guid) | **FK to `ConfActivityLog.Id` — this is the true join** (a file's `RecordId` equals its log entry's `Id`, scoped by `RecordSchemaName`). Directly filterable and projectable via `creatio_list_records`. Use `RecordId in [<log-Id>…]` for many entries in one call. |
| `RecordSchemaName` (Text) | `"ConfActivityLog"` for our rows. Always filter on this too, to avoid mixing in unrelated attachments. |
| `Name` (Text) | **Bare file name** on the DataService surface (e.g. `metadata.json`, `descriptor.json`, `UsrEntity_5f38702.cs`) — *not* a `Package/Schemas/…` path. Use it to classify the file **kind** (see the classifier). It is **not** a per-entry discriminator: names like `metadata.json` / `descriptor.json` repeat across hundreds of entries, so never use `Name` to decide which entry a file belongs to — that is what `RecordId` is for. |
| `Size` (Integer) | Bytes. Read it here in the listing and apply **How much to read** (`SKILL.md` §Content fetch) before you fetch any content. |
| `Version` (Integer) | Version counter within the record. |
| `SysFileStorage` → lookup `SysFileContentStorage` | Backend: **`Database`** / `S3` / `Azure Blob`. Filter as `SysFileStorage.Name`. The content-fetch tool (`SKILL.md` §Content fetch) is storage-agnostic — it goes through `Entity.GetBytesValue` on the server, which routes to the configured `IFileContentStorage`, so we never need to know or care which backend a row uses. |
| `Data` (Binary) | The raw bytes column. **Do not read it through `creatio_list_records`** — the size overwhelms the response budget and it is populated only for the `Database` backend anyway. Use `get_text_file_content` (`SKILL.md` §Content fetch), which reads through `Entity.GetBytesValue`, works on every storage backend, and returns text with line-oriented filtering. |
| `Type` (Lookup → `FileType`) | All rows for a `ConfActivityLog` share the same value `529BC2F8-0EE0-DF11-971B-001D60E938C6` — **not** a discriminator between file kinds. Do not filter on this. (The column is `Type`; there is no `TypeId` on `SysFile` — live-verified. Not to be confused with `ConfActivityLog.TypeId` used by the schema-diff protocol below, which is a valid auto-navigated path.) |

## Name-based classifier

Once you have the row, decide what kind of file it is from `Name`. Match on the **basename** — on the
current DataService surface `Name` has **no** `Package/Schemas/…` path prefix. One consequence: a
schema `descriptor.json` and a package `descriptor.json` are name-identical, so use the entry's
**Operation × Type** (from the allowlist in `SKILL.md`) to know what the file means, not the name. For
handling, only two rows below actually gate behaviour (skip the backup, narrow the install log);
everything else is text you fetch under the rule in `SKILL.md` §Content fetch.

| Kind | Regex on `Name` (basename) | Fetch by default? |
|---|---|---|
| **Backup archive** | `^backup_\d{8}_\d{6}\.zip$` | ❌ **Never by default.** Only fetch on an explicit user request ("include the backup", "unzip the backup"). Large binary, low signal for RCA. `get_text_file_content` is text-only, so it cannot reconstruct the archive anyway. |
| **Install log** | `^install_\d{8}_\d{6}\.txt$` | ✅ Text. Under 800 KB read it whole; above that read it in portions — installer logs run to tens of MB. See **How much to read** in `SKILL.md` §Content fetch. |
| **Schema artefact** | `^(descriptor\|metadata\|properties\|readable\.metadata)\.json$` or `^<Schema>\.(js\|cs\|less)$` (a `Package/Schemas/<Schema>/…` path prefix may appear on other surfaces — match the basename either way) | ✅ Text. |
| **Package descriptor** | `^descriptor\.json$` (disambiguate from a schema `descriptor.json` by the entry being `… × Package`) | ✅ Text. |
| **Schema data** | `^(data(\..+)?\|filter)\.json$` (e.g. `data.json`, `filter.json`, `data.<culture>.json`) | ✅ Text. |
| **Schema data localization** | `^localization\.json$` — every culture file of a `Data` entry in one, see the next section | ✅ Text, one line: read it under the `localization.json` rule in **How much to read** (`SKILL.md` §Content fetch). |
| **Unknown** | anything else | Report the name and skip; do not guess. |

## Localization of a `Data` entry — `data.<culture>.json` or `localization.json`

A `Create` / `Update` × `Data` entry carries the binding's localization in one of two forms, depending on the
build that wrote it:

- **one `data.<culture>.json` per culture** of the delivered package — each the text of that culture file;
- **one `localization.json`** — a JSON object written on a single line, whose keys are those file names
  (`data.en-US.json`, …) and whose values are the exact text of each file, as a string. Parse a value as JSON
  to read that culture's rows: it is the same text a `data.<culture>.json` of the other form holds.

`[observed]` Listing `SysFile` for a localized `Create` × `Data` entry written in the second form returned
three rows — `descriptor.json`, `data.json`, `localization.json` — and the keys of `localization.json` were
exactly the environment's active cultures (`SysCulture` rows with `Active` true), not every culture the
package carried.

An entry keeps the form it was written in, so one element's history can hold both: compare across them
culture by culture (the schema diff below).

**What a `localization.json` leaves out — so an absence there proves nothing about the package.** It holds
only the cultures active on the environment. Culture files with nothing in them are left out too, and an
entry with no culture left has no `localization.json` at all `[unverified here]`. The application option
`UseInactiveCultures`, which lives in the application's configuration file and is not readable through the
API, makes it keep every culture `[unverified here]`. So a culture missing from `localization.json`, or a
`Data` entry without one, does not show that the delivered package lacked that culture: read `SysCulture`
(`Name`, `Active`) first, and say that the log keeps only the active cultures.

## Schema-diff protocol (client-driven, no server help needed)

For an `Update × <schema-type>` entry, comparing "before vs after" is often the shortest path to the
root cause. `creatio_list_records` on `ConfActivityLog` finds the previous version:

1. Given the current log entry, read its `ElementUId`, `TypeId`, `ModifiedOn`, `Id` (already in the
   `rca-cal-read` output).
2. Read the previous entry:

   ```
   { "objectCode": "ConfActivityLog",
     "columns": ["Id","Number","ModifiedOn","ModifiedBy","Operation"],
     "filters": { "all": [
       { "field": "ElementUId",     "op": "eq", "value": "<current.ElementUId>" },
       { "field": "TypeId",         "op": "eq", "value": "<current.TypeId>" },
       { "field": "Operation.Name", "in": ["Create","Update"] },
       { "field": "Id",             "op": "ne", "value": "<current.Id>" },
       { "field": "ModifiedOn",     "op": "lt", "value": "<current.ModifiedOn>" }
     ] },
     "orderBy": "ModifiedOn desc",
     "limit": 1 }
   ```

   This is the exact SQL that Creatio's server-side `FindPreviousLogEntryId` runs when the UI's
   *Show changed files* button is clicked.
3. If none exists (first version, `Create`) — report the current files as the initial state and
   stop.
4. Otherwise, apply this skill to that previous entry, then compare same-named files inside the
   LLM. Cite verbatim the fragments that changed. **For a `Data` entry, compare the localization culture by
   culture:** first take each `localization.json` apart into the `data.<culture>.json` files its keys name,
   then compare each with the same culture on the other side, whichever form that side was stored in. When
   either side is a `localization.json`, a culture present on one side only is not a change — that file keeps
   only the active cultures (section above) — so report it as not compared, never as added or removed.
   Between two entries in the per-culture form, a `data.<culture>.json` on one side only is a real addition
   or removal.
