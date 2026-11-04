# Installation — data & bindings catalog

Opened **only from `installation.md`**, after the spine has established either a **failing stage**
(§3) or an **outcome and its evidence** (§4) — three of the entries here have no stage by nature, and the
spine routes those by evidence. Do not open this file to look for something recognizable before one of the
two is established: recognizing a signature here is never evidence that it is what failed.

**This file is organised by *mechanism* — not by
the stage a failure surfaced at.** The two are different axes and both matter: the mechanism decides which
catalog owns a case and what fix it gets, the stage decides where in the delivery it showed up. A stage can
point at more than one catalog; the signatures below discriminate.

Which stages lead here, so an agent arriving with one can see itself in this list:

| Stage established | Entries |
|---|---|
| **Data** | §1 (IB1, IB2), §2 (IB3, IB5, IB6), §3 (IB4), §6 (IB11) |
| **Source generation** | §4's IB8 — a column default reading a system setting that does not exist yet |
| **SQL scripts** and **DB structure** | §5 (IB9, IB10) |
| **no stage at all** | IB4, IB5 and IB7 produce no installer-log error — IB7 is a post-delivery symptom and IB5 a refusal on the source. The spine's §5 routes these by **outcome evidence** rather than by stage |

Every entry carries an evidence tier, and **the tiers were assigned
from reads actually run against a live environment**, not from judgement:

- **`[Tier A]`** — confirmable by the platform read named in the entry. Run it, then commit to the
  diagnosis and name what you found.
- **`[Tier B]`** — the read exists but only corroborates, or the mechanic was never reproduced here. Say
  plainly what you confirmed and what you are inferring from the signature.

No entry in this file is Tier C. Culture and localized-resource failures are a **different category** and
live in `installation-catalog-localization.md`, even when they surface at the same stage.

Every fix below is a **manual step for a human**. Nothing here is performed by the agent.

**When a binding fails, the unit of repair on the target is *that binding row*, never the application.**
A failed data install leaves the row marked — `NeedInstall = true`, with the database error in `LastError`
— and that pair is exactly what Configuration shows as the row's error icon and tooltip. The row lives at
**Configuration → Packages → the delivering package → the row whose Type is `Data`**; the grid's *Has
error* filter narrows the list to the failed ones, and its `⋮` menu carries **Install**. **Name it by
`Id`:** the same binding name legitimately exists in several packages — a failing
name can exist in two, one of them clean — so naming it without an `Id` is ambiguous advice.

**Knowing where that row is, is not the same as pressing Install on it.** Whether to install it, delete it
or leave it alone is decided in **step 5** of the unblock below, and the answer is often "leave it":
installing succeeds only once the target itself satisfies the payload, and measured on this catalog's own
fixture it failed a second time with the original database error because it did not.

**Recommending a reinstall of the application, or a re-export of the package, for a one-row conflict is the
wrong granularity** — and it was the default answer on two independent runs. A re-export is needed only
when the **payload itself** is wrong: the binding carries the wrong rows, or lacks a column. Those are
source-side defects and the entries below name them as such; a conflict that lives on the target is not
one, and repeating the whole delivery for it costs every other step of the install to fix a single row.

**Every binding failure has the same shape of quick unblock, and all of it lives on the target.** State it
as the *first* branch of the recommendation, before the durable fix.

1. **Name the object, and check that it is real.** The failing statement names a table; the binding names
   its schema and its columns. Resolve the table to an object code with `creatio_describe_object` and say
   which one it is. A binding pointing at an object that does not exist here is a different incident from
   one whose row is missing — establish which before writing a single step.

2. **Find where a person can edit that object by reading, not by guessing a click path.** Three
   possibilities, each settled by one read:

   | Read | Meaning | What to write |
   |---|---|---|
   | `SysModuleEntity` by `SysEntitySchemaUId`, then `SysModule` by `SysModuleEntityId` | the object has a **section** | name it by its `Caption`; the reader opens it from the main menu |
   | `SysLookup` by `SysEntitySchemaUId` | it is registered as a **lookup** | **System Designer → Lookups**, open it, edit the rows there |
   | neither returns a row | it has **no interface yet** | say so, and give the way in: **System Designer → Lookups → New lookup**, pointed at the object. That adds a configuration record — name the cost |

   **"Fix it in the UI" without naming the path is the complaint this rule exists to answer.** A custom
   object delivered by an application frequently has no section at all, and the reader has no way to guess
   that Lookups is where it lives — still less that the lookup may have to be created first.

3. **Say what the binding was for, then what to enter.** A data binding exists to carry records from one
   environment to another; this one failed, so those records are simply not here, and nothing in the
   interface says so. Give what you actually read — the object, the record, the column, the value the
   payload carried — and where the payload is not readable, say that rather than inventing its content.

4. **Warn about duplication, and be concrete about why.** A record created through the interface receives
   a **new** `Id`; the delivered one keeps its own. So when the source is repaired and re-delivered, the
   real record arrives **beside** the hand-made one. The reader will not be expecting it, because by then
   they consider the problem solved.

5. **Last, the binding's own error icon — and it is cosmetic.** The row keeps `NeedInstall = true` and its
   `LastError` until the delivery is repaired at source.

   **This step belongs to the unblock and to nothing else.** The proper fix needs no equivalent: the
   corrected delivery installs the binding as part of itself, and the error clears with it. **Do not park
   it after the branches as an "after either path" remark** — observed live, and it left the reader unable
   to tell which branch it belonged to while implying the proper fix needs a manual step that it does not.

   Offer the options in this order:

   - **Leave it.** It is accurate, and it is the only local sign that this environment did not receive what
     it was sent. The next delivery overwrites the row regardless.
   - **Delete it here.** The same effect on the data — none — and the next install recreates it from the
     package. It removes evidence and nothing else.
   - **Install it** from its `⋮` menu. It may clear the flag; it may equally fail again with the original
     database error, because the payload still demands what the target still lacks.

   **Never Actualize a delivered binding on the target.** Actualize copies the target's current state
   *into* the binding, so the Install that follows trivially succeeds — and the package now delivers
   whatever this environment happened to hold: the column emptied, a reference to an `Id` that exists only
   here, or nothing at all if the record had been deleted first. The error disappears and the delivery is
   silently redefined. It is a source-side operation; on a package that is locked here the button is not
   even shown.

Say the cost in the same breath: the target now diverges from the source, and the next delivery repeats the
failure until the source is fixed. That is what makes this an unblock rather than a fix.

**The entries below are written mechanism-first; a report is written branch-first. Do not copy an entry's
order into your recommendation.** Each entry explains the source-side fix, its caveats and its alternatives
in whatever order makes the mechanism understandable — that is expository order, not advice order. The
report orders the same material by what the reader needs first: **unblock, then durable fix, then the
technical option**. Re-sort it. An entry that opens with the source-side fix is not telling you to lead
with it, and a caveat that sits mid-entry is not an aside — place it under the branch it constrains, or
after all of them if it constrains more than one.

**A data-binding defect is almost always fixable without touching an identifier.** The levers, and each of
them is a UI action:

- the binding's **rows** — bind the missing one, drop the surplus, run **Actualize data** (all on the
  source; see step 5 above for why not here);
- the binding's **columns** — add one that is not carried, or turn on **Force Update**;
- the binding's **installation type** (§3a);
- the **target's own business data** — correct the row that conflicts;
- **what a row references** — re-point it, rather than reproducing the identifier it points at.

Identifier-level work is needed only when an identity must be **preserved** because something else already
depends on it. Treat that as the exception it is; `rca-diagnosis-report` covers how to present it.

**Say which side each step belongs to.** The error surfaces on the **target**; the durable fix is usually on
the **source**, and the reader's access differs between them — someone who can edit a record on the target
may have no source environment at all. Where the error appeared does not decide where the fix goes.

**A SQL script shipped *in the package* is not a manual database change.** IB8's `BeforePackage` script is a
product mechanism with its own install-time ordering; do not lump it together with "run this statement
against the database".

**These cases also arrive without a delivery, as a validator message.** Several of the mechanisms below
are caught *before* an install, by the platform's own package validator — evidence that is **not readable**
and reaches you only as text the requester pastes. `installation-catalog-data-bindings-reference.md`
§B decodes those messages and grades them.

---

## 1. A referenced record is missing on the target

The largest family, and the most frequent delivery problem there is. The shape is always the same: a data
binding carries a record that points at another record, and that other record is not on the target.

**IB1 — Data install fails on a foreign key: the referenced record does not exist here** `[Tier A]`
- *Signature:* `Error when installing data "…" in package "…"` followed by either
  `The UPDATE statement conflicted with the FOREIGN KEY constraint "FK…". The conflict occurred in
  database …, table "dbo.…"` (MSSQL) or `23503: insert or update on table "…" violates foreign key
  constraint …` (PostgreSQL). The table named in the constraint is most often `SysImage`, `SysModule` or
  `SysWorkplace`, but any lookup can appear.
- *Verify:* the diagnosis is "**that** record is missing **here**", and it is directly confirmable — but
  only if you read the **right table**, and the error names two.

  **Read the referenced (parent) table, never the one being written.** A foreign key fails because the row
  being written points at a parent row that is not here. The child row is *supposed* to be absent — it is
  the one being created. So the whole question is **which table is the parent, and which Id was it looking
  for** — and of the three places you might look, two are unreliable:

  | Where | What it gives | When it fails |
  |---|---|---|
  | the constraint **name** | *sometimes* `FK<Child><Parent>`, which would name the parent — e.g. `FKSysImageSysPackage` is a `SysImage` row pointing at a missing **`SysPackage`** | **often an opaque hash** (`FK` followed by ~26-28 random characters), and **not only on custom objects**: verified live on the platform table `SysModuleInWorkplace`, whose constraint was a hash. Which form you get is a property of the environment, not of the object. **Never plan on the readable form** — treat a name that happens to decompose as a lucky confirmation of what the statement already told you, never as the source |
  | the PostgreSQL `DETAIL` line | `Key (SysPackageId)=(<guid>) is not present in table "SysPackage"` | **redacted by default.** Npgsql prints *"Detail redacted as it may contain sensitive data"* unless the connection string sets `Include Error Detail` — the same suppression IB3 documents |
  | the **failing statement**, printed immediately after the error line | the table, the FK **column**, and the **Id** being written | only when the installer did not print it |

  **The statement is the reliable one.** Verified live on a real delivery where the constraint name was
  hashed *and* `DETAIL` was redacted, and the value was still there. The shape, with the environment's own
  names standing in as placeholders:

  ```
  Error occurred while installing data "<binding>" in package "<package>". UId <uid>: 23503: insert or
  update on table "<ChildObject>" violates foreign key constraint "FK<hash>"
  UPDATE "public"."<ChildObject>"
  SET
      "<Lookup>Id" = '{<Id of the parent record that is missing here>}'
  WHERE
  ```

  Note the shape: the installer sets the lookup value on a row it has already written, so this is an
  **`UPDATE`**, not an `INSERT` — the stack shows `Entity.ExecuteUpdate` / `SaveLookupValues`. The parent Id
  is the value of `"<Lookup>Id"`; the parent **object** is whatever that lookup column points at, and the
  column name does not tell you which — a column called `<Something>Id` may point at an object named
  nothing like it. Resolve it with `creatio_describe_object` on the child.

  > **Filter for the FK column, or read the block whole — never for `INSERT INTO`.** Observed live: a run
  > filtered the log on `INSERT INTO|VALUES|<parent object name>`, matched nothing, and reported the Id as
  > **not established** — while the log carried it three lines below the error. None of those tokens appear
  > in a lookup `UPDATE`. **A narrow filter returning nothing is not evidence of absence.** Widen it, or
  > read around the error; these logs run to tens of KB and reading one whole is cheap.

  Then `creatio_get_record` on the **parent** object with that Id. **An empty result confirms the absence** —
  verified live: a read for a non-existent Id returns `records: []` with no error.

  **When the statement is absent too**, the parent is still reachable without any Id: `creatio_describe_object`
  on the child, take the lookup column(s) pointing at an object the delivery carried, and read that object.
  A parent table with **zero rows** while the child row arrived is the same conclusion one step weaker — you
  have shown the referenced object is empty, not that one specific record is missing. Say which of the two
  you established.

  **Then establish *why* it did not travel, with one more read** — `SysPackageSchemaData` filtered by
  `SysPackage.Name` of the installing package, listing every binding it carries. Whether the parent object
  has a binding at all is the difference between two different fixes, and it is cheap to settle:

  - **no binding for the parent object** — the records were never in the delivery. The fix is to add one.
  - **a binding exists** — then it carries the wrong rows, or a filter excluded this one, and the fix is to
    actualize it rather than create it.

  Without this read the recommendation can only be generic, and the gap invites invention: observed live,
  a run that skipped it advised "check that the parent data installs before the child" — a plausible
  ordering story for a package that had no parent binding at all.

  **Put the shape in the report, not only in your reasoning: name the binding that is missing, or the one
  that carries the wrong rows.** Running the read and leaving its answer out is the commoner failure, and
  it costs more than skipping the read would suggest. Observed live on two runs that issued exactly this
  query, received the full inventory — a single binding, none for the parent object — and then reported
  only "the parent record is missing on the target". That is true, one level shallower than what they were
  holding, and it sends the requester to add a *record* to a package that ships no *binding* for that
  object at all: a fix that changes nothing and fails again identically on the next delivery.

  **Both reads return `records: []`, so the empty result proves nothing on its own.** Verified live on the
  same environment with the same absent Id: `SysPackage` (the parent — the correct read) and `SysImage`
  (the child — the wrong one) answered *identically*. Reading the child therefore manufactures a
  confirmation for a wrong diagnosis, with no signal that anything went wrong. **State which table you
  read and why it is the referenced one**, so the claim can be checked.

  A hit means the record is present and the cause lies elsewhere; say so instead of repeating the
  constraint name. If a table name does not obviously map to an object code, resolve it with
  `creatio_describe_object` first.
- *Recommendation:* name the missing record and its object, then: on the **source** environment bind that
  record to the package, run **Actualize data** on that binding, then re-export the delivery (application
  or package) and install it.

  **The quick unblock, per the header recipe:** the record to create is the **referenced parent** named by
  the failing statement, and the binding to edit is the one carrying the child row — point it at the parent
  you just created, then install that binding.

  **Check `IsForceUpdate` on the lookup column before promising that the reinstall fixes it.** Verified
  live: with `IsForceUpdate = false` — the default, readable on `SysPackageSchemaDataColumn` — the installer
  does **not** overwrite a row that already exists on the target, so the child row keeps its empty lookup
  and the corrected delivery changes nothing.

  **That protection does not hold for a localizable object, and this is the commoner shape.** The installer
  runs one pass per culture, and for a culture whose localization row is absent it stops honouring
  `IsForceUpdate` altogether — every column is rewritten, the lookup included, and the foreign key fails
  again exactly as on the first install. Measured on an object whose localization table held no rows at
  all. So do not promise that an existing row is safe from the reinstall: check whether the object carries
  localizable columns before saying it either way. Either enable Force Update for that column on the source, or
  delete the child row on the target before reinstalling. Say this alongside the fix; without it the next
  attempt looks like a second failure of the same cause.

  **When the referenced record exists nowhere, do not reproduce its `Id` — change what points at it.** Create
  the parent record the ordinary way on the **source** (the interface assigns its own `Id`), then re-point
  the referencing row at it in the binding, run **Actualize data**, re-export the delivery and install.
  Both rows then travel and the foreign key resolves. **No step here needs an `Id` typed in, so none of it
  needs database access** — and this is the path to recommend.

  **Then, last and labelled as the technical option:** reproducing the original `Id` on the target. Offer it
  for the one case that makes it worth choosing — something *else* already depends on that exact value
  (another environment, an integration, a second binding), so changing the reference would break them. The
  interface cannot set an `Id`, so this is a database change: say so, and **write the statement out**. A
  sentence saying an insert is needed is not the statement — nobody can run prose. Give the `INSERT` with
  its table, column list and values; the failing statement in the log supplies all three, so this is
  transcription, not composition. Where a value genuinely is not available here — a display name that
  exists only on the source — put a named placeholder in the script and say what to substitute. The usual cost still applies:
  it diverges the environments unless the binding is fixed on the source too.

**IB2 — A new section does not appear after the delivery** `[Tier A]`
- *Signature:* the same foreign-key text as IB1, on one of the section's own tables — most often
  `SysModuleInWorkplace`, and the failing statement names it even when the constraint's name is a hash
  (which it usually is; see IB1's table). The parent it could not resolve is a `SysWorkplace`, `SysModule`
  or `SysModuleEntity`. The user reports the section missing and the side panel changed, and the install
  itself is often reported as finished.
- *Verify:* a section is not one record — it is a set — but **the error names only one Id**, so be precise
  about what is confirmable:
  1. **Confirm the named record** exactly as IB1 does — and the error names **two** tables, so be clear
     which one you are reading: the **referenced (parent)** object, never the one being written. Take both
     from the failing statement, not from the constraint's name. Here the parent is
     `SysModuleEntity` / `SysModule` / `SysWorkplace`, not the `SysModule*` row the installer was inserting.
     See IB1's table for where each DBMS puts the child, the parent and the key value. Absent = confirmed
     missing — and remember both reads return `records: []`, so the empty result only means something once
     you have named the table you read.
  2. **Reach the rest of the set through what you now hold**, not through Ids the log never gave you. From
     the section's code or name, read `SysModule` / `SysModuleEntity` / `SysModuleInWorkplace` /
     `SysWorkplace` (see `rca-env-readonly-query`, "Section bindings") and report which are present. Name the
     filter column only after `creatio_describe_object` confirms it on this environment.
     **This step needs two things the incident may not supply: a section name or code to start from, and a
     connected environment that is actually the one that failed.** When the incident names no section — the
     package name is not the section's — or when the connected environment holds no trace of the delivery,
     this step is **not executable**, and the honest move is to say so. Do **not** substitute the connected
     environment's section set: reading a healthy stand's 124 sections says nothing about the target's, and
     presenting it as "observed" turns an irrelevant read into apparent evidence.
  3. **Read what the delivery *intended* to carry — that half is not out of reach.** `SysPackageSchemaData`
     filtered by the package lists its **bindings**, and it reads on the target. It answers a question the
     records cannot: whether the delivery shipped a binding for the missing element at all. Verified live —
     a package whose `SysModuleInWorkplace` rows pointed at two absent workplaces turned out to ship **no
     `SysWorkplace` binding**, and that single read turned "some records are missing" into "the delivery
     never carried them". Name the bindings present and the one absent; it is the difference between a
     symptom and a cause.
  4. **Then state the boundary that remains.** A missing *record* cannot be found by following a link to it,
     so the set's **contents** can never be enumerated completely from the target alone — but say that
     about the records, not about the delivery, now that the binding list is readable. Report the record
     the error names as **confirmed**, the binding inventory and whatever else you read as **observed**,
     and the remainder as **not established**. That honest partial picture is the diagnosis. "The section
     bindings are incomplete" on its own is not.
- *Recommendation:* bind the missing records — `SysModule`, `SysModuleEntity`, `SysImage`,
  `SysModuleInWorkplace` and the corresponding `SysWorkplace` — to the package on the source, run
  **Actualize data** on that binding, then re-export the delivery (application or package) and install it.

  **Check the target for orphan rows before promising that the reinstall fixes it, and name them.** The
  installer writes the row first and sets its lookups second (IB1's mechanic), so a lookup that fails
  leaves the row **present with empty lookup columns** — verified live: two `SysModuleInWorkplace` rows sat
  on the target with both `SysWorkplace` and `SysModule` empty. They are easy to miss precisely because
  they exist: a read of the child returns rows, and the section is still in no workplace.

  With `IsForceUpdate = false` on those columns — the default, readable on `SysPackageSchemaDataColumn` —
  the corrected delivery **will not overwrite them**. The reinstall then reports success and the section
  still does not appear, which reads as a second failure of the same cause and sends the investigation
  round again. So say it with the fix: either enable Force Update for the lookup columns on the source, or
  delete the orphan rows on the target first — and give their Ids, because "clean up the leftovers" is not
  an instruction anyone can follow.

## 2. Uniqueness and duplicated bindings

**IB3 — Data install fails on a unique index** `[Tier A]` — when the installer log is available
- *Signature:* `Error occurred while installing data "…" in package "…". UId …: 23505: duplicate key
  value violates unique constraint "…"`, where the constraint is a custom index, or the value being
  inserted already exists in the table. It surfaces at the **data-install** stage, bracketed by
  `Installing data` and the neighbouring `Data "…" from package "…" installed` lines.
- *Verify:* read the target table filtered by the conflicting value from the log — a hit is the record
  standing in the way, and naming it is the diagnosis.

  **This is Tier B for a specific, structural reason: no allowed read exposes database indexes.** Verified
  live — `SysIndex` and `SysEntitySchemaIndex` both answer `INVALID_ENTITY`, and
  `creatio_describe_object` returns an entity's *columns*, never its indexes. An index is part of the
  entity schema's stored definition, which is binary. So a constraint name like `HcoCode_idx` cannot be
  resolved to an object or a column by any read available here: **the mapping is not merely unknown, it is
  unavailable.** Say that plainly instead of implying the read was simply not attempted.

  **But the installer log answers it anyway, and not through `DETAIL`.** Reproduced live:

  ```
  Error occurred while installing data "<binding>" in package "<package>".
  UId <uid>: 23505: duplicate key value violates unique constraint "<index>"

  DETAIL: Detail redacted as it may contain sensitive data. Specify 'Include Error Detail' in the
  connection string to include this information.
  INSERT INTO "public"."<Object>"("Id", "CreatedOn", "CreatedById", "ModifiedOn", "ModifiedById",
      "<Column>", "<OtherColumn>")
      VALUES('{<Id the delivery is inserting>}', …, '<value>', '')
  ```

  **Do not ask for the `DETAIL` line — it is redacted by default.** Npgsql suppresses it unless
  `Include Error Detail` is set in the connection string, so on a stock environment every occurrence reads
  *"Detail redacted as it may contain sensitive data"*. Requesting it wastes a round trip and will usually
  come back empty.

  **The failing `INSERT` is printed in full immediately after the error, and it carries everything the
  index name does not:** the **table** (`"public"."<Object>"`), the **column list**, the **values**,
  and the **Id the delivery was trying to insert**. Read the value for each candidate column out of it and
  match it against the target:

  1. Take the table and the column/value pairs from the statement.
  2. Read that object filtered by the value — verified live: filtering on the column and value taken from
     the statement returned **exactly one row**, carrying a *different* `Id` from the one the statement was
     inserting. **That row is the record standing in the way, and naming it is the diagnosis.**

  Two things the reproduction settled about the index itself. Creatio builds a unique text index as a
  **functional index on `upper(<column>)`**, so uniqueness is **case-insensitive** — `Test 1` and `TEST 1`
  collide, and a search for the exact string can miss the blocker; search case-insensitively. And the
  constraint name in the error (`Index1`) is the name the developer typed in the index editor, which is why
  it maps to nothing readable — but you no longer need it to.

  Only when the log is unavailable does this stay a refusal: say the index name cannot be resolved, ask for
  the `install_*.txt`, and do not guess which column the index covers or split its name into a table.
- *Recommendation:* three paths, in order of preference — (1) find the conflicting record on the target and
  correct or remove its value; (2) for a column with no default, set a temporary default that does not
  occur in the table, install, then remove it; (3) as a last resort, drop the custom index, install, make
  the new record's value unique, and recreate the index. Options 2 and 3 change the target's schema
  temporarily: name that cost when you recommend them.

  **"Install" here means the failed binding, by `Id`, and nothing more** — see the header rule. The
  conflict is a row on the target; the delivery's payload is correct, so there is nothing to re-export and
  no reason to reinstall the application.

**IB5 — The records are already bound in another binding** `[Tier A]`
- *Signature:* saving a new data binding is refused with a duplicate-binding message. The user's own
  binding does not show those records — Creatio checks by record **Id**, not by name, and the other
  binding may live in a different package.
- *Verify:* read `SysPackageSchemaData` filtered by `Name` — verified live: the same binding name returns
  several rows with distinct `UId` and distinct `SysPackage`, and on a real environment that is **routine**,
  with some names appearing in more than a dozen packages. **Rows in *different* packages are this case**;
  rows in the *same* package are IB6. Report the package that already holds the binding — that is what the
  user cannot see from their own.

  **A repeated name is the normal shape, so do not report it as the defect.** The defect is that *these
  records* are already owned by a binding the requester cannot see; the repetition of the name is how a
  configuration of that size is built. The same-package duplicate is the rare shape — a full sweep of a
  reference environment found none — so do not expect to meet IB6 by chance.
- *Recommendation:* do not create a second binding for the same records. Open the existing one, use
  Actualize data, add only the records genuinely missing from it, and enable Force Update for the columns
  whose changed values must travel (see IB4). Consolidate duplicated bindings into one.

**IB6 — One package contains two bindings with the same name** `[Tier A]`
- *Signature:* `Error occurred while installing data "…": An item with the same key has already been
  added`. A second symptom often arrives with it: package dependencies will not save — configuration
  validation fails and the change is silently reverted.
- *Verify:* the same read as IB5 — `SysPackageSchemaData` filtered by `Name`, reporting `UId` and
  `SysPackage` per row. **Two or more rows with the same `Name` inside one `SysPackage` is this case**;
  rows in *different* packages are IB5 and are legitimate, so say which shape you found rather than
  reporting that a name repeats.

  **Then decide which copy to keep, in this order:**

  1. `IsChanged` / `IsLocked` / `NeedInstall` on each row (verified columns). Useful when they differ —
   but do not assume they will: on a reproduced duplicate all three were `false` on every copy.
  2. **Count each copy's column settings** — `SysPackageSchemaDataColumn` filtered by
   `SysPackageSchemaData.Id`, one read per copy. **A binding with zero column rows is anomalous**:
   verified across a whole environment, **1 of 7 239** bindings had none, and that one was the spurious
   copy. A genuine binding carries at least one column row, so the empty copy is the one to remove.
   (Two duplicates created through the product may both carry column rows, in which case this does not
   separate them — then say so rather than choosing.)
  3. The `Data` payload cannot help — it is Binary and unreadable.

  Report which discriminator actually decided it, so the recommendation to delete can be checked.
- *Recommendation:* keep the correct binding — the one whose data is current — and delete or rename the
  conflicting one, recreating the binding if needed. Then run Configuration Validation and retry the
  installation or the dependency change. Deleting a binding is destructive: name which one you mean by
  `Id`, not by name, precisely because the name is ambiguous.

## 3. Binding settings — installation type and columns

The binding's **installation type** decides whether a binding installs here at all, and it is read before
any column setting. It has four values and three of them can skip the install in silence — the table, the
four causes of "the delivery succeeded and nothing changed", and the two log lines that accompany them are
in `installation-catalog-data-bindings-reference.md` §A.

**IB4 — Typed edit pages are not transferred: Force Update is off for the type column** `[Tier A]`
- *Signature:* **no error at all.** The install reports success, and afterwards records open with the wrong
  edit page for their type. The user says the page setup "did not travel".
- *Verify:* the per-column settings of a binding are readable — read `SysPackageSchemaDataColumn` filtered
  by `ColumnName eq 'TypeColumnValue'` and report `IsForceUpdate` for the rows whose `SysPackageSchemaData`
  is the typed-pages binding (verified columns: `SysPackageSchemaData`, `ColumnName`, `IsForceUpdate`,
  `IsKey`, `PackageSchemaColumnUId`). **`IsForceUpdate = false` is the cause**: without it the installer
  leaves the target's existing value in place.
  **Bound the read.** `TypeColumnValue` is not a unique column name: on the reference environment it
  returns **261 rows**, and `IsForceUpdate` is genuinely mixed — **153 `false`, 108 `true`**. Ask for
  `limit: 200` and `includeTotalCount: true`, and page on when a page sits at the cap: a `totalCount`
  larger than the page means **not established** yet. Omitting `limit` returns 20 rows silently, which is
  how the relevant row goes missing. Because the split is roughly even, **never generalise** — "Force
  Update is off for typed pages on this environment" is false for 108 of those rows.

  **Project the binding name and its package in the same read.** Verified live: projecting the bare
  `SysPackageSchemaData` lookup returns `displayValue: ""` on this object, so it cannot name the binding.
  Ask for
  `columns: ['SysPackageSchemaData.Name','SysPackageSchemaData.SysPackage.Name','ColumnName','IsForceUpdate','IsKey']`
  — the **two-hop** path resolves the package in the same call, so one read answers "which value, in which
  package" with no follow-up. Dotted **filters** work on these paths too, and `totalCount` honours them.

  **A binding name does not identify one binding — narrow by package.** The same name legitimately exists
  in several packages (that is IB5's mechanic), and the per-column settings **differ between the
  namesakes**. Verified live: `SysModule_OmniChat` exists twice — in `OmnichannelMessaging` with
  `IsForceUpdate = false`, and in `CrtOmnichannelApp` with `IsForceUpdate = true`. A filter on
  `SysPackageSchemaData.Name eq '<binding>'` alone therefore returns **two rows with opposite answers**, and
  picking either is a coin toss. Resolve the parent first — read `SysPackageSchemaData` by `Name` for each
  `Id` and its `SysPackage` — then report `IsForceUpdate` **per package**. If the incident does not say
  which package the delivery is built from, report both and say the answer depends on that, rather than
  choosing one.
  **`IsForceUpdate = false` is not the only shape, and checking only it reports half a cause.** `[observed]`
  In one delivery the delivering package **contained no `SysModuleEdit` binding at all**, and
  the one typed-page row that existed pointed at an **obsolete section object** — a second `SysModule` row
  with the same code, absent from every workplace. Force Update was indeed off, but turning it on would
  have overwritten nothing, because there was nothing to deliver. So when the type column comes back empty,
  read one level out before concluding:

  - the section set — is there **more than one `SysModule`** with that code, and which one do
    `SysModuleInWorkplace` rows actually point at? (see `rca-env-readonly-query`, "Section bindings");
  - `SysModuleEntity.TypeColumnUId` on the **active** section object — null there is the symptom's direct
    cause;
  - how many `SysModuleEdit` rows exist for that active object — **zero** is a different diagnosis from
    "a row exists but did not update";
  - whether the package that delivers the active section holds a `SysModuleEdit` binding at all.

  Report which of the two it is: **not delivered** (no binding, or bound to a dead object) or **delivered
  and not applied**. The fixes differ — the first needs rows added on the source, the second needs the
  flag. And **"delivered and not applied" is not automatically the flag**: the reference file’s §A lists four causes, three of
  which the flag cannot fix. Read `InstallType` on the binding before you recommend Force Update here.
- *Recommendation:* on the source, in the data binding for the typed-pages setup, enable **Force Update**
  for the `TypeColumnValue` column (Columns setting tab), run **Actualize data** on that binding, then
  re-export the delivery (application or package) and install it. When the read above showed **nothing to deliver**, the flag alone changes nothing: add the
  typed-page rows for the section object the application actually delivers, and enable Force Update on
  `SysModuleEntity.TypeColumnUId` as well, or the type column stays empty on the target.

## 4. A system setting the delivery depends on

**IB7 — A delivered settings row the platform cannot use** `[Tier A]`
- *Signature — there are two, and the mild one is the commoner report.*
  - **The site does not open at all:** `Terrasoft.Common.ArgumentNullOrEmptyException: Value for argument
    "name" must be specified`, with `SysSettingsMetaDataLoader` in the stack. Frequently follows the
    delivery of a setting whose code contains non-Latin characters.
  - **The site serves normally and one setting is unusable:** the delivery reports success, the setting
    appears in System settings, and its card will not save — `Type` is empty and flagged as required.
    `[observed]` There is **no installer-log error**, so the spine's §5 routes this
    by outcome evidence. **Do not reject the case because the site is up** — the row is the same row, and
    the delivery defect behind it is the same defect.
- *Verify:* **start from whichever end the incident gives you.** When the report **names the setting**,
  filter `SysSettings` by `Code` and go straight to reads 3 and 4 — the two scans below exist to *find* an
  unknown offender, and running them anyway costs a round-trip and turns up malformed rows that predate the
  delivery and have nothing to do with it. When all you have is the stack trace, the argument it names is
  `name`, so the empty `Name` is the first candidate — but that ordering is an inference **from the
  exception**, and on an incident that carries no exception it has no premise. Two malformed shapes exist
  and they behave differently:
  1. `SysSettings` filtered by `Name eq ''`. Verified live: **the empty-string filter also matches `NULL`**,
     so no separate null probe is needed. On the reference environment this returns
     `Code = ShowConfigurationVersion` (`Name: null`). **Report the row by its `Code`** — `Name` is the
     empty column, so it cannot identify anything.
  2. The same read on `ValueTypeName eq ''` — the other malformed shape, and a different failure. On the
     reference environment: `Code = EmailTemplateDisplayConditionMaxCount` (`ValueTypeName: null`).
  3. **What the two shapes do to the product** — Creatio's settings service treats them differently
     `[observed]`:
     - a missing **value type** makes it answer
       `404 ItemNotFoundException: System setting with code "…" not found` — even though `SysSettings` shows
       the row. **That contradiction is the diagnosis**: the row exists and the settings service cannot
       resolve it. **The 404 message is factually wrong** — when it appears in a log or a user's paste, do
       not repeat it: reporting "the setting does not exist" inverts the truth, and only read 2 reveals that.
     - a missing **`Name`** resolves *cleanly*: the service returns the value with an empty name. So an
       empty `Name` causes no settings error of its own; it has to be established by read 1.

  **4. Why did it arrive malformed? Two reads on the delivering binding, in this order — and only once you
  know which delivery created the row.** The reads above establish *that* the row is unusable; they say
  nothing about *how* it got that way, and the fix depends on which of two things happened.

  1. **The column set** — was a value for the empty column ever carried? This decides **this** shape, a row
     that arrived *wrong*, and that is why it is first.
  2. **The installation type** (reference file §A) — could a carried value have been applied at all? This decides the
     *other* shape, a delivery that changed **nothing**, and it is where to go when the column set turns
     out to be complete.

  **Doing one instead of the other leaves the answer incomplete either way, and the substitution runs one
  direction.** The type is the cheaper read and answers a question that sounds the same, so it is the one
  that gets done alone — measured live: two runs read `InstallType` on the binding, never read its columns,
  and reported a cause *inferred* from the null row instead of established from the binding.
  `InstallType = Install` does not explain a malformed row; only the column set does.

  **Establish the delivery first, and do not inherit it from the incident report.** The package the
  reporter names is a claim, not a finding: an environment carries many deliveries, and the one they
  remember is often not the one that wrote the row. Compare the row's own `CreatedOn` against the install
  operations (§2.1's search) and take the operation whose children installed a binding for **this**
  object. Verified across runs of this case: the row was written by a *later*, unrelated delivery in every
  run, and the run that skipped this comparison diagnosed the reporter's package instead and graded itself
  "high confidence".

  **A binding carries columns of its own object, and of no other.** So a binding that belongs to some other
  schema says **nothing** about this row — finding no settings columns in an unrelated object's binding is
  not evidence that the settings columns were not delivered, it is evidence that you are reading the wrong
  binding. A diagnosis built on that non-finding is wrong.

  With the delivering operation established, take the binding its install log names — the line has the form
  `Data "<binding>" from package "<package>" installed` — then read that binding's per-column settings
  per `rca-env-readonly-query`'s "Binding column settings — `SysPackageSchemaDataColumn`" section, and ask
  whether the empty column is in that list at all:

  - **Absent — the binding does not carry the column.** `[observed]`: the settings
    binding named in the install log carried every column of the delivered row **except** the value type,
    and the package's own `descriptor.json` declared the same short list. Nothing was ever sent for that
    column, so the target row was created without one.
  - **Present, but the value arrived empty** — either the source row itself holds no value, or
    `IsForceUpdate` is off and the target kept an older empty value (IB4's mechanic).

  **Check whose column set you are holding.** That read's projection names the binding and its package on
  every row (`SysPackageSchemaData.Name`, `SysPackageSchemaData.SysPackage.Name`) — read those two fields
  before quoting the list, and quote it only for the binding the install log named. The same
  projection also returns the columns of **unrelated** bindings from other packages; reported as the
  settings binding's own, they are someone else's evidence, even when the verdict happens to hold.
  **A column set attributed to the wrong binding is worse than an unread one** — an unread one leaves the
  question open, while this one closes it with something no reader can check without redoing the read.

  **Report which of the two it is, because one of the fixes is a trap.** Recommending **Force Update** for
  a column the binding does not carry is useless advice that reads as expert: the flag governs whether a
  delivered value overwrites the target's, and there is no delivered value to overwrite. It is easy
  to reach the right root cause, skip this read, and then recommend exactly that.

  **A column that is in the list but absent from `data.json` may still have been delivered.** Localizable
  columns travel in the payload's `Localization/data.<culture>.json` files, not in `data.json`. Verified
  live on a settings binding: `Name` and `Description` were declared in `descriptor.json`, carried no cell
  in `data.json`, and arrived through `data.en-US.json` — so that row landed with its `Name` filled. Read
  the localization files before
  concluding an empty `Name` was never sent; `installation-catalog-localization.md` owns the
  culture dimension. On the log entry they come either as one `data.<culture>.json` per culture or as one
  `localization.json` that holds them by file name (`rca-cal-file-read`'s `references/sysfile-model.md`).
  That one keeps only the cultures active on the environment, so a culture missing from it does not show
  that the delivered package lacked it.

  **What these reads do and do not establish.** They confirm a malformed settings row. They do **not**
  establish that it brought the site down: on the reference environment both shapes above are present and
  the site serves normally. What ties a malformed row to the outage is `SysSettingsMetaDataLoader` in the
  stack — evidence from the log, not from the platform. With the stack trace, name the row as the cause;
  without it, report the malformed row as **confirmed** and the causal link as **not established**, and ask
  for the trace.
- *Recommendation — two halves; the source half is the one that stops it recurring.*
  - **On the target:** fill `Name` from the `Code` column and set a correct value type on the offending
    settings. While the site is down this is a database-level change — hand it to someone with that
    access. Do not infer the type from how the code is spelled — `Is…` is not proof of `Boolean`; take it
    from what the setting is for in the source configuration.
  - **On the source:** fix what read 4 found — add the missing column on the data binding's Columns tab if
    it is not carried, or fill the source row's value if it is. Then run **Actualize data** on that
    binding and re-export the delivery (application or package), or the next one recreates the same row.

  Two standing rules to pass on: do not use non-Latin characters in system-setting codes, and never
  transfer a setting without a value type.

**IB8 — Source generation fails on a system setting that does not exist yet** `[Tier A]`
- *Signature:* the delivery fails at the source-generation stage with a missing system setting named in the
  message (e.g. `VvtCurrentTelephony`). The cause is ordering: data bindings install **after** code
  generation, and a column default that reads a setting needs it to exist during generation. The same
  failure appears on a clean instance when the setting is created only at the data stage.
- *Verify:* `SysSettings` filtered by `Code eq '<code from the message>'`: no row confirms that the setting
  does not exist. Contrast with IB7: there the row *exists* and is malformed (no value type or no name).
- *Recommendation:* create the setting with a SQL script whose installation type is **BeforePackage**, so
  it runs before schemas are installed, and keep the value binding in the package. The same approach
  applies to any data the code-generation stage depends on.

## 5. Target structure and environment

Two data-binding cases whose failure surfaces later in the delivery — at the SQL-scripts and DB-structure
stages — because the binding or structure work they depend on was never completed. The spine's stage table
routes here from both rows.

**IB9 — A repeated install does not heal a failed structure update** `[Tier A]`
- *Signature:* on the **second** attempt, a SQL script fails with `Invalid column name '…'` (MSSQL) or
  `42703` (PostgreSQL) on a column the object visibly has. The first attempt had failed during the
  DB-structure update: the column was never created in the database, but the object was applied at the
  application level, so the second install sees an unchanged schema version and skips the structure step.
- *Verify:* two reads, and **the second one is only meaningful if the first succeeds** — running them in
  the wrong order, or reading the second wrongly, produces a confident false confirmation.

  1. `creatio_describe_object` on the named object. If the column from the error appears in its
     `columns[]`, the platform believes it exists — that is the symptom's own premise, and only then is
     step 2 informative. If it does **not** appear, the premise fails: this environment's metadata does not
     declare the column at all, which is a *different* situation from a desync, and you must say so rather
     than proceeding.
  2. Only with the column present in metadata: a live read — `creatio_list_records` on that object naming
     the disputed column in `columns` with a small `limit`. **Success** proves the database column is
     really there, so there is no desync. A **database-level** failure is the desync.

  **`INVALID_FIELD` is not evidence of a desync — it is evidence about metadata.** Verified live: asking
  for a column the object does not declare returns
  `INVALID_FIELD: unknown column(s) [UsrTaxNumber] on object 'Contact' Valid options include: …` — the tool
  validates the projection against metadata and **the query never reaches the database**. So that error
  tells you the column is missing from the *schema*, which is the opposite of this case's premise.

  **A real desync answers differently, and the two are cleanly distinguishable.** Reproduced live by
  dropping a column from the table while leaving the schema untouched:

  | Read | Column missing from the **schema** | Column missing from the **database only** |
  |---|---|---|
  | `creatio_describe_object` | column absent | **column present** |
  | project the column | `INVALID_FIELD`, listing valid options | **`BACKEND_ERROR: the read failed on object 'X'`** |
  | project the column, `returnRows: false` | `INVALID_FIELD` | **succeeds** — the count path never projects |
  | read the object **without** that column | succeeds | **succeeds** |

  **So the proof is a pair of reads, and neither half is sufficient.** Read the object *omitting* the
  disputed column — it succeeds, so the object, the filter and your access are all fine — then read it
  *projecting* that column and get `BACKEND_ERROR`. The difference between those two is the desync, and
  nothing else on this stand produces it.

  > **Do not follow the error text.** The unfiltered form arrives dressed as a performance problem:
  > `BACKEND_ERROR: … the read stated no filters; a heavy object can reject a broad scan it answers
  > narrowed. Retry with filters, or probe presence first with returnRows: false`. Verified: retrying with
  > a narrow filter fails **identically**, and `returnRows: false` succeeds for a reason that has nothing
  > to do with weight — it does not project the column. Taking that advice leads to "the object is heavy"
  > or "access is restricted", both wrong, both with an error message that appears to support them.
- *Recommendation:* bring the structure in line manually — run **Update database structure** for the
  object on the target, or add the column — then generate source code for the affected objects and compile.
  Alternatively change the schema on the source so its version increases, and reinstall. Do not simply
  retry the install: the skip is by design and will repeat.

**IB10 — Change Log is enabled for the object being modified** `[Tier B]`
> **Do not use `VwLogObjects` as change-log evidence — it does not track change-log configuration.**
> Established by experiment: Change Log was switched on for four objects (`SysWorkplace`, `SysCulture`,
> `Account`, `Contact`) and the view returned **the same 5 rows as before**. The competing reading is dead
> too: 5 rows against **2 134** entity schemas cannot mean "available for logging". What the view does list
> is unknown. It is a view over `SysSchema` (its `Id` is a `SysSchema.Id`) exposing `Caption` and `UId` but
> **no `Name`**, so a schema code has to be resolved through `SysSchema` — but none of that makes it
> evidence about logging.
>
> **So this case has no confirming platform read, and cannot acquire one.** Whether the object in the
> error has Change Log enabled is **not establishable** by any allowed read. Established by experiment, not
> by omission: logging was switched on for four objects, the application was restarted and a record was
> changed — `VwLogObjects` was unmoved, and both `SysContactLog` and `ContactLog` still answered
> `INVALID_ENTITY` *with logging on and data written*. `SysChangeLog` and `VwLogEntities` do not exist;
> `ChangeLogEntity` is empty. **This case is therefore permanently Tier B**: report the signature, name the
> mechanism, and state plainly that the change-log state could not be read — never imply it was checked, and
> never substitute this view for it.
- *Signature:* `Object is invalid. Extended properties are not permitted on 'dbo.Sys…Log…'` with
  `sp_addextendedproperty` in the stack, or `Execution Timeout Expired` on an `ALTER TABLE [Sys…Log]`. The
  user is certain they never touched that table.
- *Verify:* the mechanism is that the object being modified has Change Log enabled, so every structure
  change is duplicated onto its `Sys*Log` table. What you can and cannot establish about that:

  1. **The log table's name names the logged object** — `dbo.SysContactLog` is `Contact`'s change-log
     table, so the object the delivery is modifying is `Contact`. This is the useful step, and it also
     answers the user: "we never touched that table" is **true and beside the point** — the platform
     touches it, because the delivery modifies the object it logs. Say that rather than treating their
     statement as a mistake.
  2. **Confirm the object itself exists here** — `SysSchema` filtered by that `Name`, projecting
     `SysPackage`. Expect **several rows**, one per package that extends the object (see
     `rca-env-readonly-query`): that is the inheritance chain, not an anomaly. This corroborates *which object
     the delivery touches*; it says nothing about logging.
  3. **Do not probe the `Sys*Log` table.** `SysContactLog` and `ContactLog` answer `INVALID_ENTITY` with
     logging **on** and data written, exactly as with logging off — the probe distinguishes nothing in
     either state.
  4. **Do not offer `VwLogObjects` as corroboration** — see above; it does not track change-log
     configuration.
  5. **Check the dialect** (spine §2.2a): `sp_addextendedproperty` and `ALTER TABLE [..]` are **MSSQL**. If
     the connected environment is PostgreSQL, the incident is on another environment and no local read can
     speak to its state.

  So: name the object, confirm it exists, attribute the mechanism to the signature, and state plainly that
  the change-log state itself **could not be read**. That honest shape is the whole answer this case
  admits.
- *Recommendation:* disable Change Log for that object, reinstall, and re-enable logging afterwards if it is
  needed. When the log table itself is malformed or too large to alter, that is a maintenance-window task
  for support rather than a retry.

---

## Boundaries (this file's coverage)

**Covered:** the cases of the **`Installation — data bindings`**
category — a missing referenced record (§1), uniqueness and duplicated bindings (§2), binding column
settings (§3), system settings the delivery depends on (§4), target structure and environment (§5). The
category is the boundary: a case belongs here because of its mechanism, not because of the stage its error
appeared at.

**Not here:**
- Culture and localized-resource failures — `installation-catalog-localization.md`, including the
  foreign key on `SysCulture`, which looks like §1 but is not.
- Missing packages, missing parent schemas and install order — `installation-catalog-dependencies.md`.
- Locking, local edits, name/UId clashes and environment drift — `installation-catalog-conflicts.md`.
- Anything before the data stage in the delivery, and the restore decision — the spine owns both.

**Evidence status of IB3, IB9 and IB10** — each is reproduced or settled on a live environment, and its entry
states what was found:

- **IB3** — reproduced. Tier A **when the installer log is available**: the failing `INSERT` is printed in
  full and supplies the table, column and value. The `DETAIL` line is redacted by default, so do not ask
  for it. Without the log it stays a refusal.
- **IB9** — reproduced. Tier A: a column present in metadata and missing from the database answers
  `BACKEND_ERROR` on projection while the same object read *without* that column succeeds; that pair is
  the proof. `INVALID_FIELD` means the opposite — the column is absent from the schema.
- **IB10** — settled **negatively**: an object's change-log state is **not establishable by any allowed
  read**, so the case is permanently Tier B and `VwLogObjects` must not be offered as evidence.

## 6. The delivered data itself is invalid

Every other family here is about a disagreement between the delivery and the **target**. This one is not:
the target is fine, and the package carries a value the platform cannot read. It is told apart by *where*
the failure happens — in the parser, before anything is written.

**IB11 — Data install fails while parsing the binding's own file** `[Tier A]`
- *Signature:* at the data stage, `Error occurred while installing data "<binding>" in package
  "<package>". UId <uid>:` followed by a **parse** error rather than a database one — e.g.
  `Guid should contain 32 digits with 4 dashes` — with the stack running through
  `Terrasoft.Common.JsonDataReader` (`GetGuidValue` and its neighbours). No `23503`, no `23505`, no SQL
  statement printed: the installer never reached the database for this row.
- *Verify:* **the exception names the artefact, so read it — nothing on the target will explain this one.**
  The failure is in reading the delivered file, so the row was never inserted and there is no record here
  to inspect, no constraint to resolve, no parent to check. Follow the spine's §2.4a to the child
  `Create`/`Update` × `Data` row and open its `data.json`; `descriptor.json` beside it matches the file to
  the failing `UId` from the log.

  In the file, find the cell whose `Value` does not fit its column's type — for a GUID column, anything
  that is not 8-4-4-4-12 hexadecimal. Check the `SchemaColumnUId` of each cell as well as the `Value`:
  both are GUIDs in that file, and a malformed one in either place fails the same parse.

  **Report the cell, not the category.** Verified live, and this is the entire cost of skipping the read: a
  run that had the stack and the stage right concluded *"one of the GUID columns holds a value that is not
  a GUID — fix the binding data on the source"*. Every word true, and the reader is left with the search.
  The file holds a handful of cells; naming the offending one, its column and its `DisplayValue` is one
  read away and turns the recommendation into an instruction.

  **Do not read the absence of target state as a second problem.** The row is missing here *because* the
  parse failed — that is the same fact, not a further one. Check the binding's `LastError` and
  `NeedInstall` on `SysPackageSchemaData` to confirm the platform agrees, and stop there.
- *Recommendation:* name the binding, the column and the offending value, then on the **source** correct
  that value, run **Actualize data** on that binding, then re-export the delivery (application or package)
  and install it. Nothing needs changing on the target:
  it never received the row. If other bindings in the same delivery failed for other reasons, say so
  separately — a parse failure and a target-state failure in one install are two incidents, and rolling
  them into one recommendation fixes neither.

