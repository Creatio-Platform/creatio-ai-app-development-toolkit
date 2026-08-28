"""Command-line entry point for the migration cost counter (ENG-95467).

A single committed, parameterised tool that reads a Claude Code session-export
directory and reports the cost of a Classic->Freedom migration run:

    python cost_counter.py <export-dir> [section] [--pages N] [--format text|md|json]
    python cost_counter.py <baseline-export> --compare <candidate-export> [--format ...]

Sections: all (default) | summary | stage | tool | role | agent | ttl | check.
  'summary' is the concise single-run headline (weighted cost / page + the main
  token streams). --compare shows a cost-only baseline->candidate diff with a
  same-section guard and a one-line verdict.
Formats: text (default) | md (Markdown tables for Jira) | json (structured).
The export directory is the folder that holds ``transcript.jsonl`` and the
``<session-id>/`` subtree; nothing about the run is hard-coded.

The path arguments are resolved through ``runtime.path_store``: the string you
type selects among entries that already exist under your home directory, and
never itself becomes a path the tool hands to the OS. An export somewhere else
on the machine is refused rather than read -- move it under your profile.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import attempts as attempts_mod
import export as export_mod
import metrics
from report import COUNTER_VERSION, Report

# The shared path-resolution boundary lives with the rest of the repository's
# Python runtime, not in this tool: `mcp_client.py` and `installer/install.py`
# take caller-supplied paths the same way and are meant to adopt it next. The
# release manifest ships `runtime/` and `skills/` together, so this relative
# hop holds in an installed plugin as well as in a checkout.
_REPO_ROOT = Path(__file__).resolve().parents[4]
# parents[4] is the repo root only while this file stays 4 levels down, at
# skills/classic-to-freedom-migration/tools/cost-counter/. If it ever moves, an
# implicit index would silently anchor on a wrong ancestor (or import a foreign
# `runtime`); fail loudly here instead, checking the marker the hop exists for.
if not (_REPO_ROOT / "runtime" / "path_store.py").exists():
    raise RuntimeError(
        f"unexpected repo root computed from __file__: {_REPO_ROOT} "
        f"-- no runtime/path_store.py beneath it; has cost_counter.py moved?"
    )
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from runtime import path_store  # noqa: E402  (needs the sys.path hop above)

_DEFAULTED_TO_1 = " (defaulted to 1)"


def _pages_label(page_count: int, built_pages: list) -> str:
    """'<n> (Name1, Name2)', or '<n> (defaulted to 1)' when nothing was built."""
    if built_pages:
        return f"{page_count} ({', '.join(built_pages)})"
    return f"{page_count}{_DEFAULTED_TO_1}"


def _reconfigure_stdout() -> None:
    # Transcripts carry non-ASCII (Cyrillic captions, box glyphs); force UTF-8
    # so the report renders on a cp1252 Windows console.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def _print_ttl(report: Report) -> None:
    total = report.totals
    ttl_total = total.ephemeral_5m + total.ephemeral_1h
    print("cache-write, split by cache lifetime "
          "(tokens written INTO the cache -- not the reused ones; drives the weighted cost):")
    print(f"    total cache-write tokens             : {total.cache_write:>14,}")
    if ttl_total:
        m5_pct = total.ephemeral_5m / ttl_total * 100
        h1_pct = total.ephemeral_1h / ttl_total * 100
        print(f"    5-minute cache  (x{report.cfg.cache_write_5m_weight:.2f} price) : "
              f"{total.ephemeral_5m:>14,}  {m5_pct:5.1f}%")
        print(f"    1-hour cache    (x{report.cfg.cache_write_1h_weight:.2f} price) : "
              f"{total.ephemeral_1h:>14,}  {h1_pct:5.1f}%")
        print(f"    blended write weight                 : {report.effective_w:>14.3f}")
    else:
        print("    (no cache-lifetime breakdown found in this export)")


def _mark(ok: bool, comparable: bool = True) -> str:
    """Cross-check cell: ok / n/a (not comparable) / MISMATCH."""
    if not ok:
        return "MISMATCH"
    return "ok" if comparable else "n/a"


def _count(value) -> str:
    """A meta count for display: a dash when the run file did not supply one,
    so the cell reads as an absent figure rather than leaking Python's None."""
    return "-" if value is None else str(value)


def _reconcile_verdict(rows: list) -> str:
    """Footer line for the cross-check table.

    A suppressed check is never folded into an unqualified pass: a row rendering
    ``n/a`` verified nothing, so the footer counts it rather than claiming every
    workflow reconciled. A real MISMATCH outranks both.
    """
    if not all(row.agents_ok and row.tool_calls_ok for row in rows):
        return "DISCREPANCIES ABOVE"
    # Either cell can be the suppressed one: an interrupted run suppresses the
    # tool-call check alone, while a workflow with no run file at all has
    # nothing to check on either axis. Counting only the tool-call side let a
    # never-verified workflow pass as "all workflows reconcile".
    skipped = sum(1 for row in rows
                  if not (row.agents_comparable and row.tool_calls_comparable))
    if skipped:
        return f"all comparable checks reconcile ({skipped} n/a)"
    return "all workflows reconcile"


def _print_check(report: Report) -> None:
    print("cross-checks vs workflow journals (R8):")
    print(f"    {'workflow':34} {'agents(meta/seen)':>20} {'toolCalls(meta/seen)':>24}")
    rows = report.reconcile()
    for row in rows:
        # n/a, not ok, wherever nothing was actually compared: an interrupted
        # run's tool-call counts are on different bases, and a workflow with no
        # run file has no meta count on either axis. "ok" would overclaim, and
        # a dash rather than a count says the figure is absent, not zero.
        agents = (f"{_count(row.agents_meta)}/{row.agents_seen} "
                  f"{_mark(row.agents_ok, row.agents_comparable)}")
        toolcalls = (f"{_count(row.tool_calls_meta)}/{row.tool_calls_seen} "
                     f"{_mark(row.tool_calls_ok, row.tool_calls_comparable)}")
        print(f"    {row.workflow:34} {agents:>20} {toolcalls:>24}")
        if row.note:
            print(f"    {'':34} {row.note}")
    print(f"    => {_reconcile_verdict(rows)}")


def _print_attempts(report: Report) -> None:
    """Leftover-transcript block. Printed only for a resumed or killed export."""
    if not report.interrupted:
        return
    summary = report.summary()["attempts"]
    # ASCII only in the text renderer: this report is read on cp1252 Windows
    # consoles, and _reconfigure_stdout() is best-effort.
    print("resumed/killed run -- transcripts by what the run record claims:")
    for label, attribution in report.attempt_rows():
        counts = attribution.counts
        print(f"    {label:34} {attribution.how}"
              f" / {counts[attempts_mod.LIVE]} live"
              f" / {counts[attempts_mod.REPLAYED]} replayed"
              f" / {counts[attempts_mod.LEFTOVER]} leftover")
        if attribution.total_tokens is not None:
            print(f"    {'':34} run file totalTokens: {attribution.total_tokens:,}"
                  " (surviving attempt's live agents, per the harness)")
    print(f"    leftover weighted cost: {summary['leftover_weighted']:,.0f}"
          f" of {summary['leftover_weighted'] + summary['surviving_weighted']:,.0f} total")
    nothing = summary["produced_nothing_agents"]
    if nothing is None:
        print("    produced-nothing agents: unknown (no readable journal)")
    else:
        print(f"    produced-nothing agents: {nothing}"
              " (started, no journal result -- spend with no output)")
    print("    leftovers are counted in every total above; attempts are not"
          " reconstructed (see README).")


def _print_normalization(report: Report) -> None:
    pages = report.page_count()
    weighted = report.weighted_total()
    print("normalization (R7):")
    total = report.totals
    if not (total.ephemeral_5m + total.ephemeral_1h):
        # No TTL split in this export: the blended weight fell back to the 5m
        # rate rather than a real volume-weighted blend. Always flag it so the
        # effective weight in the header isn't read as exact and does not
        # contradict the TTL block (see effective_cache_write_weight).
        print(f"    note: no cache_creation TTL breakdown; cache-write weight "
              f"fell back to {report.cfg.cache_write_5m_weight:.2f} (5m rate)")
    print(f"    built pages                 : {pages}"
          + (f"  {sorted(report.built_pages)}" if report.built_pages else "  (defaulted to 1)"))
    print(f"    weighted cost (total)       : {weighted / 1e6:,.2f}M input-equiv tokens")
    print(f"    weighted cost per built page: {weighted / pages / 1e6:,.2f}M input-equiv tokens")


def _positive_pages(value: str) -> int:
    """argparse type for --pages: a page count must be a positive integer.

    Zero would make the per-page normalization divide by zero (uncaught
    ZeroDivisionError); a negative value would print a nonsensical negative
    cost-per-page. Reject both up front with a clear message.
    """
    ivalue = int(value)
    if ivalue <= 0:
        raise argparse.ArgumentTypeError(
            f"must be a positive integer (got {ivalue})"
        )
    return ivalue


def _section(name: str) -> str:
    bar = "=" * 78
    return f"\n{bar}\n{name}\n{bar}"


# ---- structured (json) and Markdown (md, for Jira) output -----------------
#
# The json/md renderers report exactly the same numbers as the text report --
# they read the same Report object -- so a Jira paste can never drift from what
# the console shows. Section selection is honoured for all three formats.

def _config_payload(report: Report) -> dict:
    cfg = report.cfg
    total = report.totals
    from_fallback = (total.ephemeral_5m + total.ephemeral_1h) == 0
    return {
        "input_weight": cfg.input_weight,
        "cache_read_weight": cfg.cache_read_weight,
        "output_weight": cfg.output_weight,
        "cache_write_5m_weight": cfg.cache_write_5m_weight,
        "cache_write_1h_weight": cfg.cache_write_1h_weight,
        "effective_cache_write_weight": round(report.effective_w, 3),
        "effective_from_fallback": from_fallback,
        "counter_version": COUNTER_VERSION,
    }


def _ttl_payload(report: Report) -> dict:
    total = report.totals
    ttl_total = total.ephemeral_5m + total.ephemeral_1h
    return {
        "summed_cache_write": total.cache_write,
        "ephemeral_5m": total.ephemeral_5m,
        "ephemeral_1h": total.ephemeral_1h,
        "pct_5m": round(total.ephemeral_5m / ttl_total * 100, 1) if ttl_total else None,
        "pct_1h": round(total.ephemeral_1h / ttl_total * 100, 1) if ttl_total else None,
        "effective_w": round(report.effective_w, 3),
    }


def _reconcile_payload(report: Report) -> list:
    return [
        {
            "workflow": r.workflow,
            "run_id": r.run_id,
            "agents_meta": r.agents_meta,
            "agents_seen": r.agents_seen,
            # null, not true, when the comparison was suppressed: reading either
            # *_ok key alone must never show a pass over a check that did not
            # run, and the matching *_comparable: false rides along to say why.
            # Both keys keep a plain bool on a workflow that really was checked,
            # so an ordinary export's payload is unchanged.
            "agents_ok": r.agents_ok if r.agents_comparable else None,
            **({} if r.agents_comparable else {"agents_comparable": False}),
            "tool_calls_meta": r.tool_calls_meta,
            "tool_calls_seen": r.tool_calls_seen,
            "tool_calls_ok": r.tool_calls_ok if r.tool_calls_comparable else None,
            **({} if r.tool_calls_comparable else {"tool_calls_comparable": False}),
            **({"note": r.note} if r.note else {}),
        }
        for r in report.reconcile()
    ]


def _normalization_payload(report: Report) -> dict:
    pages = report.page_count()
    weighted = report.weighted_total()
    return {
        "built_pages": sorted(report.built_pages),
        "page_count": pages,
        # See summary()["page_count_defaulted"]: True means no built page was
        # discovered and `pages` fell back to 1 rather than a real count.
        "page_count_defaulted": report.pages_override is None and not report.built_pages,
        "weighted_total": weighted,
        "weighted_per_page": weighted / pages,
    }


def render_json(report: Report, section: str) -> str:
    doc: dict = {}
    if section not in ("summary", "all"):
        # "summary" and "all" already carry counter_version nested in their
        # own payload (summary()/_config_payload()); every other section
        # (stage/tool/role/agent/ttl/check) had none until now, so a saved
        # per-section report carried no indication of which counting rule
        # produced it.
        doc["counter_version"] = COUNTER_VERSION
    if section == "summary":
        doc["summary"] = report.summary()
    if section == "all":
        doc["config"] = _config_payload(report)
        doc["ttl_split"] = _ttl_payload(report)
    if section == "ttl":
        doc["ttl_split"] = _ttl_payload(report)
    tables: dict = {}
    if section in ("all", "stage"):
        tables["by_stage"] = report.by_stage_table().to_dict()
    if section in ("all", "tool"):
        tables["by_tool"] = report.by_tool_table().to_dict()
    if section in ("all", "role"):
        tables["by_role"] = report.by_role_table().to_dict()
    if section in ("all", "agent"):
        tables["per_agent"] = report.per_agent_table().to_dict()
    if tables:
        doc["tables"] = tables
    if section in ("all", "check"):
        doc["reconcile"] = _reconcile_payload(report)
    if section == "all":
        doc["normalization"] = _normalization_payload(report)
    return json.dumps(doc, indent=2, ensure_ascii=False)


def _ttl_markdown(report: Report) -> str:
    ttl = _ttl_payload(report)
    cfg = report.cfg
    lines = [
        "**Cache-write, split by cache lifetime**",
        "",
        "_Tokens written **into** the cache (not the reused ones — those are cache read). "
        "The write price depends on how long the cache lives, so the two lifetimes are "
        "blended into one weight._",
        "",
        "| cache lifetime | tokens written | share |",
        "| :-- | --: | --: |",
    ]
    if ttl["pct_5m"] is not None:
        lines.append(f"| 5-minute cache (x{cfg.cache_write_5m_weight:.2f} price) | "
                     f"{ttl['ephemeral_5m']:,} | {ttl['pct_5m']:.1f}% |")
        lines.append(f"| 1-hour cache (x{cfg.cache_write_1h_weight:.2f} price) | "
                     f"{ttl['ephemeral_1h']:,} | {ttl['pct_1h']:.1f}% |")
        lines.append(f"| **blended write weight** | **{ttl['effective_w']:.3f}** |  |")
    else:
        lines.append("| _(no cache-lifetime breakdown found)_ |  |  |")
    return "\n".join(lines)


def _reconcile_markdown(report: Report) -> str:
    lines = [
        "### Cross-checks vs workflow journals",
        "",
        "| workflow | agents (meta/seen) | toolCalls (meta/seen) |",
        "| :-- | --: | --: |",
    ]
    rows = report.reconcile()
    for r in rows:
        agents = (f"{_count(r.agents_meta)}/{r.agents_seen} "
                  f"{_mark(r.agents_ok, r.agents_comparable)}")
        calls = (f"{_count(r.tool_calls_meta)}/{r.tool_calls_seen} "
                 f"{_mark(r.tool_calls_ok, r.tool_calls_comparable)}")
        note = f" - {r.note}" if r.note else ""
        lines.append(f"| {r.workflow} | {agents} | {calls}{note} |")
    lines.append("")
    lines.append(f"_{_reconcile_verdict(rows)}_")
    if report.interrupted:
        lines.append("")
        lines.append(_attempts_markdown(report))
    return "\n".join(lines)


def _attempts_markdown(report: Report) -> str:
    """Leftover-transcript table. Empty string unless the run was interrupted."""
    if not report.interrupted:
        return ""
    summary = report.summary()["attempts"]
    lines = [
        "### Resumed/killed run -- transcripts by what the run record claims",
        "",
        "| workflow | how | live | replayed | leftover | run file totalTokens |",
        "| :-- | :-- | --: | --: | --: | --: |",
    ]
    for label, attribution in report.attempt_rows():
        counts = attribution.counts
        total_tokens = ("—" if attribution.total_tokens is None
                        else f"{attribution.total_tokens:,}")
        lines.append(
            f"| {label} | {attribution.how} | {counts[attempts_mod.LIVE]} |"
            f" {counts[attempts_mod.REPLAYED]} | {counts[attempts_mod.LEFTOVER]} |"
            f" {total_tokens} |"
        )
    nothing = summary["produced_nothing_agents"]
    nothing_label = ("unknown (no readable journal)" if nothing is None
                     else f"{nothing} (started, no journal result)")
    lines.extend([
        "",
        f"_leftover weighted cost {summary['leftover_weighted']:,.0f} of "
        f"{summary['leftover_weighted'] + summary['surviving_weighted']:,.0f} total; "
        f"produced-nothing agents: {nothing_label}. Leftovers are counted in every "
        "total above. `totalTokens` is the harness's figure for the surviving "
        "attempt's live agents and does not reconcile with transcript sums._",
    ])
    return "\n".join(lines)


def _normalization_markdown(report: Report) -> str:
    norm = _normalization_payload(report)
    pages = _pages_label(norm["page_count"], norm["built_pages"])
    return "\n".join([
        "### Normalization",
        "",
        f"- built pages: {pages}",
        f"- weighted cost (total): **{norm['weighted_total'] / 1e6:,.2f}M** input-equiv tokens",
        f"- weighted cost per built page: "
        f"**{norm['weighted_per_page'] / 1e6:,.2f}M** input-equiv tokens",
    ])


def render_markdown(report: Report, section: str) -> str:
    parts: list = []
    if section not in ("summary", "all"):
        # See render_json(): "summary" and "all" already print their own
        # counter-version line.
        parts.append(f"_counter version: {COUNTER_VERSION}_")
    if section == "summary":
        parts.append(_summary_markdown(report))
    if section == "all":
        cfg = _config_payload(report)
        parts.append(f"_counter version: {cfg['counter_version']}_")
        parts.append(
            "**Weighted-cost config** (Anthropic list-price ratios, relative to 1 "
            "input token; model-tier independent):\n\n"
            f"- input x{cfg['input_weight']:.2f} · "
            f"cache_read x{cfg['cache_read_weight']:.2f} · "
            f"output x{cfg['output_weight']:.2f} · cache_write x(blend by cache lifetime: "
            f"5m={cfg['cache_write_5m_weight']:.2f} / 1h={cfg['cache_write_1h_weight']:.2f})\n"
            f"- effective cache_write weight for this run: "
            f"**{cfg['effective_cache_write_weight']:.3f}**"
            + ("  _(fallback: no TTL breakdown)_" if cfg["effective_from_fallback"] else "")
        )
        parts.append(_ttl_markdown(report))
    if section == "ttl":
        parts.append(_ttl_markdown(report))
    if section in ("all", "stage"):
        parts.append("### By stage\n\n" + report.by_stage_table().to_markdown())
    if section in ("all", "tool"):
        parts.append("### By tool\n\n" + report.by_tool_table().to_markdown())
    if section in ("all", "role"):
        parts.append("### By agent role\n\n" + report.by_role_table().to_markdown())
    if section in ("all", "agent"):
        parts.append("### Per agent\n\n" + report.per_agent_table().to_markdown())
    if section == "check":
        parts.append(_reconcile_markdown(report))
    if section == "all":
        parts.append(_reconcile_markdown(report))
        parts.append(_normalization_markdown(report))
    return "\n\n".join(parts)


# ---- summary (concise single run) and compare (baseline vs candidate) ------

_COMPARE_MEASURES = [
    ("weighted_per_page", "weighted cost / page", "mtok"),
    ("weighted_total", "weighted cost (total)", "mtok"),
    ("cache_read", "cache read", "mtok"),
    ("cache_write", "cache write", "mtok"),
    ("output", "output", "mtok"),
    ("input", "input", "mtok"),
    ("tool_calls", "tool calls", "int"),
    ("agents", "agents", "int"),
]


def _fmt_measure(value: float, kind: str) -> str:
    return f"{value / 1e6:,.2f}M" if kind == "mtok" else f"{value:,.0f}"


def _summary_markdown(report: Report) -> str:
    s = report.summary()
    pages = _pages_label(s["page_count"], s["built_pages"])
    return "\n".join([
        "### Summary",
        "",
        f"_counter version: {s['counter_version']}_",
        "",
        "| measure | value |",
        "| :-- | --: |",
        f"| section (built pages) | {pages} |",
        f"| **weighted cost / built page** | **{s['weighted_per_page'] / 1e6:,.2f}M** |",
        f"| weighted cost (total) | {s['weighted_total'] / 1e6:,.2f}M |",
        f"| cache read | {s['cache_read'] / 1e6:,.2f}M |",
        f"| cache write (eff. w {s['effective_w']:.3f}) | {s['cache_write'] / 1e6:,.2f}M |",
        f"| output | {s['output'] / 1e6:,.2f}M |",
        f"| input | {s['input'] / 1e6:,.2f}M |",
        f"| tool calls / agents / turns | {s['tool_calls']:,} / {s['agents']:,} / {s['turns']:,} |",
    ])


def _print_summary(report: Report) -> None:
    s = report.summary()
    pages = _pages_label(s["page_count"], s["built_pages"])
    print("summary:")
    print(f"    counter version              : {s['counter_version']}")
    print(f"    section (built pages)        : {pages}")
    print(f"    weighted cost per built page : {s['weighted_per_page'] / 1e6:,.2f}M input-equiv tokens")
    print(f"    weighted cost (total)        : {s['weighted_total'] / 1e6:,.2f}M")
    print(f"    cache read                   : {s['cache_read'] / 1e6:,.2f}M")
    print(f"    cache write                  : {s['cache_write'] / 1e6:,.2f}M  (effective w {s['effective_w']:.3f})")
    print(f"    output                       : {s['output'] / 1e6:,.2f}M")
    print(f"    input                        : {s['input'] / 1e6:,.2f}M")
    print(f"    tool calls / agents / turns  : {s['tool_calls']:,} / {s['agents']:,} / {s['turns']:,}")


def _compare_rows(base: dict, cand: dict) -> list:
    rows = []
    for key, label, kind in _COMPARE_MEASURES:
        bv, cv = base[key], cand[key]
        delta = cv - bv
        rows.append({
            "key": key, "label": label, "kind": kind,
            "baseline": bv, "candidate": cv, "delta": delta,
            "pct": (delta / bv * 100.0) if bv else None,
        })
    return rows


def _version_note(base: dict, cand: dict) -> str:
    """State which side was measured with which counter version.

    A live export is always recomputed by this same running binary, so two
    live exports can never actually differ here -- the guard earns its keep
    when one side is a `summary --format json` file saved before a counting
    fix (see `_load_summary`), which is the exact pre-fix/post-fix comparison
    ENG-95856 warns about. A saved summary from before this field existed has
    no ``counter_version`` key at all, so missing is its own distinct value
    rather than raising or silently matching the other side.
    """
    bv = base.get("counter_version", "unversioned")
    cv = cand.get("counter_version", "unversioned")
    if bv != cv:
        return (f"REFUSED -- baseline measured with counter version {bv}, "
                 f"candidate with version {cv}; regenerate both with the same "
                 f"counter before comparing.")
    return f"both sides measured with counter version {bv}"


def _compare_verdict(base: dict, cand: dict, same_section: bool) -> str:
    if base.get("counter_version") != cand.get("counter_version"):
        return _version_note(base, cand)
    bv, cv = base["weighted_per_page"], cand["weighted_per_page"]
    if not bv:
        core = "baseline cost is zero -- cannot compute a ratio"
    else:
        pct = (cv - bv) / bv * 100.0
        if pct < -0.05:
            core = f"{-pct:.1f}% cheaper per built page"
        elif pct > 0.05:
            core = f"{pct:.1f}% more expensive per built page"
        else:
            core = "no change in cost per built page"
    core += " (quality not evaluated -- cost-only compare)"
    return ("SECTIONS DIFFER -- comparison void. " + core) if not same_section else core


def _load_summary(path_or_dir: str, name: str, cfg: metrics.CostConfig) -> dict:
    """Resolve one side of `--compare`: a live export directory (recomputed
    with today's COUNTER_VERSION) or a `summary --format json` file saved from
    an earlier run. A single process only ever runs one COUNTER_VERSION, so
    loading a previously-saved summary is the only way the two sides of a
    compare can genuinely carry different counter versions -- which is what
    lets `_version_note`'s REFUSED path actually fire for the pre-fix/post-fix
    scenario ENG-95856 calls out, instead of being permanently unreachable.
    """
    p = Path(path_or_dir)
    if p.is_file():
        with open(p, "r", encoding="utf-8") as f:
            doc = json.load(f)
        try:
            return doc["summary"]
        except KeyError:
            raise ValueError(
                f"{path_or_dir} is not a saved cost-counter summary (missing "
                f"'summary' key) -- produce it with: "
                f"cost_counter.py <export> summary --format json"
            ) from None
    session = export_mod.discover(path_or_dir)
    if not session.main_transcript and not session.workflows:
        raise ValueError(
            f"no transcripts found in the {name} export -- is it a session export?"
        )
    return Report(session, cfg).summary()


def compare(base_dir: str, cand_dir: str, cfg: metrics.CostConfig, fmt: str = "text") -> int:
    try:
        base = _load_summary(base_dir, "baseline", cfg)
        cand = _load_summary(cand_dir, "candidate", cfg)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    # Two runs are the same section when their built-page sets are equal --
    # including when both are empty (a schema-only / rule-only run records no
    # page schemas). A bool() short-circuit here would wrongly void the compare
    # for two structurally identical empty-page runs.
    same_section = base["built_pages"] == cand["built_pages"]
    rows = _compare_rows(base, cand)
    verdict = _compare_verdict(base, cand, same_section)

    if fmt == "json":
        print(json.dumps({
            "baseline": base, "candidate": cand,
            "same_section": same_section, "deltas": rows, "verdict": verdict,
            "version_note": _version_note(base, cand),
        }, indent=2, ensure_ascii=False))
    elif fmt == "md":
        print(_compare_markdown(base, cand, same_section, rows, verdict))
    else:
        print(_compare_text(base, cand, same_section, rows, verdict))
    return 0


def _compare_markdown(base: dict, cand: dict, same_section: bool,
                      rows: list, verdict: str) -> str:
    lines = ["### Cost comparison (baseline vs candidate)", ""]
    lines.append(f"- {_version_note(base, cand)}")
    lines.append(f"- baseline section: {base['built_pages'] or '(none)'}")
    lines.append(f"- candidate section: {cand['built_pages'] or '(none)'}"
                 + ("  · ✓ same section" if same_section
                    else "  · ✗ **sections differ — comparison void**"))
    lines += ["", "| measure | baseline | candidate | Δ | Δ% |",
              "| :-- | --: | --: | --: | --: |"]
    for r in rows:
        pct = f"{r['pct']:+.1f}%" if r["pct"] is not None else "n/a"
        lines.append(
            f"| {r['label']} | {_fmt_measure(r['baseline'], r['kind'])} "
            f"| {_fmt_measure(r['candidate'], r['kind'])} "
            f"| {_fmt_measure(r['delta'], r['kind'])} | {pct} |"
        )
    lines += ["", f"**Verdict:** {verdict}"]
    return "\n".join(lines)


def _compare_text(base: dict, cand: dict, same_section: bool,
                  rows: list, verdict: str) -> str:
    b_sec = ", ".join(base["built_pages"]) or "(none)"
    c_sec = ", ".join(cand["built_pages"]) or "(none)"
    mark = "same section" if same_section else "SECTIONS DIFFER -- comparison void"
    lines = [
        "cost comparison (baseline -> candidate):",
        f"    {_version_note(base, cand)}",
        f"    baseline section : {b_sec}",
        f"    candidate section: {c_sec}   [{mark}]",
        "",
        f"    {'measure':28} {'baseline':>12} {'candidate':>12} {'delta':>12} {'delta%':>9}",
        f"    {'-' * 28} {'-' * 12} {'-' * 12} {'-' * 12} {'-' * 9}",
    ]
    for r in rows:
        pct = f"{r['pct']:+.1f}%" if r["pct"] is not None else "n/a"
        lines.append(f"    {r['label']:28} {_fmt_measure(r['baseline'], r['kind']):>12} "
                     f"{_fmt_measure(r['candidate'], r['kind']):>12} "
                     f"{_fmt_measure(r['delta'], r['kind']):>12} {pct:>9}")
    lines += ["", f"    VERDICT: {verdict}"]
    return "\n".join(lines)


def _run_text(report: Report, section: str, cfg: metrics.CostConfig) -> None:
    if section != "summary":
        # "summary" prints its own counter-version line inside _print_summary.
        print(f"counter version: {COUNTER_VERSION}")

    if section in ("all",):
        total = report.totals
        from_fallback = (total.ephemeral_5m + total.ephemeral_1h) == 0
        for line in cfg.as_lines(report.effective_w, effective_from_fallback=from_fallback):
            print(line)
        print()
        _print_ttl(report)

    if section in ("all", "stage"):
        print(_section("by stage (main discovery+plan, then workflows / bare agents in run order)"))
        print(report.by_stage_table().render())
    if section in ("all", "tool"):
        print(_section("by tool (calls + tool_result bytes into context)"))
        print(report.by_tool_table().render())
    if section in ("all", "role"):
        print(_section("by agent role (subagents, keyed off each opening prompt / agentType)"))
        print(report.by_role_table().render())
    if section in ("all", "agent"):
        print(_section("per agent (turns, startup context, cache, output)"))
        print(report.per_agent_table().render())
    if section == "summary":
        _print_summary(report)
    if section == "ttl":
        _print_ttl(report)
    if section == "check":
        _print_check(report)
        _print_attempts(report)

    if section == "all":
        print(_section("cross-checks & normalization"))
        _print_check(report)
        if report.interrupted:
            print()
            _print_attempts(report)
        print()
        _print_normalization(report)


def run(export_dir: str, section: str, pages_override, cfg: metrics.CostConfig,
        fmt: str = "text") -> int:
    session = export_mod.discover(export_dir)
    if not session.main_transcript and not session.workflows:
        print(f"no transcripts found under {export_dir!r} -- is this a session export?",
              file=sys.stderr)
        return 2
    report = Report(session, cfg, pages_override=pages_override)

    if fmt == "json":
        print(render_json(report, section))
        return 0
    if fmt == "md":
        print(render_markdown(report, section))
        return 0

    _run_text(report, section, cfg)
    return 0


def main(argv=None, store=None) -> int:
    _reconfigure_stdout()
    parser = argparse.ArgumentParser(
        prog="cost-counter",
        description="Report the cost of a Classic->Freedom migration run from a session export.",
    )
    parser.add_argument(
        "export_dir",
        help="session-export directory (holds transcript.jsonl); must live somewhere "
             "under your home directory",
    )
    parser.add_argument(
        "section", nargs="?", default="all",
        choices=["all", "summary", "stage", "tool", "role", "agent", "ttl", "check"],
        help="which report section to print (default: all; 'summary' is the concise headline)",
    )
    parser.add_argument(
        "--pages", type=_positive_pages, default=None,
        help="override the built-page count used for per-page normalization "
             "(must be a positive integer)",
    )
    parser.add_argument(
        "--format", choices=["text", "md", "json"], default="text",
        help="output format: text (default), md (Markdown tables for Jira), or json",
    )
    parser.add_argument(
        "--compare", metavar="CANDIDATE_EXPORT", default=None,
        help="compare export_dir (baseline) against this candidate -- a "
             "cost-only before/after diff with a same-section guard; honours "
             "--format. Either side may be a live export dir or a "
             "'summary --format json' file saved from an earlier run, which "
             "is how a compare across a counter-version change is done",
    )
    args = parser.parse_args(argv)
    cfg = metrics.CostConfig()
    # Everything below reads the file system, and every path it reads comes out
    # of the store -- the argument only ever selects among entries that are
    # already there (see runtime/path_store.py). `store` is injectable so the
    # tests can stand up an export in a temp directory without the suite
    # depending on where the machine puts a home directory.
    store = store or path_store.home_store()
    try:
        export_dir = store.resolve(args.export_dir)
        compare_dir = store.resolve(args.compare) if args.compare else None
    except path_store.PathStoreError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if compare_dir is not None:
        return compare(export_dir, compare_dir, cfg, args.format)
    return run(export_dir, args.section, args.pages, cfg, args.format)


if __name__ == "__main__":
    raise SystemExit(main())
