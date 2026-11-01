# Installation — localization catalog

Opened **only from `installation.md`**, after the failing stage has been established — the **data**
stage for IL1, and the **data** or **source-generation** stage for IL2 and IL3. Do not open it before the
spine has produced a stage.

The **`Installation — localization`** cases. As everywhere in
this domain, the catalog boundary is the **mechanism**, not the stage a failure
surfaced at.

Localization is kept separate from `installation-catalog-data-bindings.md` for a practical reason as well:
IL1 looks exactly like a plain missing-record foreign key, and IL2 and IL3 produce **no error text at the
data stage at all** — treating either as a binding case sends the investigation to the wrong read.

Evidence tiers, assigned from reads actually run against a live environment:

- **`[Tier A]`** — confirmable by the platform read named in the entry.
- **`[Tier B]`** — the read corroborates but does not settle the causal claim; say which half you have.
  (No entry in this file is Tier B today.)

Every fix below is a **manual step for a human**.

---

**IL1 — Data bound to a culture the target does not have** `[Tier A]`
- *Signature:* `Error occurred while installing data "SysProfileData_…": 23503 … violates foreign key
  constraint … table "SysCulture"`. Typical when a Marketplace application is installed on a commercial
  site that carries a reduced culture set — trials ship every culture, so the vendor never sees it.
- *Verify:* **the error gives you an `Id`, not a culture name** — so read by the `Id` first and get the
  name from elsewhere. Two reads, and they answer different questions:
  1. `creatio_get_record` on `SysCulture` with the Id from the failing statement — the PostgreSQL `DETAIL`
     line (`Key (SysCultureId)=(<guid>) is not present in table "SysCulture"`) or the MSSQL statement's
     `*Id` value. This is the **referenced (parent)** side, as in the bindings catalog's IB1. **An empty
     result confirms the absence** — verified live: `records: []`, no error.
  2. The whole culture set — `SysCulture` with `Name`, `Active` and `Default`. It is a tiny table (**2 rows**
     on the reference environment: `en-US` with `Default: true`, and `ru-RU` `Active: true`,
     `Default: false`), so read it entire rather than guessing at a filter. This is what tells the user what
     their environment *does* have, and exactly one row is `Default`.

  **An absent row carries no name, so the target cannot tell you which culture is missing.** The Id resolves
  to nothing; the name comes from the source package, the failing binding's name, or the reporter. Do not
  infer a culture name from a GUID.

  A culture that is **present but inactive** is a different situation from a missing one, and the fix
  differs — `Active` in read 2 separates them. A **hit** in read 1 means the record is present and the cause
  lies elsewhere: say so instead of repeating the constraint name.
  > This is the case that looks like a plain missing-record foreign key. The discriminator is the table in
  > the constraint: `SysCulture` lands here, any other lookup is
  > `installation-catalog-data-bindings.md` §1.
- *Recommendation:* name the culture and the fact that this environment does not have it. Then either
  install a data binding carrying the missing `SysCulture` record before the application, or remove the
  bindings for cultures absent on the target from the package and reinstall. Both are source-side changes
  followed by a re-export; note that adding a culture to a production environment is a decision with
  consequences beyond this delivery.

**IL2 — The delivery removed localized resources for a culture the package does not carry** `[Tier A]`
- *Signature:* **no error.** After the install, part of the interface shows in another culture, or captions
  and field labels are simply gone — most visibly for a culture the target uses and the delivered package
  does not.
- *Verify:* localized resources are readable per schema and per culture. Read `SysLocalizableValue`
  filtered on `SysSchema.Name` and `SysCulture.Name`, with `includeTotalCount` (verified live:
  `SysSchema.Name eq 'LeadPageV2'` + `SysCulture.Name eq 'ru-RU'` returned 691 rows; verified columns are
  `Key`, `Value`, `SysSchema`, `SysCulture`, `SysPackage`, `ResourceType`, `IsChanged`). Compare the same
  schema across the target's **active** cultures (IL1's read gives you that list): a schema with resources
  for one active culture and **none** for another is the confirmation that the resources are absent now.
  > **Filter by the schema *code*, not its caption** — `SysSchema.Name eq 'LeadPageV2'` matches, while the
  > row comes back displaying `Lead edit page`. Filtering on what the UI shows returns nothing, silently.
  >
  **Then look for the change itself — but not by the delivery's own Id.** `LocalizationChangeLog` records
  individual localized values changing during a logged operation, and its `ConfActivityLog` column points
  at a **child** record, never at the delivery. Verified live: a delivery that changed localized values
  wrote its rows against child rows of `Operation = Update`, element type **`Localization`**, named
  `<Package>_Localization_<culture>` — e.g. `<Package>_Localization_ru-RU`, whose `Parent` is the
  install record. **Filtering by the delivery's Id returns zero rows**, which reads exactly like "nothing
  was removed".

  So it is two steps:

  1. Read the delivery's children filtered to `Type.Name = 'Localization'`, projecting `Id` and `Element`.
  2. Read `LocalizationChangeLog` filtered `{ field: 'ConfActivityLog', in: [<those child Ids>] }` with
     `columns: ['Key','OldValue','NewValue']`, `limit: 200`, `includeTotalCount: true`, paging on
     `hasMore`.

  **The culture comes from step 1, not from step 2** — `LocalizationChangeLog` has **no culture column**
  (verified: `Key`, `OldValue`, `NewValue`, `ConfActivityLog` and audit, nothing else). The child record's
  `Element` name carries it, which is why step 1 projects it.

  > **Verified shapes** (reproduced live by a delivery that added one localized value and removed two):
  > a **removal** is `OldValue` filled with `NewValue` **`''`**, and an **addition** is `OldValue` **`''`**
  > with `NewValue` filled. Both are **empty strings, not `NULL`** — filter with `eq ''`, which also
  > matches null, and never with a null test alone. A removal row **is** the delivery removing that value:
  > evidence, not inference.
  >
  > Two cautions. A row's presence does not imply a *delivery* — the same rows appear for ordinary
  > designer edits, whose parent is an object `Update` rather than an install. And **do not conclude "no
  > removal was logged" from a single unpaged page**: one delivery can change hundreds of values and the
  > default page is 20 rows.

  **Let the *shape* of the gap drive the explanation — zero is not "a few missing".** Quantify both
  cultures and read the ratio, because two very different situations look alike in a sentence:

  | Shape | What it means | What it cannot be |
  |---|---|---|
  | a handful of keys missing in one culture (e.g. 169 of 177) | new elements arrived carrying only the source culture — normal drift | a removal |
  | **zero** against a substantial set | the culture's resource set for that schema is **absent as a whole** | explained by newly-added captions |

  Verified live: on an environment holding 78 971 `ru-RU` rows, with a comparable page carrying 143, one
  schema stood at **0 against 809 `en-US` rows** — and, deduplicated, 0 against **141 keys**. A total
  absence beside a full set in the other culture is an anomaly in its own right and outranks any "new
  captions arrived in English" story, which can only ever account for the small-gap shape. If both shapes
  are present in one incident, report them separately — they have different causes and different fixes.

  **Say whether your numbers are rows or keys.** They differ by a lot here, because a key is stored once
  per package extending the schema — see IL3's step 2. A gap quoted in rows overstates the translation gap
  whenever the two cultures are carried by a different number of packages.

  When the change log has nothing for that delivery, you still have the absence read above: the resources
  are gone now, and the person reporting it knows they were there before. That is a complete, actionable
  diagnosis — so do not hedge it into uselessness. Keep the sources distinct when citing them: what you
  read, and what the user observed. And note the asymmetry of the evidence: **a deleted row leaves no
  trace**, so an empty change log is consistent with a removal and cannot argue against one.
- *Recommendation:* the package must carry resources for every culture the target uses. Add the missing
  localized values to the schema resources on the source and reinstall. The standing recommendation worth
  passing on: develop under the English culture and fill the other cultures deliberately, rather than
  letting them be whatever the last delivery left behind.

**IL3 — Source generation fails on a localized resource missing for one culture** `[Tier A]`
- *Signature:* `System.Collections.Generic.KeyNotFoundException: <guid>` with
  `Terrasoft.Core.Process.ProcessSchemaConditionalFlow.GetButtonCode` in the stack, or
  `Error actualizing schema …`. It is almost always a business process whose auto-generated page buttons
  have no value in one culture — most often `en-US`. The process works on the source environment, which is
  what makes the report confusing.
- *Verify:* the same entity as IL2, narrowed to the schema from the error, but this is a **key-set
  comparison** and it has to be complete to mean anything:
  1. Resolve the schema first when the error carries only a GUID — read `SysSchema` by that `UId` to get its
     `Name`, and filter on the code, never the caption.
  2. Read `SysLocalizableValue` per culture with `columns: ['Key']`, `limit: 200`,
     `includeTotalCount: true`, and **page on `hasMore` / `nextOffset` until the set is complete**. One
     schema/culture pair reached 691 rows on the reference environment against a 200-row cap, and omitting
     `limit` returns 20 — so an unpaged read names an arbitrary key as "missing".
     **A row count is not a key count — deduplicate before comparing.** The same `Key` is stored once *per
     package that extends the schema*, so it repeats heavily: verified live, `LeadPageV2` × `en-US` is
     **809 rows but only 141 distinct keys**, some keys appearing 11 times, and `ru-RU` is **691 rows /
     127 keys**. `(Key, SysPackageId)` is the unique pair, `ResourceType` does not separate them, and the
     read tool has no DISTINCT — so you must page the rows and reduce to a key set yourself. Comparing raw
     row counts across cultures measures package coverage, not translation coverage, and 809-vs-691 looks
     like 118 missing translations when the real answer is **14**.
  3. Restrict the fan-out to the culture named in the incident plus the target's **default** culture (IL1's
     read gives you both), rather than every active culture.
  4. **State the coverage**, the way the spine requires for a partial log read: how many keys you compared
     per culture, and whether the sets were read to completion. A truncated comparison is **not** a
     confirmed missing key — report it as not established instead.

  **The culture missing keys the others have is the answer**, and the missing `Key` names the element.
- *Recommendation:* add the missing values for the culture that lacks them — usually the auto-generated page
  buttons of the process — save the process on the source, and re-export the package. Same standing
  recommendation as IL2: develop under the English culture.

---

## Boundaries (this file's coverage)

**Covered:** three cases — a culture absent on the target (IL1), localized resources missing after a
delivery (IL2), and source generation failing on a resource missing for one culture (IL3).

**Not here:**
- Any other missing-record foreign key at the data stage — `installation-catalog-data-bindings.md` §1. The
  discriminator is whether the constraint names `SysCulture`.
- Localization problems **outside** a delivery — translation workflow, culture setup, `SysTranslation` — not
  covered by any domain yet.

**The data-binding side of localization, as far as it was checked.** Three neighbouring entities were
described live; their verified columns are in `rca-env-readonly-query`:
- **`LocalizationChangeLog`** — populated and useful, now part of IL2's verify step above.
- **`SysDataLocalizableValue`** — localized values of *bound data* (per record, per column, per culture).
  Columns confirmed, but **empty on the reference environment**, so its behaviour is unverified. Reach for
  it when a case is about a bound record's caption rather than a schema's resources.
- **`SysPackageDataLcz`** — binding-level, and its payload is `Binary`, so only *presence* of localized
  data for a culture is readable.

`SysDataLocalizableValueChecksum` was not described. Describe anything unlisted before filtering on it —
never guess a column name.
