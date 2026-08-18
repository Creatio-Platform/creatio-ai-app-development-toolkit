"""Entry-point smoke tests: run()/main() over a synthetic export.

Pins the CLI plumbing -- section dispatch, the empty-export exit code, the
--pages override, and the ttl/check/normalization printers -- so a refactor of
cli.py cannot silently break the reporting surface.
"""
import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest

import cli
import metrics


def _line(obj):
    return json.dumps(obj) + "\n"


def _usage(inp=0, cw=0, cr=0, out=0, m5=None, h1=None):
    u = {
        "input_tokens": inp,
        "cache_creation_input_tokens": cw,
        "cache_read_input_tokens": cr,
        "output_tokens": out,
    }
    if m5 is not None or h1 is not None:
        u["cache_creation"] = {
            "ephemeral_5m_input_tokens": m5 or 0,
            "ephemeral_1h_input_tokens": h1 or 0,
        }
    return u


class CliSmokeTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="cc-cli-")
        wf_dir = os.path.join(self.root, "sess-1", "subagents", "workflows", "wf_a")
        os.makedirs(wf_dir)
        os.makedirs(os.path.join(self.root, "sess-1", "workflows"))
        with open(os.path.join(wf_dir, "agent-aaa.jsonl"), "w", encoding="utf-8") as f:
            f.writelines([
                _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
                _line({"message": {"role": "assistant",
                                   "usage": _usage(inp=10, cw=100, cr=1000, out=5, m5=80, h1=20),
                                   "content": [{"type": "tool_use", "id": "t1", "name": "Bash"}]}}),
            ])
        with open(os.path.join(self.root, "sess-1", "workflows", "wf_a.json"),
                  "w", encoding="utf-8") as f:
            json.dump({"agentCount": 1, "totalToolCalls": 1}, f)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _run(self, section, pages=None):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = cli.run(self.root, section, pages, metrics.CostConfig())
        return rc, buf.getvalue()

    def test_all_section_prints_every_block(self):
        rc, out = self._run("all")
        self.assertEqual(rc, 0)
        for marker in ("weighted-cost config", "by stage", "by tool",
                       "by agent role", "per agent", "cross-checks", "normalization (R7)"):
            self.assertIn(marker, out)

    def test_role_section_shows_role_table_only(self):
        rc, out = self._run("role")
        self.assertEqual(rc, 0)
        self.assertIn("BUILD", out)
        self.assertNotIn("normalization (R7)", out)

    def test_check_section_reconciles(self):
        rc, out = self._run("check")
        self.assertEqual(rc, 0)
        self.assertIn("all workflows reconcile", out)

    def test_pages_override_changes_per_page_math(self):
        _, out = self._run("all", pages=4)
        self.assertIn("built pages                 : 4", out)

    def test_empty_export_returns_exit_code_2(self):
        empty = tempfile.mkdtemp(prefix="cc-empty-")
        try:
            buf = io.StringIO()
            with contextlib.redirect_stderr(buf):
                rc = cli.run(empty, "all", None, metrics.CostConfig())
            self.assertEqual(rc, 2)
            self.assertIn("no transcripts found", buf.getvalue())
        finally:
            shutil.rmtree(empty, ignore_errors=True)

    def test_main_parses_argv_and_returns_zero(self):
        self.assertEqual(cli.main([self.root, "stage"]), 0)


if __name__ == "__main__":
    unittest.main()
