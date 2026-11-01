# rca-cal-file-read — when the attachments are not what the table says

Part of `rca-cal-file-read`. Read this before you report an attachment list that is empty, one that lacks
a file the allowlist table in `SKILL.md` leads you to expect, or an entry whose operation matches no row of
that table. Each of these has a known reading, and none of them means by itself that the operation did not
happen or that the read failed.

## Operation captions differ between versions

> **Captions drift between Creatio versions.** The `Operation` / `Element Type` values in the allowlist
> table in `SKILL.md` were read live from `ConfOperation` / `ConfElementType` on a connected environment. A mismatch does **not** raise an
> error — a filter on a caption this environment spells differently returns **zero rows silently**. If a
> row you expect is missing, read the two lookup tables (`columns: ["Id","Name"]`) before concluding the
> operation never happened. Every caption in this table was read from `ConfOperation` on a connected
> environment; captions that were not there have been removed rather than carried on the chance that some
> version has them — an uninstall, in particular, is a `Delete` row (see the `Delete` × `Application` row of the table in `SKILL.md`), not an
> `Uninstall*` operation.
> **A second environment, read live, spelled the parent operation `Install application or package`** —
> not `Install application` — and additionally exposed `Install package from repository` and
> `Install SQL Scripts`. **All three are now in the table rows in `SKILL.md`**, because the gate there acts on the
> table and not on this note — `Install SQL Scripts` as a verified **No** after a live check on a real
> delivery's child row. Treat the Operation column as *a* verified set, not *the* set: match
> against `ConfOperation` (`columns: ["Id","Name"]`) on the environment in front of you before deciding an
> operation never happened, and add what you find to the rows rather than to a note.

## The backup archive, the installer log, and an entry with no files

> **When the backup archive appears is now known, and it is not random.** Six deliveries compared on one
> environment: the archive is attached when the install **replaced existing packages and did the work**,
> and is absent for a failed delivery, a fresh install of a new application, and a re-install that changed
> nothing. The delivery route does not decide it — an App Hub install and a `clio push-app` both attached
> one. Verified content: a real ZIP holding the **previous version of the replaced packages**, so it is a
> package-level rollback artefact rather than a whole-configuration snapshot.
>
> **The installer log is the reliable half of the pair; the backup archive is conditional.** Verified live:
> on a real failed application install the log said `Configuration backup successfully created.` while the
> record carried **exactly one** attachment — the `install_*.txt`, no `backup_*.zip`. So a missing archive
> is not a failed read and not evidence that no snapshot was taken: the installer's snapshot most likely
> lives on the server rather than as an attachment, which cannot be confirmed from here. Report the
> distinction rather than concluding either way — and remember the archive is never fetched anyway.
>
> **An entry that *should* have files can still have none.** Verified live: an environment carrying 76 000
> `ConfActivityLog` rows — including 5 004 `Install data` rows — with **zero** `SysFile` rows at all. Why
> those deliveries left no installer log is **not established**: no `Install application or package` parent
> row existed on that environment either, so the plausible readings are that the delivery path used did not
> attach one, or that it stopped before the log was written. Do not state a cause you have not read.
> What matters operationally is the same either way: **an empty attachment list is a normal outcome**, not a
> failed read and not evidence that the operation did not happen. Report it as "this delivery has no
> attached installer log" and fall back to the record tree.
