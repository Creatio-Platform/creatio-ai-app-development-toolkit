"""Command-line entry point for the migration cost counter (ENG-95467).

A single committed, parameterised tool that reads a Claude Code session-export
directory and reports the cost of a Classic->Freedom migration run:

    python cli.py <export-dir> [section] [--pages N]

Sections: all (default) | stage | tool | role | agent | ttl | check.
The export directory is the folder that holds ``transcript.jsonl`` and the
``<session-id>/`` subtree; nothing about the run is hard-coded.
"""
from __future__ import annotations

import argparse
import sys

import export as export_mod
import metrics
from report import Report


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
    print("cache-write TTL split (weighted-cost driver, R4):")
    print(f"    cache_creation_input_tokens (summed) : {total.cache_write:>14,}")
    if ttl_total:
        m5_pct = total.ephemeral_5m / ttl_total * 100
        h1_pct = total.ephemeral_1h / ttl_total * 100
        print(f"    ephemeral 5m  (x{report.cfg.cache_write_5m_weight:.2f}) : "
              f"{total.ephemeral_5m:>14,}  {m5_pct:5.1f}%")
        print(f"    ephemeral 1h  (x{report.cfg.cache_write_1h_weight:.2f}) : "
              f"{total.ephemeral_1h:>14,}  {h1_pct:5.1f}%")
        print(f"    effective cache-write weight         : {report.effective_w:>14.3f}")
    else:
        print("    (no cache_creation TTL breakdown found in this export)")


def _print_check(report: Report) -> None:
    print("cross-checks vs workflow journals (R8):")
    print(f"    {'workflow':22} {'agents(meta/seen)':>20} {'toolCalls(meta/seen)':>24}")
    all_ok = True
    for row in report.reconcile():
        a_mark = "ok" if row.agents_ok else "MISMATCH"
        t_mark = "ok" if row.tool_calls_ok else "MISMATCH"
        all_ok = all_ok and row.agents_ok and row.tool_calls_ok
        agents = f"{row.agents_meta}/{row.agents_seen} {a_mark}"
        toolcalls = f"{row.tool_calls_meta}/{row.tool_calls_seen} {t_mark}"
        print(f"    {row.workflow:22} {agents:>20} {toolcalls:>24}")
    print(f"    => {'all workflows reconcile' if all_ok else 'DISCREPANCIES ABOVE'}")


def _print_normalization(report: Report) -> None:
    pages = report.page_count()
    weighted = report.weighted_total()
    print("normalization (R7):")
    print(f"    built pages                 : {pages}"
          + (f"  {sorted(report.built_pages)}" if report.built_pages else "  (defaulted to 1)"))
    print(f"    weighted cost (total)       : {weighted / 1e6:,.2f}M input-equiv tokens")
    print(f"    weighted cost per built page: {weighted / pages / 1e6:,.2f}M input-equiv tokens")


def _section(name: str) -> str:
    bar = "=" * 78
    return f"\n{bar}\n{name}\n{bar}"


def run(export_dir: str, section: str, pages_override, cfg: metrics.CostConfig) -> int:
    session = export_mod.discover(export_dir)
    if not session.main_transcript and not session.workflows:
        print(f"no transcripts found under {export_dir!r} -- is this a session export?",
              file=sys.stderr)
        return 2
    report = Report(session, cfg, pages_override=pages_override)

    if section in ("all",):
        for line in cfg.as_lines(report.effective_w):
            print(line)
        print()
        _print_ttl(report)

    if section in ("all", "stage"):
        print(_section("by stage (main discovery+plan, then each workflow)"))
        print(report.by_stage_table().render())
    if section in ("all", "tool"):
        print(_section("by tool (calls + tool_result bytes into context)"))
        print(report.by_tool_table().render())
    if section in ("all", "role"):
        print(_section("by agent role (subagents, keyed off each opening prompt)"))
        print(report.by_role_table().render())
    if section in ("all", "agent"):
        print(_section("per agent (turns, startup context, cache, output)"))
        print(report.per_agent_table().render())
    if section == "ttl":
        _print_ttl(report)
    if section == "check":
        _print_check(report)

    if section == "all":
        print(_section("cross-checks & normalization"))
        _print_check(report)
        print()
        _print_normalization(report)
    return 0


def main(argv=None) -> int:
    _reconfigure_stdout()
    parser = argparse.ArgumentParser(
        prog="cost-counter",
        description="Report the cost of a Classic->Freedom migration run from a session export.",
    )
    parser.add_argument("export_dir", help="session-export directory (holds transcript.jsonl)")
    parser.add_argument(
        "section", nargs="?", default="all",
        choices=["all", "stage", "tool", "role", "agent", "ttl", "check"],
        help="which report section to print (default: all)",
    )
    parser.add_argument(
        "--pages", type=int, default=None,
        help="override the built-page count used for per-page normalization",
    )
    args = parser.parse_args(argv)
    return run(args.export_dir, args.section, args.pages, metrics.CostConfig())


if __name__ == "__main__":
    raise SystemExit(main())
