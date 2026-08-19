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
python counter.py <export-dir> [section] [--pages N] [--format text|md|json]
```

- `<export-dir>` — the folder that holds `transcript.jsonl` and the
  `<session-id>/` subtree (see layout below).
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
python counter.py /path/to/session-export --format md      # Markdown for Jira
python counter.py /path/to/session-export --format json    # machine-readable
```

### A quick single-run headline

`section = summary` prints just the headline — weighted cost per built page and
the main token streams — without the full per-stage/role/agent tables:

```bash
python counter.py /path/to/session-export summary
```

### Did a fix make the migration cheaper? (`--compare`)

To answer that, don't read two full reports — diff them. `--compare` takes a
baseline export and a candidate export and prints a cost-only before/after
table with deltas and a one-line verdict. **`weighted cost / page` is the
headline** — it is normalised by built pages, so runs that build a different
number of pages stay comparable.

```bash
python counter.py <baseline-export> --compare <candidate-export>
python counter.py <baseline-export> --compare <candidate-export> --format md   # for Jira
```

Two guards from the ticket's comparison protocol:

- **Same section only.** If the two runs built different page schemas the diff
  is marked `comparison void` — cross-section comparisons are meaningless
  (a CREATE unit and a RESOLVE unit cost wildly different amounts).
- **Cost only, for now.** The verdict says nothing about quality
  (the `--verify` verdict and manual-intervention count). "Cheaper and broken"
  is a regression, not a win — a quality column is a follow-up, and a trustworthy
  comparison also depends on ENG-95470 (N1) landing first.

Examples:

```bash
python counter.py /path/to/session-export            # everything
python counter.py /path/to/session-export role        # just the by-role table
python counter.py /path/to/session-export ttl         # cache-write TTL split + weight
```

The output is UTF-8 (transcripts carry Cyrillic captions and box glyphs); the
tool forces UTF-8 on stdout so it renders on a Windows `cp1252` console.

## Expected export layout

```
<export-dir>/
    transcript.jsonl                       # main driver session (discovery + plan)
    <session-id>/
        subagents/workflows/<wf>/
            agent-*.jsonl                  # one subagent transcript each
            journal.jsonl                  # workflow journal (used for cross-checks)
        workflows/<wf>.json                # agentCount / totalToolCalls
        tool-results/<name>.txt            # offloaded (large) tool outputs
```

Discovery tolerates the session-id level (a per-run UUID) by locating every
`subagents/workflows` directory under the export root.

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

- **stage** — the main discovery+plan session and each workflow, with a `kind`
  column (`main` driver vs `subagents` workflow) and input / cacheW / cacheR /
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
  into a `?` bucket.
- **agent** — per subagent: turns, startup context (first-turn cache write +
  input), cache write, cache read, output.
- **ttl** — the cache-write TTL split and the effective weight.
- **check** — reconciles `agentCount` and `totalToolCalls` from each
  `workflows/<wf>.json` against what the transcripts actually contain, and
  reports built-page normalization.

## Tests

Stdlib `unittest`, deterministic, over small synthetic fixtures (no large
export needed):

```bash
python -m unittest discover -s tests -t .
```

## Acceptance baseline (Applicant migration run)

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
