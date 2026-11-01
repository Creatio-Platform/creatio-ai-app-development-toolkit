# rca-env-readonly-query — feature and system-setting reads

Part of `rca-env-readonly-query`: the reads that answer what state a feature is in for a user or an admin
unit, which features and settings are candidates for a symptom, and what a system setting's value is. The
skill's `SKILL.md` holds what applies to every read here: read-only access, when to describe an object
first, and the lookup naming rule (filter through the bare lookup name, never the `Id` alias).

## Feature & system-setting state checks

Use this whenever an investigation needs to confirm whether a **feature** is on/off or a **system
setting** holds a given value — a missing/unexpected UI option, an unexpected default behavior, or a
direct "is X enabled" question, with no compiler/SQL error attached. Verified live via
`creatio_describe_object` and `creatio_list_records`/`creatio_get_record` against a connected
environment (not assumed).

### Features — `AppFeature` (primary read; the only read that covers every provider)

Verified columns: `Name`, `Code`, `State` (Boolean, org-level), `StateForCurrentUser` (Boolean, resolved
for the acting user), `Source`. One filtered read gives the effective answer directly — no manual
hierarchy join needed.

A feature's state can come from any of several providers, and `AppFeature` **aggregates all of them** —
verified live in a single read returning `AbilityToExportPageFromDesigner`
(`Source = Metadata`), `AddSecurityTypeToFilters` (`Source = GlobalAppSettings`) and
`AddUserIdInPageLoadMetrics` (`Source = DbFeatureProvider`), matching the Feature-toggling UI's own
`Source` column. This is the read to use for *any* feature question; the `Feature` object below sees only
the database-backed ones.

- `creatio_list_records` with `{ "objectCode": "AppFeature", "columns": ["Name","Code","State","StateForCurrentUser","Source"], "filters": { "all": [ { "field": "Code", "op": "eq", "value": "<FeatureCode>" } ] } }`.
- **Always select and report `Source`.** It is not decoration — it tells you which layer currently supplies
  the state, and therefore where a human would have to change it. Values seen live: `DbFeatureProvider`
  (a row in the database — togglable per admin unit and diggable per §`Feature` below), `Metadata` (the
  feature's declaration in the deployed configuration), `GlobalAppSettings` (the application's global
  settings), and `web.config` (the file itself). **The set is not closed** — report the value verbatim
  instead of translating it into a place you assume it means. For anything other than `DbFeatureProvider`,
  do **not** assert that flipping it is a click at `{site}/0/flags`: say the state originates outside the
  database, name the `Source` as returned, and have an admin confirm the actual place.
- **Report `State` and `StateForCurrentUser` separately when they differ** — a role/user-level override
  can leave a feature on at the org level but off for the specific user in question (or vice versa); that
  disagreement is itself a finding, not something to collapse into one number. Verified on
  `AllowBpmnImportInProcessLibrary`: `State = false` while `StateForCurrentUser = true`.
- **`StateForCurrentUser` belongs to the account YOU are connected as** — the integration user, not the
  person who reported the incident. It answers "what would I see", never "what does the customer see".
  Quote it with whose state it is attached, and never let it stand as the reported user's state: on a
  "one user sees it, another doesn't" incident, that substitution turns an unverified guess into a stated
  fact. Their effective state is unknown until they name their account or roles — say so, and ask.
- **Empty result does not mean "disabled"** — it means the code isn't tracked in `AppFeature` at all.
  Re-check the exact code spelling first (prefixes matter: `AppsFeatures.` / `PackageFeatures.` /
  `CommonFeatures.` / `Feature-`; a bare name may not resolve — see the domain file's `FS6`), and try a
  `contains` match before concluding the code doesn't exist on this environment.
- A total row count on this object is unreliable — the equivalent `count` flag returns no total for `AppFeature` while working for `Feature` (verified live). Don't build an answer on a count; investigations ask
  about a specific code anyway.

### Discovery probe — finding candidates when no code is known

Which words to probe with is decided by `rca-knowledge-base`'s `references/feature-flags-and-settings.md` §3.1; this is the read
mechanics. Two properties verified live: **`contains` is case-insensitive** (don't spend
probes on casing), and **all terms belong in one `any` filter** — one round-trip, with the state columns
selected in the same read so the shortlist needs no follow-up.

**Features — one read.** `creatio_list_records` on `AppFeature`, columns
`["Code","Description","State","StateForCurrentUser","Source"]`, filter `any` over:
`Description contains '#<areaTag>'`, `Description contains '<keyword>'` (one entry per keyword), and
`Code contains '<keyword>'`. Probe `Code` too — feature codes are self-describing English
(`CanDownloadApp`, `ShowSidebarTemplate`), so on an environment with empty descriptions the code is the
only searchable surface left.

**System settings — one read, and `Name` is the best surface here.** `creatio_list_records` on
`SysSettings`, columns `["Code","Name","Description","ValueTypeName"]`, filter `any` over
`Description contains`, `Name contains`, `Code contains`. **Weigh `Description` first, `Name` second** —
a description says what the setting does and what breaks when its value is wrong; a name only labels it.
`Name` still belongs in the filter: settings carry a human-readable one ("Default form page in the
Freedom UI shell", "Logo in main menu"), so it keeps the probe working on codes whose `Description` is
still empty — verified: `Name contains 'logo'`/`'license'` returned 15 settings, nearly all with no
description. It is the fallback that degrades gracefully, not the primary signal. `SysSettings` holds the
definition, not the value — read the shortlist's values afterwards from `SysSettingsValue`, as "System
settings" below says (a `SecureText` value is never read).

**Keep it bounded** — one probe read per mechanism, at most one retry with different keywords. This is
candidate generation, not a survey.

**A retry only counts before you have an answer.** The one permitted retry exists for a probe that came
back empty or useless. Once a read has produced a shortlist you can act on, you are done with that
mechanism — a further, *broader* read after you already have the candidate is not a retry, it is a
survey, and it costs context you still need for the analysis. If you catch yourself widening the net to
"make sure there isn't something else", that is the moment to stop and report what you found, naming what
you did not judge (see the domain file's §3.1 step 5).

**Always set the row limit explicitly.** The read defaults to **20 rows** when the limit is omitted, so
leaving it out is the same silent cap, just invisible. Ask for 200, which is also the cap. A result sitting
exactly at the limit, or `hasMore` being `true`, means rows were dropped — narrow the keywords rather than paging.

**An empty probe is not proof.** No rows means no description or code matched, not that no feature is
involved: most features on a typical environment have no description at all. Say so rather than
concluding the domain is ruled out.

**Probe terms are always English.** Descriptions and codes are stored in English and `contains` matches
literally, so keywords taken verbatim from a non-English prompt return nothing. Translate to the English
UI vocabulary before probing; reply to the user in their language.

### Features — `Feature` + `AdminUnitFeatureState` (database-backed features only)

The database model behind feature codes. **It is a subset of `AppFeature`, not an alternative index to
it:** `Feature` holds only features with a `DbFeatureProvider` row — verified live, a read of the three codes above returned *only* `AddUserIdInPageLoadMetrics` (412 rows on that environment in
total, none of them the `Metadata` or `GlobalAppSettings` ones). So this is **not** a fallback for a code
missing from `AppFeature`: if `AppFeature` doesn't have it, `Feature` won't either. Use it for the two
things it actually adds — the raw `DefaultState`, and the per-admin-unit breakdown below.

`Feature` — verified columns: `Name`, `Code`, `Description`, `DefaultState` (Integer).
`AdminUnitFeatureState` — **what you send is not what comes back, and this bites.** The names accepted in
`filters` and `columns` are **`Feature`, `SysAdminUnit`, `FeatureState`** — *no* `Id` suffix (full valid
set as the platform reports it: `Feature`, `Id`, `FeatureState`, `CreatedOn`, `CreatedBy`, `ModifiedOn`,
`ModifiedBy`, `SysAdminUnit`, `ProcessListeners`). The **response** then echoes those lookups back *with*
the suffix — `FeatureId`, `SysAdminUnitId`, plus a `lookupTargets` map — so a trace that shows
`"FeatureId": "…"` in the output tells you nothing about what the input accepts. Sending `FeatureId`
fails: `INVALID_FIELD: unknown column 'FeatureId'`. Same drop-the-suffix convention as `SysSettingsValue`
below, so on this platform treat bare names as the default for lookup **inputs**.

> **`creatio_describe_object` with a `columns` argument is an existence check, not a schema dump.** It
> returns only those of the names you passed that actually exist — so asking for three columns and getting
> back one does **not** mean the object has one column, it means two of your three names are wrong. That is
> the fastest way to misread this object. **Omit `columns` entirely to get the real schema**; `compact:
> true` alone does not fix it. Cheaper still: a failed read prints the valid set in its own error message.

- Read `Feature` filtered by `Code eq '<FeatureCode>'` for the org-wide `DefaultState`.
- **Always read `AdminUnitFeatureState` for a `DbFeatureProvider` feature** — filter
  `Feature.Code eq '<FeatureCode>'`, columns `['Feature','SysAdminUnit','FeatureState']` (bare names, per
  the input contract above — `FeatureId` is rejected). This is the table the Feature-toggling UI renders
  beside the flag,
  and **an admin-unit row takes priority over the feature's own state**, so the pair of numbers from
  `AppFeature` is not the whole answer until you know whether any override exists. **An empty result is a
  real finding, not a wasted read**: no override rows means `State` applies to everyone, which is a
  stronger claim than any hedge about who might differ. **You do not need a second read to name the
  role** — verified live, this object returns its lookups already resolved:
  `"SysAdminUnit": {"value": "<guid>", "displayValue": "<role name>"}`. Use `displayValue`; only fall
  back to a `SysAdminUnit` read if it is absent. Cross-check the role against the acting user's roles from
  the current-user read. Verified live end to end on `AllowBpmnImportInProcessLibrary`: one override row, `FeatureState = 1`,
  `SysAdminUnit` = *All employees*, which is in the acting user's roles — that is the full explanation of
  the `State`/`StateForCurrentUser` disagreement above.
- **This dig is available for `DbFeatureProvider` features only.** `AdminUnitFeatureState`'s feature
  reference points at `Feature`, so a `Metadata` or `GlobalAppSettings` feature has no override rows to
  read. Its resolved `StateForCurrentUser` from `AppFeature` is still the answer — you just cannot decompose
  it by role, and should say so rather than implying no override exists.
- If the code is absent from `AppFeature`, say so plainly — it's not a code/environment match, not a
  "disabled" finding. (Absence from `Feature` alone means only that the feature isn't database-backed.)

### System settings — `SysSettings` (definition) + `SysSettingsValue` (values)

A system setting is two objects, read with `creatio_list_records`: `SysSettings` holds the **definition** (one
row per code), `SysSettingsValue` the **values** (one row per user or role that has a value). There is no
separate settings tool among the Creatio data tools; these two reads answer both "does it exist at all" and
"what is it set to". Ask for every code you need in one `in` filter — a list read does not fail as a whole
because one setting is malformed.

**1. The definition** — does the setting exist, and which column holds its value:

```json
{ "objectCode": "SysSettings", "columns": ["Id","Name","Code","ValueTypeName","Description","IsPersonal"], "filters": { "all": [ { "field": "Code", "in": ["<SettingCode1>","<SettingCode2>"] } ] }, "limit": 200 }
```

- **A code with no row does not exist here** — a missing data-binding/package-install gap, and a *different*
  fix (install it) from "it exists but holds the wrong value." Check every code you asked for against the
  rows returned (codes match case-insensitively). Report the two outcomes differently; never let a not-found
  code read as an empty or default value.

**2. The values** — split the codes by the `ValueTypeName` that read 1 returned. **For every code that is not
`SecureText`**, one read:

```json
{ "objectCode": "SysSettingsValue", "columns": ["SysSettings.Code","SysAdminUnit","IsDef","TextValue","IntegerValue","FloatValue","BooleanValue","DateTimeValue","GuidValue","ModifiedOn"], "filters": { "all": [ { "field": "SysSettings.Code", "in": ["<SettingCode1>","<SettingCode2>"] } ] }, "limit": 200 }
```

**For a `SecureText` code, never select `TextValue`**: it holds a password, key or secret, and once read it sits in
the conversation and its logs, quoted or not. Ask only which rows hold a value:

```json
{ "objectCode": "SysSettingsValue", "columns": ["SysSettings.Code","SysAdminUnit","IsDef","ModifiedOn"], "filters": { "all": [ { "field": "SysSettings.Code", "in": ["<SecureCode1>"] }, { "field": "TextValue", "op": "ne", "value": "" } ] }, "limit": 200 }
```

A row there is a value that is set (`ne ""` leaves out both an empty value and `NULL` [observed]); for a user or role with no
row there, nothing is set. If read 1 returned no `ValueTypeName` for a code, treat it as `SecureText`
until you know otherwise.

**Check `hasMore` on every value read.** One read returns at most 200 rows, and a personal setting
(`IsPersonal`) can hold a row for every user who changed it. A `hasMore` of `true`, or exactly 200 rows, means
rows were left out: read again with fewer codes, or with only the setting in question, before you conclude
which rows exist — never report a user's or role's value as absent from a truncated read.

The lookups are `SysSettings` and `SysAdminUnit`, bare, with no `Id` suffix — the "Lookup naming rule" in
this skill's `SKILL.md`. Select `SysSettings.Code`, not only the `SysSettings` lookup: its `displayValue` is
the setting's `Name`, which can be empty.

- **The site-wide value is the row of the role *All employees*** (`SysAdminUnit` =
  `a29a3ba5-4b0d-de11-9a51-005056c00008`, the same Id on every Creatio site), **whatever its `IsDef`**.
  `IsDef` does not mark the default: on a real site about half of the settings carry their site-wide value
  in an *All employees* row with `IsDef = false` [observed: every setting of a site compared with the value
  Creatio's settings service resolves]. Do not pick the `IsDef = true` row instead.
- **A row for any other user or role is an exception for them**, not the site's value: report it with
  whose it is, and say whether that user or role is the one in the incident.
- **The value is in the column of the setting's `ValueTypeName`**; the other columns hold type defaults
  (`0`, `false`, empty), not values:

  | `ValueTypeName` | Column |
  |---|---|
  | `ShortText`, `MediumText`, `Text`, `LongText`, `MaxSizeText` | `TextValue` |
  | `Integer` | `IntegerValue` |
  | `Float` | `FloatValue` |
  | `Boolean` | `BooleanValue` |
  | `DateTime`, `Date`, `Time` | `DateTimeValue` |
  | `Lookup` | `GuidValue` — the Id of a record; its name takes a read of that record |
  | `SecureText` | `TextValue`, encrypted — never read it (the `SecureText` read above) |
  | `Binary`, `Image` | not readable here |

- **A `SecureText` value is never read, and never quoted**: report only whether a value is set (a row of the
  `SecureText` read) and its `ModifiedOn`.
- **A definition with no value row** is a setting that exists and holds nothing: no *All employees* row and
  no other row. Report it as "defined, no value" — not as absent and not as empty.
- `ModifiedOn` dates the value: a value changed shortly before the incident is a lead.

**Defects of the definition itself.** Find every setting with no value type with
`{ "field": "ValueTypeName", "op": "eq", "value": "" }`, and every one missing its name with
`{ "field": "Name", "op": "eq", "value": "" }`: verified live, **the empty-string filter also matches `NULL`**,
so no separate null probe is needed. A row found this way is reported by its **`Code`** — when `Name` is the
empty column it identifies nothing.

**The settings service's 404 says less than it claims.** A log line, an error the user pasted or another
tool may report `404 ItemNotFoundException: System setting with code "…" not found` (or
`Value of system setting with code "…" not found`). The text is not proof that the setting is absent: Creatio
answers it for a setting whose definition **exists** but has no value type, or has no value row at all
[observed]. The two reads above tell the cases apart; never repeat the message as a finding that the setting
does not exist.

- Read-only: never call a write/create/update tool against these entities. Some connections also carry
  tools that write settings or refresh the feature cache — being able to see a tool is not permission to
  call it. If the diagnosis calls for flipping a feature or setting, describe it as a manual step for a
  human (e.g. toggle it at `{site}/0/flags`, or via System Designer → System settings) — never perform it.
