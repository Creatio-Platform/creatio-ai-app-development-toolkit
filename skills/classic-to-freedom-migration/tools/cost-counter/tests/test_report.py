"""Integration tests over a small synthetic session export.

Covers offloaded-byte attribution by tool-use id (R9), journal reconciliation
(R8), the by-role split (R5), and per-built-page normalization (R7) without
needing the multi-hundred-MB real export.
"""
import json
import os
import shutil
import tempfile
import unittest

import export as export_mod
import metrics
from report import Report, aggregate_transcript


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


class ExportFixture:
    """Builds a minimal but structurally faithful export under a temp dir."""

    def __init__(self):
        self.root = tempfile.mkdtemp(prefix="cc-export-")
        self.session = os.path.join(self.root, "sess-1")
        self.wf_dir = os.path.join(self.session, "subagents", "workflows", "wf_a")
        self.tool_results = os.path.join(self.session, "tool-results")
        os.makedirs(self.wf_dir)
        os.makedirs(self.tool_results)
        os.makedirs(os.path.join(self.session, "workflows"))

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write_main(self, lines):
        with open(os.path.join(self.root, "transcript.jsonl"), "w", encoding="utf-8") as f:
            f.writelines(lines)

    def write_agent(self, agent_id, lines):
        path = os.path.join(self.wf_dir, f"agent-{agent_id}.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)

    def write_offload(self, name, size):
        with open(os.path.join(self.tool_results, name), "w", encoding="utf-8") as f:
            f.write("X" * size)

    def write_journal(self, lines):
        with open(os.path.join(self.wf_dir, "journal.jsonl"), "w", encoding="utf-8") as f:
            f.writelines(lines)

    def write_meta(self, agent_count, total_tool_calls):
        path = os.path.join(self.session, "workflows", "wf_a.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"agentCount": agent_count, "totalToolCalls": total_tool_calls}, f)


class AttributionTest(unittest.TestCase):
    def setUp(self):
        self.fx = ExportFixture()
        self.fx.write_offload("big.txt", 500)
        # One agent: a Bash tool_use whose result was offloaded to big.txt,
        # plus an inline clio result.
        self.fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent of a run."}}),
            _line({"message": {"role": "assistant", "usage": _usage(inp=10, cw=100, cr=1000, out=5),
                               "content": [
                                   {"type": "tool_use", "id": "tu1", "name": "Bash"},
                                   {"type": "tool_use", "id": "tu2", "name": "mcp__clio__clio-run"},
                               ]}}),
            _line({"message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "tu1",
                 "content": r"Output too large. saved to C:\x\tool-results\big.txt"},
                {"type": "tool_result", "tool_use_id": "tu2", "content": "hello"},
            ]}}),
        ])

    def tearDown(self):
        self.fx.cleanup()

    def test_offloaded_bytes_charged_to_producing_tool_by_id(self):
        agg = aggregate_transcript(
            os.path.join(self.fx.wf_dir, "agent-aaa.jsonl"), self.fx.tool_results
        )
        # Bash offload -> the on-disk file size (500), not the short stub length.
        self.assertEqual(agg.tool_bytes["Bash"], 500)
        # Inline clio result -> its own byte length.
        self.assertEqual(agg.tool_bytes["mcp__clio__clio-run"], len("hello"))

    def test_offload_filename_does_not_decide_the_tool(self):
        # big.txt carries no tool name; only the tool_use_id maps it to Bash.
        agg = aggregate_transcript(
            os.path.join(self.fx.wf_dir, "agent-aaa.jsonl"), self.fx.tool_results
        )
        self.assertNotIn("big", agg.tool_bytes)
        self.assertEqual(sum(agg.tool_bytes.values()), 500 + len("hello"))


class ReconcileAndRoleTest(unittest.TestCase):
    def setUp(self):
        self.fx = ExportFixture()
        # BUILD agent: 2 tool calls
        self.fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _line({"message": {"role": "assistant", "usage": _usage(cw=100, cr=1000, out=5, m5=80, h1=20),
                               "content": [
                                   {"type": "tool_use", "id": "t1", "name": "Read"},
                                   {"type": "tool_use", "id": "t2", "name": "Read"},
                               ]}}),
        ])
        # REFS agent: 1 tool call
        self.fx.write_agent("bbb", [
            _line({"message": {"role": "user", "content": "You are the REFS step."}}),
            _line({"message": {"role": "assistant", "usage": _usage(cw=50, cr=500, out=3, m5=50),
                               "content": [{"type": "tool_use", "id": "t3", "name": "Bash"}]}}),
        ])
        self.fx.write_journal([_line({"type": "started"}), _line({"type": "result"})])
        self.fx.write_meta(agent_count=2, total_tool_calls=3)
        self.session = export_mod.discover(self.fx.root)
        self.report = Report(self.session, metrics.CostConfig())

    def tearDown(self):
        self.fx.cleanup()

    def test_reconcile_matches_meta(self):
        rows = self.report.reconcile()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertTrue(row.agents_ok)
        self.assertTrue(row.tool_calls_ok)
        self.assertEqual(row.agents_seen, 2)
        self.assertEqual(row.tool_calls_seen, 3)

    def test_reconcile_flags_mismatch(self):
        self.fx.write_meta(agent_count=2, total_tool_calls=99)
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        self.assertFalse(report.reconcile()[0].tool_calls_ok)

    def test_by_role_split(self):
        table = self.report.by_role_table()
        roles = {label: vals for label, vals in table.rows}
        self.assertIn("BUILD", roles)
        self.assertIn("REFS", roles)
        self.assertEqual(roles["BUILD"]["n"], 1)
        self.assertEqual(roles["BUILD"]["cache_read"], 1000)
        self.assertEqual(roles["REFS"]["cache_read"], 500)

    def test_effective_weight_uses_ttl_breakdown(self):
        # 5m tokens: 80+50=130, 1h tokens: 20 -> blended weight.
        expected = (130 * 1.25 + 20 * 2.0) / 150
        self.assertAlmostEqual(self.report.effective_w, expected)


class NormalizationTest(unittest.TestCase):
    def setUp(self):
        self.fx = ExportFixture()
        self.fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _line({"message": {"role": "assistant", "usage": _usage(cr=1000, out=10, m5=100),
                               "content": [{"type": "tool_use", "id": "t1", "name": "Read"}]}}),
        ])
        self.fx.write_journal([
            _line({"type": "result", "result": {"pageSchemas": {"main": "Applicant_FormPage"}}}),
            _line({"type": "result", "result": {"pageSchemas": {"main": "Applicant_FormPage"}}}),
        ])

    def tearDown(self):
        self.fx.cleanup()

    def test_distinct_built_pages_counted_once(self):
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        self.assertEqual(report.built_pages, {"Applicant_FormPage"})
        self.assertEqual(report.page_count(), 1)

    def test_pages_override(self):
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig(), pages_override=4)
        self.assertEqual(report.page_count(), 4)


if __name__ == "__main__":
    unittest.main()
