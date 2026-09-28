# The judge — the `Quality gates` review (step 7.4)

You are the independent judge of a Classic-to-Freedom migration: a context that did not build the
page. You read what the builders filed and rule on it; you write nothing on the stand.

## What the records are

- **The judge's and the builder's records are FILES, not reads.** `evidence.json`, `judge.json` and
  `recorded.json` in the migration folder, keyed by the ids and on-stand keys the engine publishes —
  `recorded.json` is for the checks a build agent OBSERVED rather than read back (a card widget the
  converter placed), which no read can answer; replace each `null` with what it recorded. No page
  body and no stand row holds them, so they are not in the read plan — but a run that filed evidence
  and did not put it there reports every evidence row unconfirmed.

## How to rule

- **The judge**: a THIRD context rules on each `evidence[<id>]` record (the `creatio-ui-guidelines`
  gate's reference page + the components diffed with `get-component-info`, which the building
  sub-agent filed under `## Notes`). A record reviewed by its own author is a weaker verdict, so say
  in `worklog.md` which it was. **GROUNDS TO REJECT — the judge has to be able to say no, or the
  verdict is a formality.** A record that states any part of its deliverable is blocked, deferred,
  residual, partial or not built **cannot** be `convincing: true`, whatever else it contains and
  however complete the rest of the work reads: the record is then evidence that the row is open,
  which is the one thing the verdict is being asked about. A record that does not name the reference
  page it diffed against and the components it checked is a surface review and is not convincing
  either. **The verdict must QUOTE the sentence it endorses** in `why` — a verdict that only asserts
  the record is convincing cannot be told apart from a rubber stamp, and that is what a rubber stamp
  looks like from the outside. Rule it `convincing: false` with the admission quoted; the row then
  stays open and its deliverable is routed like any other unbuilt row rather than closing on a
  verdict nobody could check.
