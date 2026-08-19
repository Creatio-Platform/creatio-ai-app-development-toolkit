"""Command-line entry point for the migration cost counter (ENG-95467).

A single committed, parameterised tool that reads a Claude Code session-export
directory and reports the cost of a Classic->Freedom migration run:

    python counter.py <export-dir> [section] [--pages N] [--format text|md|json]

Sections: all (default) | stage | tool | role | agent | ttl | check.
Formats: text (default) | md (Markdown tables for Jira) | json (structured).
The export directory is the folder that holds ``transcript.jsonl`` and the
``<session-id>/`` subtree; nothing about the run is hard-coded.
"""
from __future__ import annotations

import argparse
import json
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
            "agents_meta": r.agents_meta,
            "agents_seen": r.agents_seen,
            "agents_ok": r.agents_ok,
            "tool_calls_meta": r.tool_calls_meta,
            "tool_calls_seen": r.tool_calls_seen,
            "tool_calls_ok": r.tool_calls_ok,
        }
        for r in report.reconcile()
    ]


def _normalization_payload(report: Report) -> dict:
    pages = report.page_count()
    weighted = report.weighted_total()
    return {
        "built_pages": sorted(report.built_pages),
        "page_count": pages,
        "weighted_total": weighted,
        "weighted_per_page": weighted / pages,
    }


def render_json(report: Report, section: str) -> str:
    doc: dict = {}
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
        "**Cache-write TTL split** (weighted-cost driver)",
        "",
        "| bucket | tokens | % |",
        "| :-- | --: | --: |",
    ]
    if ttl["pct_5m"] is not None:
        lines.append(f"| ephemeral 5m (x{cfg.cache_write_5m_weight:.2f}) | "
                     f"{ttl['ephemeral_5m']:,} | {ttl['pct_5m']:.1f}% |")
        lines.append(f"| ephemeral 1h (x{cfg.cache_write_1h_weight:.2f}) | "
                     f"{ttl['ephemeral_1h']:,} | {ttl['pct_1h']:.1f}% |")
        lines.append(f"| **effective w** | **{ttl['effective_w']:.3f}** |  |")
    else:
        lines.append("| _(no cache_creation TTL breakdown found)_ |  |  |")
    return "\n".join(lines)


def _reconcile_markdown(report: Report) -> str:
    lines = [
        "### Cross-checks vs workflow journals",
        "",
        "| workflow | agents (meta/seen) | toolCalls (meta/seen) |",
        "| :-- | --: | --: |",
    ]
    all_ok = True
    for r in report.reconcile():
        all_ok = all_ok and r.agents_ok and r.tool_calls_ok
        agents = f"{r.agents_meta}/{r.agents_seen} {'ok' if r.agents_ok else 'MISMATCH'}"
        calls = f"{r.tool_calls_meta}/{r.tool_calls_seen} {'ok' if r.tool_calls_ok else 'MISMATCH'}"
        lines.append(f"| {r.workflow} | {agents} | {calls} |")
    lines.append("")
    lines.append(f"_{'all workflows reconcile' if all_ok else 'DISCREPANCIES ABOVE'}_")
    return "\n".join(lines)


def _normalization_markdown(report: Report) -> str:
    norm = _normalization_payload(report)
    pages = f"{norm['page_count']}"
    pages += f" ({', '.join(norm['built_pages'])})" if norm["built_pages"] else " (defaulted to 1)"
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
    if section == "all":
        cfg = _config_payload(report)
        parts.append(
            "**Weighted-cost config** (Anthropic list-price ratios, relative to 1 "
            "input token; model-tier independent):\n\n"
            f"- input x{cfg['input_weight']:.2f} · "
            f"cache_read x{cfg['cache_read_weight']:.2f} · "
            f"output x{cfg['output_weight']:.2f} · cache_write x(TTL blend "
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

    if section in ("all",):
        total = report.totals
        from_fallback = (total.ephemeral_5m + total.ephemeral_1h) == 0
        for line in cfg.as_lines(report.effective_w, effective_from_fallback=from_fallback):
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
        "--pages", type=_positive_pages, default=None,
        help="override the built-page count used for per-page normalization "
             "(must be a positive integer)",
    )
    parser.add_argument(
        "--format", choices=["text", "md", "json"], default="text",
        help="output format: text (default), md (Markdown tables for Jira), or json",
    )
    args = parser.parse_args(argv)
    return run(args.export_dir, args.section, args.pages, metrics.CostConfig(), args.format)


if __name__ == "__main__":
    raise SystemExit(main())
