# 01 — Evidence records, ids, and the judge verdict

Some deliverables cannot be proven by any page body. The page-design pass ran or it did not;
a `⚠ Confirm` decision was answered or it was not; a child page nobody folded was built or it
was not. `get-page` shows none of that. Those rows close through an **evidence record** plus a
**second agent's verdict** — never through prose in an Evidence cell.

This file is the shape contract. Read it before the verifier writes `evidence` and before the
judge writes `judge`.

## The ids come from the engine, never from you

Run `--units`. It publishes every id you may file under:

```json
{
  "evidenceRows": [
    { "id": "main#quality-gates", "pageKey": "main", "requires": ["referencePage", "components"] },
    { "id": "main#confirm:detail-add-mechanism:Products", "pageKey": "main", "requires": ["referencePage", "components"] },
    { "id": "child:Product#childpage", "pageKey": "child:Product", "requires": ["referencePage", "components"] }
  ],
  "preflight": [
    { "id": "main#confirm:detail-add-mechanism:Products", "pageKey": "main",
      "kind": "detail-add-mechanism", "item": "Products", "requires": ["referencePage", "components"] }
  ]
}
```

Three id shapes exist, each built from raw values (page key, `kind`, `item`), never from a rendered
label:

| Shape | Emitted for | How many |
|---|---|---|
| `<pageKey>#quality-gates` | the mandatory `creatio-ui-guidelines` page-design pass | one per published page key |
| `<pageKey>#confirm:<kind>:<item>` | one per `⚠ Confirm worklist` item on that page | zero or more |
| `<pageKey>#childpage` | a child page whose Classic source was never folded | zero or more |

An id you invented matches nothing. The row stays `⚠ unverified` and the run cannot exit 0 —
the engine reports no error for it, so an invented id reads as silence, not as a mistake.

## The record shape

Every record lives under `--built.evidence[<id>]` and must satisfy the row's own `requires`
array. Today the engine publishes one required set for every family:

```json
"evidence": {
  "main#quality-gates": {
    "referencePage": "AccountPage",
    "components": ["crt.ExpansionPanel", "crt.GridContainer", "crt.ComboBox"]
  }
}
```

The engine type-checks each field. `referencePage` must be a **non-blank string**;
`components` must be a **non-empty array of non-blank strings**. `components: []`,
`components: {}`, `components: false`, `referencePage: 0` and `referencePage: ""` are all an
INCOMPLETE record → `⚠ unverified`. A field name in `requires` with no declared shape falls back
to the strict generic rule (a non-blank string, or a non-empty list of non-blank strings). There
is no "unknown field ⇒ accept" escape.

**Exception, `#quality-gates` ONLY (ENG-95471):** a page genuinely diffed and found already
compliant — zero drift, nothing to fix — cannot honestly name a non-empty `components` list. For
this one row family, `components: []` is accepted **when paired with a non-blank
`noChangesReason`** naming what was actually compared:

```json
"main#quality-gates": {
  "referencePage": "ContactsListPage",
  "components": [],
  "noChangesReason": "diffed QuickFilter, ButtonToggleGroup and the four command buttons against ContactsListPage — identical props, no drift"
}
```

`components: []` with no `noChangesReason` is still incomplete, the same as before — the empty
list alone proves nothing; the reason is what earns the pass, and the judge still rules on whether
it genuinely supports "nothing needed fixing" rather than accepting it as a formality. No other
evidence family (`#confirm:*`, `#childpage`, list-page rows) accepts this shape: those rows prove
something was *built*, and an empty answer can never do that.

`"<id>": false` is the deliberate negative: **checked, and the deliverable was NOT done** → a hard
`❌ MISSING`. Use it when you know the answer is no. Omitting the key is a different statement —
nobody looked — and reads `⚠ unverified`. Both block exit 0; they send the executor to a
different repair.

## What to put in the two fields, per family

- **`<pageKey>#quality-gates`** — `referencePage` is the SHIPPED Freedom page the page was diffed
  against; `components` are the ones `get-component-info` was run on and props compared for
  (`color`/`padding`/`borderRadius`/`gap`, panel `toggleType`, `caption` not raw `title`,
  `labelPosition`, column count). A record naming no reference page is not evidence of a style
  diff; it is evidence that a screenshot was looked at.
  **Both fields come from the builder's required `guidelines` return, never from the verifier.** The
  builder does not file — but a page that owes this id does not close without answering, so the record
  is never absent because nobody was asked. `ran: false` files `false` (a hard MISSING, per the rule
  above — an honest answer, not a pass); a half-filled answer files nothing and is reported. A page key
  that publishes no `#quality-gates` id — an unfolded or reuse child — owes nothing here.
- **`<pageKey>#confirm:<kind>:<item>`** — the answer to that decision, evidenced the same way:
  the page (or shipped reference) you resolved it against, and the components the answer produced
  or ruled out. A `kind` of `detail-add-mechanism` closes when the record names the lookup /
  service / editable-grid components you actually built.
- **`<pageKey>#childpage`** — the reference page the unfolded child was built from and the
  components it carries. This key exists precisely because the plan derives nothing about that
  page, so the structural row can only ask "did the key return any component at all". A one-key
  JSON object satisfies the structural row; only the evidence record and the judge close it.

## The judge is a different agent, and silence is not consent

```json
"judge": { "main#quality-gates": { "convincing": true, "why": "names AccountPage + 3 components with prop-level diffs" } }
```

| `evidence[id]` | `judge[id].convincing` | Row |
|---|---|---|
| complete record | `true` | ✅ Done |
| complete record | absent | ⚠ unverified — *"filed but NOT judged"* |
| complete record | `false` | ❌ MISSING — the judge's `why` is printed |
| incomplete / absent | anything | ⚠ unverified — *"no complete evidence record"* |
| `false` | anything | ❌ MISSING — filed as not done |

The judge writes **only** the `judge` object. It never edits `pages`, `reachability` or
`evidence`, and it never runs a build tool. If the judge could also write the record it is
blessing, the arithmetic downstream would be arithmetic over one agent's self-assertion — which
is the failure the split exists to prevent.

**ENG-95859 — `#quality-gates` now renders as TWO rows off this ONE id, not one.** Filing is
unchanged: you still file exactly one `evidence[id]` record and, separately, one `judge[id]`
verdict. But `--verify`'s checklist reports "a complete record was filed" and "an independent
judge found it convincing" as two SEPARATE rows sharing that id — "the design pass ran" and "it
was reviewed" are different facts, and conflating them let a run that filed a record nobody
reviewed print identically to one that filed nothing. Both rows must read ✅ (or the outcome
table above must independently work out to ✅ for each) before the page's design-pass gate is
closed; `evidenceRows`/`evidenceIds` still publish exactly one `main#quality-gates` entry, so
nothing about WHERE you file changes.

The judge's job is not to be agreeable. `convincing: false` with a `why` is a normal, useful
outcome: it names a repair the builder can act on. `convincing: true` on a record that names no
reference page, or lists a component the page does not carry, is the judge failing.

## Reachability is a different mechanism — do not file it as evidence

Five wiring facts (`typedFormsBuilt`, `typedRouting`, `miniPageWired`, `reuseBindings`,
`sectionRegistered`) are configuration records, not page content — `--units.reachability[]` says
which of the five this run actually gates. Four are plain tri-state
booleans under `--built.reachability`, not evidence records; `sectionRegistered` is the
exception and takes an OBJECT (see below):

```json
"reachability": { "sectionRegistered": { "workplaces": 1, "names": ["<Workplace>"] }, "miniPageWired": false }
```

`true` = confirmed on-stand · `false` = confirmed absent (❌ MISSING) · key omitted = nobody
checked (⚠ unverified). **`sectionRegistered` does NOT take a bare `true`:** a workplace
registration only ADDS, so a flag cannot tell one binding from two — report the COUNT you
actually read on the stand, `{ "workplaces": <n>, "names": [...] }`, and the row closes at
exactly 1. A bare `true` there reads ⚠ unverified, by design. `--units.reachability[]` publishes which of the keys this run actually
gates (`appliesWhen: true`) and which page keys read each one, so you can neither invent an
obligation nor miss one.
