# Migration cost counter

A committed, parameterised tool that reads a Claude Code **session-export**
directory and reports the token cost of a Classic&nbsp;&rarr;&nbsp;Freedom
migration run: by stage, by tool, by agent role, and per agent. Cache-creation
and cache-read tokens are reported as **their own columns** (never folded into
"output"), and the weighted-cost metric is driven by **printed configuration**
rather than constants buried in the code.

It consolidates four earlier one-shot analysis scripts into one stdlib-only
Python package with a shared parser. There are **no hard-coded paths** — the
export directory is the only required argument.

Jira: [ENG-95467](https://creatio.atlassian.net/browse/ENG-95467).

## Requirements

Python 3.10+ (standard library only — no third-party packages).

## Usage

```bash
# from this directory
python cost_counter.py <export-dir> [section] [--pages N] [--format text|md|json]
```

- `<export-dir>` — the folder that holds `transcript.jsonl` and the
  `<session-id>/` subtree (see layout below). Absolute or relative; it must
  live **somewhere under your home directory** (see
  [Where the export may live](#where-the-export-may-live)).
- `section` — one of `all` (default), `stage`, `tool`, `role`, `agent`,
  `ttl`, `check`.
- `--pages N` — override the built-page count used for per-page normalization
  (by default it is read from the workflow journals).
- `--format` — `text` (default, fixed-width console tables), `md`
  (GitHub-flavoured Markdown tables, ready to paste into a Jira comment), or
  `json` (structured — config, TTL split, every table as rows with per-measure
  values and shares, reconcile, normalization). All three report the same
  numbers and honour `section`.

```bash
python cost_counter.py /path/to/session-export --format md      # Markdown for Jira
python cost_counter.py /path/to/session-export --format json    # machine-readable
```

### A quick single-run headline

`section = summary` prints just the headline — weighted cost per built page and
the main token streams — without the full per-stage/role/agent tables:

```bash
python cost_counter.py /path/to/session-export summary
```

### Did a fix make the migration cheaper? (`--compare`)

To answer that, don't read two full reports — diff them. `--compare` takes a
baseline export and a candidate export and prints a cost-only before/after
table with deltas and a one-line verdict. **`weighted cost / page` is the
headline** — it is normalised by built pages, so runs that build a different
number of pages stay comparable.

```bash
python cost_counter.py <baseline-export> --compare <candidate-export>
python cost_counter.py <baseline-export> --compare <candidate-export> --format md   # for Jira
```

Three guards from the ticket's comparison protocol:

- **Same section only.** If the two runs built different page schemas the diff
  is marked `comparison void` — cross-section comparisons are meaningless
  (a CREATE unit and a RESOLVE unit cost wildly different amounts).
- **Cost only, for now.** The verdict says nothing about quality
  (the `--verify` verdict and manual-intervention count). "Cheaper and broken"
  is a regression, not a win — a quality column is a follow-up, and a trustworthy
  comparison also depends on ENG-95470 (N1) landing first.
- **Same counter version only.** A single invocation always measures both
  sides with today's `counter_version`, so this only matters across a
  counting-rule change (ENG-95856's dedup fix bumped it to 2; counting bare
  subagents bumped it to 3): save the pre-fix side with
  `... summary --format json > before.json` first, then compare that file
  against a live post-fix export —
  `python cost_counter.py before.json --compare <post-fix-export>`. Either
  `--compare` operand may be a live export directory or such a saved summary
  file; a genuine version mismatch prints `REFUSED` instead of a number.

Examples:

```bash
python cost_counter.py /path/to/session-export            # everything
python cost_counter.py /path/to/session-export role        # just the by-role table
python cost_counter.py /path/to/session-export ttl         # cache-write TTL split + weight
```

The output is UTF-8 (transcripts carry Cyrillic captions and box glyphs); the
tool forces UTF-8 on stdout so it renders on a Windows `cp1252` console.

## Where the export may live

The path arguments (`<export-dir>` and `--compare`) go through the repository's
shared resolver, [`runtime/path_store.py`](../../../../runtime/path_store.py),
before anything is opened. The string you type is never used as a path: it is
split into names, each name is matched against the listing of the directory
reached so far, and the component that actually gets joined is the one the
listing reported. `..`, an absolute path elsewhere on the machine and a symlink
that leads out are not so much rejected as inexpressible - you can only descend
into an entry that is really there.

The practical consequence: **the export has to sit somewhere under your home
directory**. That is where session exports land anyway (`~/Downloads/...`), and
both absolute and relative paths work as long as they resolve under the
profile. An export elsewhere is refused with a message naming the base:

```
path is outside the directory this tool may read
    requested : C:\Projects\some\export
    allowed   : C:\Users\you (and anything beneath it)
```

Move it under your profile, or construct the tool with a store rooted where the
input already lives (`main(argv, store=PathStore(...))`, which is how the tests
stand up fixtures in a temp directory).

## Expected export layout

```
<export-dir>/
    transcript.jsonl                       # main driver session (discovery + plan)
    <session-id>/
        subagents/
            agent-*.jsonl                  # a BARE subagent (plain Agent tool)
            agent-*.meta.json              # its agentType / description
            workflows/<wf>/
                agent-*.jsonl              # one workflow subagent transcript each
                journal.jsonl              # workflow journal (used for cross-checks)
        workflows/<wf>.json                # agentCount / totalToolCalls
        tool-results/<name>.txt            # offloaded (large) tool outputs
```

Discovery tolerates the session-id level (a per-run UUID) by locating every
`subagents` directory under the export root.

### Two kinds of subagent

A subagent spawned through a **workflow** gets a run-id directory under
`subagents/workflows/`, a `journal.jsonl`, and a `workflows/<wf>.json` run file
to reconcile against. A subagent spawned with the **plain Agent tool** gets none
of that: its transcript sits directly in `subagents/`, and the only thing naming
it is the sibling `agent-<id>.meta.json` (`agentType`, `description`).

Both are counted. Anchoring discovery on `subagents/workflows` alone skipped
every bare transcript, so its whole cost was missing from every total — and
worse than a flat undercount, because the *same* stage can run as a workflow in
one export and as a bare agent in another, which put the two sides of a
`--compare` on different bases (measured: 34.35M reported against a true
35.25M, +2.6%, for a stage that the baseline export counted in full).

A bare agent has no run file and never could have one, so it produces **no**
cross-check row. It does get its own **stage row** — labelled from the meta's
`description`, or the agent id when that is absent — marked `agent` in the
`kind` column, ordered among the workflow stages by its transcript's first
timestamp, and counted in the `agents` headline and the per-agent table.

## The metric

Weighted cost is expressed in **input-equivalent tokens** using Anthropic
list-price ratios normalised to one input token (model-tier independent):

```
cost = input + w*cache_write + 0.1*cache_read + 5*output
```

`w`, the effective cache-write weight, is the volume-weighted blend of the two
cache-write TTL prices, read from `usage.cache_creation.ephemeral_5m/1h_input_tokens`
(the summed `cache_creation_input_tokens` field cannot tell a 5-minute write
from a 1-hour one):

```
w = (tok5m*1.25 + tok1h*2.0) / (tok5m + tok1h)
```

All of these weights are printed as a config block at the top of the `all`
report. Change a price there — never in a computation.

## What each section reports

- **stage** — the main discovery+plan session, each workflow, and each bare
  subagent, in the order they ran, with a `kind` column (`main` driver /
  `subagents` workflow / `agent` bare subagent) and input / cacheW / cacheR /
  output as separate share columns and a weighted total. `kind` explains why the
  by-role table (subagents only) totals less than this table's grand total: the
  `main` stage runs the driver itself, no subagents. input leads the measures
  because it is the base term the weighted cost normalises to; it is tiny in
  volume but keeps the formula legible. Every table ends with a `TOTAL` row equal
  to the column sums (the `kind` cell is left blank there).
- **tool** — call count and tool-result bytes per tool. Offloaded results
  (written to `tool-results/`) are charged to the **producing tool via the
  `tool_use_id`** in the transcript, not guessed from the offload file name
  (which is generic for non-MCP tools). The long tail is folded into one
  `(+N more tools)` row so the total still reconciles.
- **role** — subagents grouped by the role parsed from each agent's opening
  prompt (BUILD / REFS / RECONCILE / PREFLIGHT / VERIFY / JUDGE / PERSISTENCE /
  CONTEXT / MERGE / CLOSE / CRITIQUE / DESCRIBE). Unrecognised openings fall
  into a `?` bucket. A **bare** subagent is keyed off its recorded `agentType`
  (e.g. `general-purpose`) instead: its opening prompt is not written in that
  vocabulary, and parsing it does not merely fail to match — "You are running
  the classic-ui-expert skill" would enter the table as a role called
  `RUNNING`. Lower-case entries are therefore agent *types*, not parsed roles;
  `?` still means the meta file was missing or unusable.
- **agent** — per subagent: turns, startup context (first-turn cache write +
  input), cache write, cache read, output.
- **ttl** — the cache-write TTL split and the effective weight.
- **check** — reconciles `agentCount` and `totalToolCalls` from each
  `workflows/<wf>.json` against what the transcripts actually contain, and
  reports built-page normalization. A workflow with no run file has nothing to
  reconcile against, so its counts print as `-/<seen> n/a` rather than `ok`. For
  a run that was resumed or killed it also prints the leftover block described
  below.

## Resumed and killed runs

A workflow directory accumulates transcripts across every *attempt*. Resuming
replays some agents and re-runs others; killing a run leaves the interrupted
agents' transcripts behind. The run file is rewritten on each attempt, so
`agentCount` describes only the latest one — which is why a real export was seen
holding 41 `agent-*.jsonl` files for a run whose record says `agentCount: 18`.

The counter does **not** drop those transcripts: every total still sums all of
them, so the headline figure remains "everything this directory cost", and
`--compare` stays a like-for-like comparison. What it adds is a classification
of each transcript against the run's own record:

- **live** — in `workflowProgress`, ran in the surviving attempt;
- **replayed** — in `workflowProgress` with `cached: true`, its result reused
  from an earlier attempt rather than recomputed;
- **leftover** — no record claims it: superseded attempts, killed agents,
  abandoned retries.

Alongside it the block reports **produced-nothing** agents — a journal `started`
with no matching `result`, i.e. spend that yielded no output — and the run
file's own `totalTokens`, which is the harness's figure for the surviving
attempt's *live* agents only. That number is read, never recomputed: it is on a
different accounting basis from transcript sums (real agents re-read context
every turn, so cache-read accumulates in transcripts but not in `totalTokens`)
and the two are not expected to reconcile.

Because the surplus is explained, the **check** section reports it as a note
rather than a `MISMATCH`: on an interrupted run the meta counts cover the
surviving attempt while the seen counts span every transcript, so the two are
simply not comparable.

Each cross-check cell therefore has three states, not two — `ok` (compared and
equal), `n/a` (not comparable, so nothing was verified), and `MISMATCH` (a real
disagreement). The footer says `all comparable checks reconcile (N n/a)` when
anything was suppressed, so a skipped check is never folded into an unqualified
pass. In the JSON payload the same distinction is `"tool_calls_ok": null`
alongside `"tool_calls_comparable": false` (and `"agents_ok"` /
`"agents_comparable"` on the other axis); a `true` there always means the
comparison actually ran. An agent-count gap that the leftover bucket accounts
for stays `ok` with a note, because that one *is* verified — the leftovers are
exactly the difference.

There are two ways a check ends up `n/a`. An interrupted run suppresses the
tool-call check alone, for the reason above. A workflow whose
`workflows/<wf>.json` is **absent** — still in flight when the session was
exported, or a partially-copied export — suppresses *both*: there is no
`agentCount` and no `totalToolCalls`, so neither axis was compared. Its meta
cells print `-`, not a count, and the footer degrades accordingly. Reporting
those as `ok` claimed a verification that never ran and let the footer say "all
workflows reconcile" over a real 6-agent, 190-tool-call workflow that nobody had
checked.

A gap in the other direction — fewer transcripts than the record claims ran — is
a truncated or partially-copied export, and is reported as missing transcripts
rather than as a surplus.

Attempts are deliberately **not** reconstructed. `promptId` tracks the
main-session prompt chain rather than the resume (a kill-and-resume was observed
with both attempts sharing one), and replayed `workflowProgress` entries carry
the *replay* timestamp rather than their original, so `startedAt` cannot order
attempts either. Leftovers therefore stay in one bucket instead of being split
along boundaries the data cannot support.

A resume that replayed *everything* writes no new transcript and is not reported
as interrupted — the plain sum is already correct for it. An export whose run
file is missing or unreadable cannot be classified at all, and falls back to
reporting totals only.

## Tests

Stdlib `unittest`, deterministic, over small synthetic fixtures (no large
export needed):

```bash
python -m unittest discover -s tests -t .
```

## Acceptance baseline (Applicant migration run)

> **Pre-fix figures — not comparable to a current run.** The table below was
> produced before ENG-95856 was fixed: `aggregate_transcript` charged the same
> API message once per JSONL record it was split across (thinking / text /
> tool_use), instead of once. Measured on a different, smaller export
> (`classic-behaviour-analysis`, 5 agents, one workflow) the inflation this
> caused ranged ×1.65–2.15 per measure and ×1.81 on the weighted total; across
> six exports the weighted factor ranged ×1.74–4.08 and is not uniform, so
> shares, rankings and `--compare` deltas below are not safe to read as exact.
> Regenerating this table requires the *original* Applicant baseline export
> that produced these specific numbers (1,191 tool calls / 50 agents /
> `Applicant_FormPage`) — that export is not currently available on this
> machine. `counter_version` is a new field: the code that produced this table
> predates it and printed no version at all. Any report showing
> `counter_version: 2` was measured after that fix, and `3` after bare
> subagents began to be counted; do not diff reports whose `counter_version`
> differs, or one that carries no `counter_version` against one that does.

Against the preserved Applicant baseline export the tool reproduces the
published numbers:

| measure | value |
|---|---|
| tool calls | 1,191 |
| output | 1.88M |
| cache write | 26.0M |
| cache read | 351.8M |
| agents | 50 |
| weighted total | 81.0M input-equiv tokens |
| cache-write TTL split | 21.29M @5m / 4.70M @1h, w = 1.39 |
| BUILD | 5 agents / 684 turns / 137.7M cacheR |
| REFS | 3 agents / 220 turns / 34.9M cacheR |
| RECONCILE | 9 agents / 409 turns / 34.4M cacheR |

The baseline export is far too large to commit; the reproduction is a manual
acceptance check against a preserved copy of that export.
