---
name: rca-cal-file-read
description: Read files attached to a Creatio Configuration Activity Log entry (attachments stored in SysFile against RecordSchemaName = "ConfActivityLog"), read-only. Use to list attachments for a log entry, decide by Operation × Element Type whether files are worth fetching at all, and read the content of text artefacts (schema metadata/JSON/JS/CS, package descriptors, installation logs). Listing goes through `creatio_list_records`; content fetch goes through `get_text_file_content` (storage-agnostic across Database / S3 / Azure Blob). Skips backup .zip archives by default. Trigger whenever a Root-Cause Analysis needs the raw files behind a schema Create/Update, a package install, or wants to diff two versions of the same element.
required_tools: [creatio_describe_object, creatio_list_records, creatio_get_record, get_text_file_content]
supported_modes: [Builder, SDK]
---

# rca-cal-file-read — read files attached to a ConfActivityLog entry

> ℹ️ **Two tools, split by concern.**
> - **Listing / metadata** (finding which `SysFile` rows belong to a `ConfActivityLog` entry) —
>   `creatio_list_records`, `creatio_get_record`.
> - **Content fetch** (text bytes of a given `SysFile.Id`) — **`get_text_file_content`**. Storage-agnostic
>   (works for Database, S3, Azure Blob), server-side filtering / paging.

Read-only access to `SysFile` rows that hang off a `ConfActivityLog` record. Complements
`rca-cal-read` (which reads the log entry itself) — this skill lists the attachments, decides
whether they are worth reading based on the entry's `Operation × Type`, and fetches text content
via the purpose-built MCP tool. Never writes.

## Step 0 — trust the model, verify on error

The tables below are the **expected model**, verified against the Creatio server code
(`Creatio.ConfigurationActivityLog` + `Terrasoft.File.*`). Do **not** `creatio_describe_object` on
every run. Only when a query errors on an unknown column, run `creatio_describe_object` on `SysFile`
(and `SysFileContentStorage` for the storage lookup) and adapt.

> **On older builds the files may simply not be there.** Current versions write element artefacts for
> every element, but verified on two stands: one wrote them as expected, while another — an older build —
> held **seven** `ConfActivityLog` attachments in total, none of them a `data*.json`, while still creating
> the same `Create` × `Data` child rows. So an empty `SysFile` result for a "Yes" row below means *this
> stand does not write them*, never that the delivery carried nothing. Support meets old stands; say which
> of the two you established rather than reporting the binding as empty.
>
> **For an installation, the schema files are behind a switch.** Where the feature
> `UseConfActivityLogInstallationSchemaFilesSnapshot` exists, it decides whether a delivery's `Create` /
> `Update` child rows carry their schema files `[observed]`. Builds without that feature keep the files
> unless the system setting `SaveSchemaFilesSnapshot` is set to false `[unverified here]`. When an
> installation's children have no attachments, check the feature (`AppFeature` by `Code`); off → say that
> this environment does not keep the delivered schema files. **If the feature does not exist on the
> environment,** read the setting (`SysSettings` + `SysSettingsValue`, `rca-env-readonly-query`): absent or true → treat the snapshot as on and do
> not mention the feature or the setting to the user; false → it is off, say so as above.
>
> **A schema saved on the environment itself carries its files too.** A `Create` / `Update` row with no
> `Parent` — someone saved the schema on this environment, outside any delivery — held its schema files
> `[observed]`. That is where to read what the environment itself holds when a delivered element
> collides with it or depends on it. Whether the switch above also governs these rows is
> `[unverified here]`.

## When to invoke — the allowlist gate (call **before** listing files)

Files exist on `ConfActivityLog` **only** for the combinations below. For any other
`Operation × Element Type` the log entry attaches nothing — skip this skill and save the
round-trip.

| Operation (`Operation.Name`) | Element Type (`Type.Name`) | Attaches? | File kinds |
|---|---|---|---|
| `Create` / `Update` | `Object`, `Client module`, `Source code`, `Business-process`, `User task`, `Addon`, `Creatio.ai agent`, `Web service`, `Case`, `Marketing campaign` | **Yes** | `descriptor.json`, `metadata.json`, `properties.json`, `readable.metadata.json`, `<Schema>.(js\|cs\|less)` |
| `Create` / `Update` | `Package` | **Yes** | package `descriptor.json` (root, no `Schemas/` prefix) |
| `Create` / `Update` | `Data` | **Yes** | `descriptor.json`, `data.json`, `filter.json` when the binding has a filter, and the localization: one `data.<culture>.json` per culture **or** one `localization.json` holding them — an element's history can hold both (`./references/sysfile-model.md`) |
| `Install application or package` / `Install application` | `Application` (parent row) | **Yes** | `install_<yyyyMMdd_HHmmss>.txt` — present on **every** install record seen; a `backup_<yyyyMMdd_HHmmss>.zip` joins it only when the delivery replaced existing packages (see `./references/when-files-are-missing.md`) |
| `Delete` **with element type `Application`** — this is how an **uninstall** is logged | `Application` (parent row) | **No** | verified live: an uninstall carries **no attachment at all**, so there is no log to read and the record plus its children are all the evidence there is |
| `Install package from repository` | `Package` (parent row) | **Yes** | same install-log + backup pair |
| `Install data` | `Package` / `Application` (parent) | **Indirect** — parent row has none directly; the child `Create`/`Update` `Data` rows carry them (`data.json` = the delivered rows, `descriptor.json` = the binding's `UId`, which the log's error line quotes). Walk `Parent.Id` **and** `Type.Name eq 'Data'`. Listing `SysFile` on the parent returns the installer log alone — the reflex read, and the reason a data-stage payload goes unopened. |
| `Install SQL Scripts` | `SQL Script` (child of a delivery) | **No** — verified live on a real delivery's child row: `SysFile` filtered to it returns zero rows. The script's own text is not attached to the log; the installer log on the delivery's **parent** row is what records that the script ran. |
| `Delete` | any of the 10 schema types above | **No** | — |
| `Compilation` | `Configuration` | **No** — the log entry itself has no files. If it has a non-null `Parent` whose Operation is any of the delivery operations in the rows above (`Install application or package`, `Install package from repository`, any `Install*`), the **parent** row carries the installer's `install_*.txt` — that log often explains why the compilation ran and what state the packages were in. |
| Everything else (`Generate source code`, `Activate`, `Deactivate`, `Include package to application`, `Exclude package from application`, `Unlock for hotfix`, `Lock after hotfix`, `Move element`, `Set as current app package`, `Update database structure`, `Restart`, `Restore configuration`, `Clear IndexedDB cache`, `Generate static content`, `Generation of runtime metadata of entity schema`) | any | **No** | Log-only. |
| any operation | `Localization` | **No SysFile** — the localised values live in a separate entity, **`LocalizationChangeLog`** (verified live). It carries `Key`, `OldValue`, `NewValue` and a `ConfActivityLog` Guid pointing at the *child* `Localization` row, not at the delivery. Read it via `rca-env-readonly-query`. |

> **Captions differ between Creatio versions, and a filter on a caption this environment spells
> differently returns zero rows silently.** Before you decide that an entry matches no row, or that an
> operation never happened, read `./references/when-files-are-missing.md`.

If the entry does not match the table above, **stop here** and say so plainly: "no attachments are
expected for `<Operation> × <Type>`". Do not query `SysFile`.

> **An empty attachment list is a normal outcome** — not a failed read, and not evidence that the
> operation did not happen; a missing backup archive is not evidence that no snapshot was taken. When the
> list is empty or lacks a file the table leads you to expect, read `./references/when-files-are-missing.md`
> before you report it: what each absence does and does not mean is there.

## SysFile model and file kinds — `./references/sysfile-model.md`

What each `SysFile` column means — why `RecordId` is the join, why `Name` and `Type` do not tell entries
apart, why `Data` is never read — and how to tell a file's kind from its name are in
`./references/sysfile-model.md`. The recipes below already use the right columns. Two kinds gate what you
do, and the guardrails restate both: a `backup_<yyyyMMdd_HHmmss>.zip` is never fetched by default, and an
`install_<yyyyMMdd_HHmmss>.txt` is read under **How much to read** in §Content fetch. Open the file when
a column behaves unexpectedly or a row's kind is not obvious from its name.

## Listing attachments for a log entry

`SysFile.RecordId` filters through `creatio_list_records` directly — one call gives the attachments
for one or many entries.

**One entry:**

```
{ "objectCode": "SysFile",
  "columns": ["Id","Name","Size","Version","RecordId","SysFileStorage","CreatedOn"],
  "filters": { "all": [
    { "field": "RecordSchemaName", "op": "eq", "value": "ConfActivityLog" },
    { "field": "RecordId",         "op": "eq", "value": "<entry.Id>" }
  ] },
  "orderBy": "Name asc" }
```

**Many entries in one call** — use `in`:

```
{ "objectCode": "SysFile",
  "columns": ["Id","Name","Size","Version","RecordId","SysFileStorage","CreatedOn"],
  "filters": { "all": [
    { "field": "RecordSchemaName", "op": "eq", "value": "ConfActivityLog" },
    { "field": "RecordId",         "in": ["<entry1.Id>","<entry2.Id>", "…"] }
  ] },
  "orderBy": "Name asc" }
```

**Never** name `Data` in `columns` — it is the raw binary payload and megabytes per row would blow
the response budget (and only the `Database` backend even populates it directly, see
`./references/sysfile-model.md`). Use `get_text_file_content` for content.

`SysFileStorage` comes back as a lookup cell — `{ value: '<guid>', displayValue: 'Database' }`. The
display value tells you the backend without a separate lookup read. `RecordId` appears in `columns`
too so you can bucket rows back to their log entry when reading many entries.

The response is `{ count, rows, recordUrlTemplate, hasMore, nextOffset }` — the default `limit` is
20, cap 200. An install operation may attach more than 200 rows across its child entries; if
`hasMore` is `true`, page with `offset: <nextOffset>` or narrow the read.

## Content fetch — `get_text_file_content`

Once you have a `SysFile.Id` — from the listing recipe above, or handed to you directly — call
**`get_text_file_content`** to read the file. It reads through `Entity.GetBytesValue` on the server side, so it
is **storage-agnostic** (Database / S3 / Azure Blob all work) and returns text content plus a YAML
front-matter metadata block in one round-trip. This is the ONLY way this skill fetches content — do
NOT try to read `SysFile.Data` through `creatio_list_records` for content.

> **A failure comes back as ordinary content, not as an error.** Verified live: a bad `fileId` returns
> `{"content":[{"type":"text","text":"Error: No file with Id … was found in SysFile."}],"isError":false}` —
> `isError` stays **false**. So never decide the call succeeded from the response envelope; read the text.
> A body that starts with `Error:` is a failed read and must be reported as one, not quoted as file content.

**Only for text-shaped rows** (schema artefacts, package descriptors, schema data, install logs).
Refuse for backup archives (see the guardrails). Binary blobs and images are out of scope. The action accepts a closed list of extensions - `.txt .log .json .xml .html .htm .css .scss .md .tex .csv .tsv .sql .cs .py .js .ts .bat .ps1 .yaml .yml .xhtml`, plus `.pdf` and `.docx` via the platform text extractor and `.less` via a plain-text fallback. Anything else returns an error naming the supported list - which is also why a `backup_*.zip` cannot be read even if you ask for it.

**Arguments** (only `fileId` is required):

| Argument | Use it when |
|---|---|
| `fileId` (Guid) | The **`SysFile.Id`** of the attachment. **Not** `RecordId`, not a schema UId, not a user/contact/master-record Id — only the file row's own primary key. |
| `filterLinesWithText` (string) | You want only lines containing a literal substring (case-insensitive), e.g. `"SysModule"`, `"error CS"`, a schema name. Wins over `filterLinesWithRegex` when both are supplied. |
| `filterLinesWithRegex` (string, .NET regex) | Custom case-insensitive regex to select lines. Ignored when `filterLinesWithText` is set. **An invalid pattern is a hard error** - the call returns `Invalid regex in 'filterLinesWithRegex': ...`; it does *not* fall back to a literal match (that fallback was removed because it hid the mistake behind misleading zero-match results). Each line is matched under a **100 ms timeout**: a catastrophically backtracking pattern makes that line count as *no match* and the scan continues, so a pathological regex under-reports rather than failing. |
| `takeLines` (int) | Maximum number of matched lines to return, counted from `skipLines`. Drop to 40-80 for very large logs to keep each response small. Ignored when `tailLines` is supplied. |
| `skipLines` (int) | Zero-based offset within matched lines — page with `takeLines`. Alone (no `takeLines`) it returns the rest of the file from that offset. |
| `tailLines` (int) | Return only the last N matched lines. Wins over `skipLines`/`takeLines`. Good for "what did the installer say at the very end". |

**How much to read — the tool caps nothing, so the only limit is the one you apply.**

With no filter or paging parameter the action returns the **whole file verbatim, at any size**
(`content = fullText` in the source). There is no maximum length, no default truncation.

| `Size` from the listing | How to read it |
|---|---|
| **`localization.json`, any size** | Its own rule, not the two rows below: whole up to **400 KB**; above that not at all, never in portions (see below the table). |
| **<= 800 KB** | Read it **whole, unfiltered**. Do not narrow, do not page. The full picture is worth far more than the tokens saved, and this covers every schema artefact and most install logs. |
| **> 800 KB** | Never in one call — read it in portions, targeted or sequential (both below). |

**Why 800 KB.** One response travels as a single line of a stream capped at ~1 000 000 characters,
and the content is JSON-escaped on the way, so every line break costs 2 extra characters. Wire size
is roughly `Size + 2 x line count`. A 970 KB log of 98 000 short lines becomes ~1.19 M characters
and is refused — and the refusal kills the whole run, not just the call. 800 KB clears the cap even
for a file of very short lines.

**`localization.json` is one line, so it cannot be read in portions** — a filter or paging returns the
whole line or nothing. The quotes and line breaks of the culture files inside it are escaped once more on
the way, so it travels at up to twice its `Size`: read it whole up to **400 KB**. Above that, do not fetch
it; say it was not read and why, and answer the culture question from the environment
(`rca-knowledge-base`'s `./references/installation-catalog-localization.md`).

**Sizing a portion.** You have `Size` from the listing and `matchedLines` from a one-line probe, so
compute it instead of guessing:

    lines per call = 800 000 / (Size / matchedLines + 2)

For a 970 KB / 98 000-line log that is ~65 000 lines per call — the whole file in two calls. For a
log of 300-character lines it is ~2 600. Round down, keep a margin.

**When you need the whole file — read it sequentially in portions.** Walk it with `skipLines` +
`takeLines` at the size above until `hasMore` is `false`. Nothing is lost: you end up with exactly
what an unfiltered read would have given, only in pieces. The cap is per call, never on the total.

**When the question is targeted — search instead, and pick the strategy from the question, not from
the file type.**

| The user wants | Do this |
|---|---|
| why it failed | `filterLinesWithRegex: "error\|fail\|exception\|warning"`, `takeLines: 80`. No hits -> `tailLines: 80`, installers state the outcome at the end. |
| the whole picture | Up to a few MB, just page through it in portions (above). Beyond that, skeleton first: `takeLines: 1` for `matchedLines`, then `tailLines: 60` for the outcome, then the head, then a filter on phase markers (package names, `Install`, `Start`, `Finish`), which *is* the log's table of contents — then zoom into a phase. |
| what happened to X | Filter on X - a package name, a schema, an error code. |

**The front matter tells you your coverage.** It always carries `file` and `hasMore`, and adds
`matchedLines` + `returnedLines` **only when you supplied a filter or paging parameter** - on an
unfiltered read they are omitted because you already have everything. `hasMore: true` means
matched lines exist beyond what came back: page with `skipLines` until it turns false, or narrow
the filter. Any conclusion drawn from a partial read must state its coverage
(`returnedLines` of `matchedLines`).

**Response shape.** YAML front matter (`file`, `hasMore`, plus `matchedLines` / `returnedLines`
when filtered or paged), a blank line, then the content. The header carries **no** size or storage
- take those from the listing row. Cite `file` plus the `fileId` you passed on any conclusion you
draw from the bytes.

## Parent/child recursion for install operations

The delivery operations (see the allowlist table) and `Install data` typically produce a **parent**
`ConfActivityLog` row **plus many children** (each schema change, each data insert). Files are
attached at **both** levels:

- Parent row → `install_*.txt` and `backup_*.zip` (installer's own log + snapshot).
- Each child row → its own schema / data artefacts, as per the allowlist above.

To gather the full picture, list children with `rca-cal-read`'s parent-child pattern —
`creatio_list_records` on `ConfActivityLog` filter `Parent.Id eq <parent-Id>` — then apply this
skill to each child that matches the allowlist. Report the tree, don't collapse it.

## Schema-diff protocol — `./references/sysfile-model.md`

For an `Update × <schema-type>` entry, comparing "before vs after" is often the shortest path to the root
cause. How to find the previous version of the element, and what to compare, are in
`./references/sysfile-model.md`; read it before you diff.

## Guardrails

- **Read-only.** Only `creatio_list_records`, `creatio_get_record`, `creatio_describe_object` for listing, and `get_text_file_content` for content. Never `creatio_create_record` / `creatio_update_record` / `delete` / `execute-process` / `call-configuration-service` — the read-only rules (`rca-safety-and-access`; on the AI Platform, the system prompt) are the authority.
- **Backup never by default.** Match `^backup_\d{8}_\d{6}\.zip$` and skip. Fetch only on an
  explicit user request — and even then, `get_text_file_content` is line-oriented and text-only, so
  it will not reconstruct the archive; treat backup fetches as out of scope for this skill.
- **Size discipline.** Follow **How much to read** in §Content fetch — whole file at or under
  800 KB; above that, portions (sequential paging) or a targeted search, never one call. A
  `localization.json` is the exception: whole up to 400 KB, above that not fetched, never in
  portions. The action enforces nothing itself. Any conclusion drawn from a partial read must state its coverage
  (`returnedLines` of `matchedLines`).
- **Attachment-count cap.** For a single investigation, cap the number of files whose content you
  actually open (list them all, open selectively). A schema Create/Update usually needs 1–3 files
  (`metadata.json` + the source `.js` / `.cs`).
- **Record what you read.** Cite `fileId` (i.e. `SysFile.Id`) and `fileName` for every file whose
  content drives a conclusion. The run's own trace shows which tool calls this skill made.

## Handoff

The files are additional evidence. Feed the relevant excerpts into `rca-root-cause-vs-consequence`
(to separate trigger from cascade) and `rca-diagnosis-report` (to format the final answer with
verbatim citations).
