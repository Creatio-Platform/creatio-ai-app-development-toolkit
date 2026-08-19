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


class MultiSessionTest(unittest.TestCase):
    """Two session UUID subdirectories under one export root.

    Each session offloads a result to its OWN tool-results/. The counter must
    attribute each workflow's offloaded bytes to the directory of the session
    it belongs to -- not to whichever session was discovered last (R9).
    """

    def _write_session(self, root, sess, wf_name, agent_id, offload_name, size):
        wf_dir = os.path.join(root, sess, "subagents", "workflows", wf_name)
        tr_dir = os.path.join(root, sess, "tool-results")
        os.makedirs(wf_dir)
        os.makedirs(tr_dir)
        with open(os.path.join(tr_dir, offload_name), "w", encoding="utf-8") as f:
            f.write("X" * size)
        with open(os.path.join(wf_dir, f"agent-{agent_id}.jsonl"), "w", encoding="utf-8") as f:
            f.writelines([
                _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
                _line({"message": {"role": "assistant", "usage": _usage(inp=1, cw=1),
                                   "content": [{"type": "tool_use", "id": "t1", "name": "Bash"}]}}),
                _line({"message": {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1",
                     "content": rf"Output too large. saved to C:\x\tool-results\{offload_name}"},
                ]}}),
            ])

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="cc-multi-")
        # Session A offloads 500 bytes; session B offloads 900 bytes.
        self._write_session(self.root, "sess-A", "wf_a", "aaa", "a.txt", 500)
        self._write_session(self.root, "sess-B", "wf_b", "bbb", "b.txt", 900)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_each_workflow_keeps_its_own_tool_results_dir(self):
        session = export_mod.discover(self.root)
        by_name = {wf.name: wf for wf in session.workflows}
        self.assertTrue(by_name["wf_a"].tool_results_dir.endswith(os.path.join("sess-A", "tool-results")))
        self.assertTrue(by_name["wf_b"].tool_results_dir.endswith(os.path.join("sess-B", "tool-results")))

    def test_offloaded_bytes_attributed_per_session(self):
        report = Report(export_mod.discover(self.root), metrics.CostConfig())
        stage_bytes = {label: sum(agg.tool_bytes.values()) for label, agg in report.stage_aggs}
        # Both offloads are found in their own session's dir: full on-disk sizes,
        # not the short inline stub length.
        self.assertEqual(stage_bytes["wf_a (1 agents)"], 500)
        self.assertEqual(stage_bytes["wf_b (1 agents)"], 900)


class ByToolFoldTest(unittest.TestCase):
    """by_tool_table shows the top-N tools, folds the long tail into one row,
    and the TOTAL still reconciles to the TRUE call/byte counts rather than the
    top-N sum (R5)."""

    def setUp(self):
        self.fx = ExportFixture()
        # One agent issuing four distinct tools: Read x3, Bash x2, Grep x1, Glob x1.
        self.fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _line({"message": {"role": "assistant", "usage": _usage(inp=1),
                               "content": [
                                   {"type": "tool_use", "id": "r1", "name": "Read"},
                                   {"type": "tool_use", "id": "r2", "name": "Read"},
                                   {"type": "tool_use", "id": "r3", "name": "Read"},
                                   {"type": "tool_use", "id": "b1", "name": "Bash"},
                                   {"type": "tool_use", "id": "b2", "name": "Bash"},
                                   {"type": "tool_use", "id": "g1", "name": "Grep"},
                                   {"type": "tool_use", "id": "l1", "name": "Glob"},
                               ]}}),
        ])
        self.report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())

    def tearDown(self):
        self.fx.cleanup()

    def test_long_tail_folds_and_total_reconciles(self):
        table = self.report.by_tool_table(limit=2)
        labels = [label for label, _ in table.rows]
        # Top 2 by call count shown explicitly; the remaining 2 fold into one row.
        self.assertIn("Read", labels)
        self.assertIn("Bash", labels)
        self.assertIn("(+2 more tools)", labels)
        self.assertNotIn("Grep", labels)
        self.assertNotIn("Glob", labels)
        # TOTAL reconciles to the true call count (7), not the top-2 sum (5).
        self.assertEqual(table.total_values()["calls"], 7)


class OffloadNotFoundTest(unittest.TestCase):
    """A tool_result that references an offloaded file no longer on disk
    (pruned/rotated tool-results/) charges the inline stub length, not 0, and
    does not raise (R9)."""

    def setUp(self):
        self.fx = ExportFixture()
        # Reference gone.txt but never write it into tool-results/.
        self.fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _line({"message": {"role": "assistant", "usage": _usage(inp=1),
                               "content": [{"type": "tool_use", "id": "t1", "name": "Bash"}]}}),
            _line({"message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t1",
                 "content": r"Output too large. saved to C:\x\tool-results\gone.txt"},
            ]}}),
        ])

    def tearDown(self):
        self.fx.cleanup()

    def test_missing_offload_file_falls_back_to_stub_length(self):
        stub = r"Output too large. saved to C:\x\tool-results\gone.txt"
        agg = aggregate_transcript(
            os.path.join(self.fx.wf_dir, "agent-aaa.jsonl"), self.fx.tool_results
        )
        self.assertEqual(agg.tool_bytes["Bash"], len(stub.encode("utf-8")))


class FallbackWeightIntegrationTest(unittest.TestCase):
    """cache_write volume with NO TTL breakdown, driven end-to-end through
    Report: effective_w blends the 5m fallback rate (1.25) rather than 0.0, so
    the (typically largest) cache-write cost term is not silently dropped (R4)."""

    def setUp(self):
        self.fx = ExportFixture()
        self.fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _line({"message": {"role": "assistant",
                               # cache-write volume, no m5/h1 TTL split.
                               "usage": _usage(inp=10, cw=1000),
                               "content": [{"type": "tool_use", "id": "t1", "name": "Bash"}]}}),
        ])
        self.report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())

    def tearDown(self):
        self.fx.cleanup()

    def test_effective_weight_is_the_5m_fallback(self):
        self.assertEqual(
            self.report.effective_w, metrics.CostConfig().cache_write_5m_weight
        )

    def test_cache_write_term_is_not_dropped(self):
        # weighted_total = input*1 + cache_write*1.25 = 10 + 1250.
        self.assertAlmostEqual(self.report.weighted_total(), 10 + 1.25 * 1000)


if __name__ == "__main__":
    unittest.main()
