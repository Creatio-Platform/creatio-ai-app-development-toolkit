# 02 — The queue file and the built file

Two JSON files in the migration folder carry the whole run — plus `verify.json`, the engine's machine
verdict, one short-lived `preflight-<n>.json` per ⚠ Confirm agent, and `resolutions.json`, the one file
here that a HUMAN writes. Everything else is derivable.

`resolutions.json` holds the operator's answers to this plan's ⚠ Confirm questions:
`{ "resolutions": [ { "kind": "list-columns", "item": "…", "answer": "…", "decidedBy": "…", "date": "…" } ] }`.
Keyed on `kind` + `item` (the published `id` also works; its `pageKey` half moves between runs). It is read by
the ENGINE — `--units --resolutions` publishes each answer on the queue item that asked it — never parsed by an
agent. Absent means nobody has answered yet, which is the normal first run. **It closes no `--verify` row:** an
answer is an input to the build, and the evidence record is still filed and still judged.
They exist because a run is interrupted routinely — a usage limit, a session end, a new
agent picking the work up in the same folder tomorrow. Nothing about "where we are" may live
only in an agent's context.

Neither file is the source of truth about the STAND. The queue holds the ORDER and the
history; the stand holds the FACT. Before any unit is taken into work its state is re-read
from the stand through `--verify`, and a unit that is already closed is skipped. That is why
there is no "resume" command: there is one command, and it does the next undone thing.

## `build-queue.json` — order, rounds, park state, approval

```json
{
  "schemaVersion": 1,
  "manifest": "/tmp/mig-Applicant/manifest.json",
  "builtFile": "migrations/applicant/built.json",
  "planVersion": "plan-4f9c2ab17e03",
  "approval": {
    "found": true, "version": "plan-4f9c2ab17e03", "date": "2026-08-07",
    "who": "Alex Kravchuk", "recordedIn": "decisions.md"
  },
  "buildOrder": ["child:VisaRequest", "child:Education", "mini:ApplicantMiniPage", "main"],
  "units": {
    "child:VisaRequest": { "rounds": 2, "parked": false, "schemaName": "UsrVisaRequestPage",
                           "lastNote": "ApprovalList added; style diff pending" },
    "child:Education":   { "rounds": 3, "parked": true,  "schemaName": "UsrEducationPage",
                           "parkedWhy": "still short after 3 round(s) — the engine's open rows: Communication options (`crt.CommunicationOptions`) — ❌ MISSING — component type absent from the built page" },
    "mini:ApplicantMiniPage": { "rounds": 1, "parked": false, "schemaName": "UsrApplicantMiniPage" },
    "main":              { "rounds": 0, "parked": false, "schemaName": "UsrApplicantFormPage" }
  },
  "nonPageUnits": {
    "sectionRegistered": { "rounds": 1, "parked": false },
    "miniPageWired":     { "rounds": 0, "parked": false }
  },
  "proposals": [
    { "unit": "main", "deviation": "merge two profile islands into one",
      "why": "second island holds a single field", "applied": false }
  ],
  "blocked": [
    { "unit": "child:Education", "what": "the Communication options block",
      "why": "crt.CommunicationOptions is not registered on this stand" }
  ],
  "discrepancies": [
    { "round": 2, "unit": "main", "claim": "crt.ApprovalList added",
      "found": "get-page shows no crt.ApprovalList" }
  ],
  "history": [
    { "round": 1, "units": ["child:VisaRequest", "child:Education", "mini:ApplicantMiniPage"], "at": "2026-08-07T11:04Z" }
  ]
}
```

Rules that make it trustworthy:

- **Every key under `units` comes from `--units.pages[].key`, and EVERY key in `buildOrder` gets one.**
  Never construct a page key by hand — `child:<Entity>@<Via>` and the `#n` disambiguators exist because two
  distinct physical pages would otherwise collide, and an invented key matches no row. A key in `buildOrder`
  with no `units` entry is a unit with no round counter, no park state and no recorded schema: the run
  re-dispatches it forever and can never verify it. That is the drift `staleQueueKeys` / `newKeys` exist to
  report, so the entry is created — with `rounds: 0` — the moment the key appears.
- **`planVersion` is the engine's, copied from `--units.planVersion`.** It is the same string `--plan` printed
  into the plan file under `**Plan version:**`, and the same string the `approval` entry must name. Nothing
  here composes a version.
- **`units[<key>].schemaName` is the FREEDOM schema that key resolves to, and this file is its only
  home.** `--units.pages[].schema` is the CLASSIC source schema and is `null` for `main` and for an
  unfolded child, so a key on its own names no page to fetch. The builder reports it, the reconcile
  step writes it here, and the verifier reads it from here — including for a page built in an
  earlier session, which is what makes resume work at all. A key with **no** `schemaName` is an
  explicit **"cannot verify, unknown schema"**: nothing is fetched for it, nothing is written for
  it, the unit stays open and the state is reported. It is never guessed and never silently skipped.
- **`parkedWhy` is written with `parked: true`, never after it.** The reason is composed where the
  park is decided, out of that unit's own open rows, and a park is how the run asks the user a
  question — a park with no reason is a question nobody can answer. A resumed run reads these back
  before it schedules anything: a park is terminal, so re-dispatching a parked unit spends a full
  stand-writing round on work the previous session already gave up on.
- **`proposals`, `blocked`, `discrepancies` and the learned `schemaName`s are written at the CLOSE of each
  round, before the next round dispatches** — the same rule `rounds` follows, and for the same reason. They
  are the run's answer to the caller; a usage limit, or a reconcile step that returns nothing, must not take
  them with it. They are written again when the run exits, so a park or a proposal decided after the last
  round is on disk too.
- **`rounds` is incremented BEFORE the round runs, not after.** A process killed mid-build must
  not come back with the counter reset — that is how a unit loops forever. Over-counting a round
  that never happened is the safe direction: it parks earlier, never later.
- **`parked: true` is terminal for this run.** It is not a failure to hide; the run returns every
  parked unit to the caller with `parkedWhy`, and the caller asks the user.
- **`proposals[].applied` is always `false` when the executor writes it.** A plan deviation is a
  proposal to the user. The executor never flips it.
- `nonPageUnits` keys are the reachability keys from `--units.reachability[]` whose
  `appliesWhen` is `true`. A key with `appliesWhen: false` is not an obligation of this run and
  gets no entry.

## `built.json` — the payload `--verify` reads

Exactly the `--built` shape the CLI accepts. It ACCUMULATES across rounds: evidence and judge
verdicts filed in round 1 are still there in round 3, which is what lets a repair round re-verify
without redoing settled work.

```json
{
  "pages": {
    "main": { "viewConfig": { "...": "clio get-page bundle.viewConfig, VERBATIM" },
              "packageName": "CustomHrApp", "viewModelConfig", "parentSchemaName": "PageWithTabsFreedomTemplate" },
    "child:Education": false
  },
  "reachability": { "sectionRegistered": true, "miniPageWired": false },
  "evidence": { "main#quality-gates": { "referencePage": "AccountPage", "components": ["crt.ExpansionPanel"] } },
  "judge":    { "main#quality-gates": { "convincing": true, "why": "prop-level diff, 3 components" } }
}
```

**`viewConfig` is `bundle.viewConfig` from `get-page`, copied verbatim — the MERGED page.** Not
`ownBodySummary`, not the page's own body. An element the TEMPLATE provides is touched with
`operation: "merge"` and carries no `type`, so a check fed the own body reads ❌ MISSING on a
correctly built page for Feed, FileList, ApprovalList, ContactCommunication and the DCM bar.

**The mini page has its own entry, like every other page.** Its key is `mini:<Schema>` (published
by `--units`), and the `Mini page` row is closed by that entry — present with components ⇒ built,
`false` ⇒ MISSING, omitted ⇒ not checked. There is no boolean to write instead: a payload with a
`pages` map is never read for `miniPageBuilt`, so the only way to close that row is to `get-page`
the mini page and file what came back.

The CLI rejects a malformed payload at **exit 1**, naming what is wrong:

- not a JSON object;
- no `pages` object (the old flat single-page shape is gone);
- any page entry that is neither `false` nor an object carrying `viewConfig`.

That guard is what makes the gate real. It is not possible to hand-author a `pages` entry that
passes — you would have to write a plausible merged view tree, and the counts are then computed
from what you wrote, which the verifier's own get-page transcript contradicts.

## `verify.json` — the verdict anything arithmetical reads

`--verify` also takes `--verify-json <file>`. Run it as
`--verify --built built.json --out verify.md --verify-json verify.json`: `verify.md` is the human
report, `verify.json` is the verdict.

```json
{
  "complete": false, "missing": 1, "unverified": 4,
  "planGaps": ["structure INCOMPLETE (2 missing input(s))"],
  "pages": {
    "main": { "missing": 0, "unverified": 0, "complete": true, "openRows": [] },
    "child:Education": { "missing": 1, "unverified": 2, "complete": false,
      "openRows": [ { "n": 31, "deliverable": "Fields — 7 expected", "status": "⚠ verify",
                      "evidence": "5/7 expected fields present — missing: Amount, Owner",
                      "outcome": "unverified" } ] }
  }
}
```

Read this file — never the table — for anything you compute on: which units are open, how many
rounds are left, what a repair round is handed. The table has no per-page counts at all, and the
`⛔ VERIFY INCOMPLETE` stderr line lists at most six pages; `pages` here lists every one. Each
`openRows` entry is the row exactly as the engine wrote it, so a repair prompt quotes it rather
than restating it. `planGaps` is the plan-versus-build split (`03-failure-and-park-policy.md`),
already classified, and it is independent of `complete`: a run with nothing left to build still
stops when that array is non-empty.

## Who writes what

| File / key | Written by | Never written by |
|---|---|---|
| `build-queue.json` (all of it) | the reconcile step, and the round-close / close-time persistence step | the builder, the verifier, the judge |
| `preflight-<n>.json` → `evidence` | preflight agent number `<n>`, and only that one | every other agent |
| `built.json` → `evidence`, at preflight time | the preflight **merge** step (one agent, after the fan-out) | the preflight agents themselves |
| `built.json` → `pages`, `reachability`, `evidence` | the read-only verifier | the builder, the judge |
| `built.json` → `judge` | the judge | everyone else |
| the Freedom pages on the stand | the builder | the verifier, the judge |

**`built.json` has THREE writers, in sequence, never at the same time:** the preflight merge step, then the
read-only verifier, then the judge. The builder writes none of them — a builder that also filed its own
evidence would be grading its own work, and the arithmetic downstream would mean nothing.

**The preflight fan-out does not write `built.json`.** The ⚠ Confirm agents run in parallel; each writes
its OWN `preflight-<n>.json` and nothing else, and a single sequential merge step folds them in afterwards.
Several agents read-modify-writing one JSON file with no lock is last-write-wins at best, and a torn write
destroys the gate's own input for the whole run. "Preflight is read-only" is about the STAND; it never made
a shared file write safe. The merge copies values exactly — a record object stays an object, a literal
`false` stays `false` — because the two are different answers (see the tri-state above), and it never
deletes an entry that was already in the file.

## Recovery, concretely

A new agent in the same folder, with no memory of the run:

1. Read `build-queue.json`. It has the manifest path, the plan version, the approval record, the
   `schemaName` recorded for each page key, and every unit already parked with its `parkedWhy`.
2. Run `--units` on that manifest. Reconcile the published keys against `units` — a key in
   `--units` and not in the queue is a NEW unit (the plan was regenerated); a key in the queue
   and not in `--units` is STALE and must be reported, never silently trusted.
3. Refresh `built.json` `pages` and `reachability` from `get-page` on the stand, **fetching the
   `schemaName` the queue records for each key**. A key with no recorded schema gets no entry and
   is reported as "cannot verify, unknown schema". If `built.json` does not exist yet, create it as
   `{ "pages": {}, "reachability": {}, "evidence": {}, "judge": {} }` first — that empty skeleton
   is a valid payload and makes the gate report every deliverable unverified, which is the truth on
   a first run. Without the file `--verify` dies at exit 1 and the run gets no verdict at all.
4. Run `--verify --built built.json --out verify.md --verify-json verify.json`. The per-page
   `complete` flags in `verify.json` say what is actually done. A key with **no** entry there is
   open, not done: only an explicit `complete: true` closes a unit.
5. Build the next open unit in `buildOrder`, skipping the parked ones. Nothing else is needed.

If `build-queue.json` is absent the run is starting fresh: create it from `--units` before the
first build, with `rounds: 0` everywhere and the approval record read from **`decisions.md`** —
required at both scopes by
`../../classic-to-freedom-migration/references/migration-documentation.md`, so a single-section
folder has one too (often holding nothing but that entry). A `worklog.md` entry is accepted only
as a fallback for a folder written before that rule.

## `schemaUId` is mandatory, and it is the provenance field

Every `pages["<key>"]` entry that is not `false` must carry `schemaUId`, copied VERBATIM from clio
`get-page` (`page.schemaUId`). The CLI rejects the payload at **exit 1** without it.

Why this field and not another: `--units` publishes **no GUID of any kind**, so a `schemaUId` cannot be
derived from the plan — it can only be copied out of a real read. The engine additionally requires the
identities to agree with each other: the same `schemaUId` may not appear under two keys (one schema is
not two pages), and one `packageName` may not carry two `packageUId` values.

Be honest about the guarantee: this proves the payload is INTERNALLY CONSISTENT, not that it came from
the stand. The engine runs offline and cannot ask Creatio whether a GUID exists. It stops a payload
assembled from `--units` output alone, and it makes a careless copy-paste fail outright — it is not a
defence against a determined author.

## `viewModelConfig` — store it, because bindings are not visible in `viewConfig`

`viewConfig` shows WHICH components a page carries; it does not show what each field is BOUND to. The
binding lives in `bundle.viewModelConfig` (the attribute → data-source path map), so store that verbatim
alongside `viewConfig`.

This is not theoretical. On the first full build run the judge rejected a `#quality-gates` record whose
evidence claimed "every built field binds `$PDS_<Column>`" — only 2 of 16 actually did; the rest carried
generated `$LookupAttribute_*` / `$NumberAttribute_*` controls. The judge could see the discrepancy in
`viewConfig`, but could NOT check the data-source paths behind them, because the built file stored no
`viewModelConfig`. Storing it is what makes a binding claim checkable instead of a matter of trust.
