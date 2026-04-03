#!/usr/bin/env python3
"""
Combined entity schema sync + page sync in a single process.

Usage:
    python3 scripts/mcp_full_sync.py \
      --env output/<App>/.creatio-env.json \
      --result output/<App>/mcp-application-result.json \
      --edited-context output/<App>/edited-context.json \
      --page-plan output/<App>/plan.md \
      --report output/<App>/mcp-application-report.md

Runs entity mutations through the canonical entity flow and page changes through the canonical
page flow in one process using a single persistent MCP connection. The page helper acts as
a thin adapter around page-sync and persists repo-local evidence from the clio response.

Skipping phases:
    --skip-schema   Skip entity schema sync (only run page sync)
    --skip-pages    Skip page sync (only run entity schema sync)
"""
import argparse
import json
import sys
import time
from pathlib import Path

try:
    from scripts.mcp_result_document import ensure_result_document
    from scripts.mcp_page_sync import apply_page_sync_plan, load_page_sync_payload
    from scripts.mcp_result_evidence import build_report_markdown
    from scripts.mcp_schema_sync import (
        WorkflowError,
        apply_sync_plan,
        extract_editable_context,
        load_mcp_client,
    )
except ImportError:
    from mcp_result_document import ensure_result_document
    from mcp_page_sync import apply_page_sync_plan, load_page_sync_payload
    from mcp_result_evidence import build_report_markdown
    from mcp_schema_sync import (
        WorkflowError,
        apply_sync_plan,
        extract_editable_context,
        load_mcp_client,
    )


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def run_full_sync(env_path, result_path, edited_context_path=None, page_plan_path=None,
                  report_path=None, skip_schema=False, skip_pages=False):
    t0 = time.time()
    result_document = ensure_result_document(load_json(result_path))
    client = load_mcp_client(env_path)
    client.initialize()
    t_init = time.time()
    print(f"[full-sync] Client initialized in {t_init - t0:.2f}s", file=sys.stderr)
    if not skip_schema and edited_context_path:
        edited_context = extract_editable_context(load_json(edited_context_path))
        result_document = apply_sync_plan(client, result_document, edited_context, result_path)
        t_schema = time.time()
        print(f"[full-sync] Schema sync completed in {t_schema - t_init:.2f}s", file=sys.stderr)
    else:
        t_schema = t_init
        if skip_schema:
            print("[full-sync] Schema sync skipped (--skip-schema)", file=sys.stderr)
        elif not edited_context_path:
            print("[full-sync] Schema sync skipped (no --edited-context)", file=sys.stderr)
    if not skip_pages and page_plan_path:
        page_plan = load_page_sync_payload(page_plan_path)
        result_document = apply_page_sync_plan(client, result_document, page_plan, result_path, report_path=None)
        t_pages = time.time()
        print(f"[full-sync] Page sync completed in {t_pages - t_schema:.2f}s", file=sys.stderr)
    else:
        t_pages = t_schema
        if skip_pages:
            print("[full-sync] Page sync skipped (--skip-pages)", file=sys.stderr)
        elif not page_plan_path:
            print("[full-sync] Page sync skipped (no --page-plan)", file=sys.stderr)
    if report_path:
        Path(report_path).write_text(build_report_markdown(result_document), encoding="utf-8")
    t_end = time.time()
    print(f"[full-sync] Total: {t_end - t0:.2f}s", file=sys.stderr)
    return result_document


def build_parser():
    parser = argparse.ArgumentParser(description="Combined entity + page sync")
    parser.add_argument("--env", required=True, help="Path to .creatio-env.json")
    parser.add_argument("--result", required=True, help="Path to mcp-application-result.json")
    parser.add_argument("--edited-context", help="Path to edited context JSON for schema sync")
    parser.add_argument("--page-plan", help="Path to page-sync-plan.json or plan.md with embedded plan")
    parser.add_argument("--report", help="Path to write mcp-application-report.md")
    parser.add_argument("--skip-schema", action="store_true", help="Skip entity schema sync")
    parser.add_argument("--skip-pages", action="store_true", help="Skip page sync")
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    if not args.edited_context and not args.page_plan:
        parser.error("At least one of --edited-context or --page-plan is required")
    run_full_sync(
        env_path=args.env,
        result_path=args.result,
        edited_context_path=args.edited_context,
        page_plan_path=args.page_plan,
        report_path=args.report,
        skip_schema=args.skip_schema,
        skip_pages=args.skip_pages,
    )


if __name__ == "__main__":
    main()
