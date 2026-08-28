"""Integration tests over a small synthetic session export.

Covers offloaded-byte attribution by tool-use id (R9), journal reconciliation
(R8), the by-role split (R5), per-built-page normalization (R7), and bare
subagents -- the ones spawned with the plain Agent tool, which live directly in
``subagents/`` with no workflow directory -- without needing the
multi-hundred-MB real export.
"""
import json
import os
import shutil
import tempfile
import unittest

import export as export_mod
import metrics
import report as report_mod
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


def _assistant_record(msg_id=None, usage=None, content=None, timestamp=None):
    """One JSONL record for an assistant turn, optionally carrying a
    ``message.id`` -- the field ENG-95856's dedup keys on. A real turn is
    split across several such records (thinking / text / tool_use), each
    repeating the same ``message.id`` and (mostly) the same ``usage``."""
    message = {"role": "assistant"}
    if msg_id is not None:
        message["id"] = msg_id
    if usage is not None:
        message["usage"] = usage
    if content is not None:
        message["content"] = content
    record = {"message": message}
    if timestamp is not None:
        # ISO-8601, the axis first_timestamp_ms() converts to epoch ms so a
        # workflow stage and a bare-agent stage can be ordered together.
        record["timestamp"] = timestamp
    return _line(record)


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
        return path

    def write_bare_agent(self, agent_id, lines, description=None, agent_type=None,
                         meta=True, meta_raw=None):
        """A subagent spawned with the plain Agent tool: transcript straight in
        ``subagents/``, with the sibling meta the harness writes beside it.

        ``meta=False`` omits that file (the missing-meta case). ``meta_raw``
        writes the given text verbatim instead of a JSON object, which is how a
        test reaches the reader's other degrade paths -- invalid JSON, or valid
        JSON that is not an object. Both are reachable in a real export: a meta
        file can be truncated mid-copy.
        """
        subagents = os.path.dirname(os.path.dirname(self.wf_dir))
        path = os.path.join(subagents, f"agent-{agent_id}.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        meta_path = os.path.join(subagents, f"agent-{agent_id}.meta.json")
        if meta_raw is not None:
            with open(meta_path, "w", encoding="utf-8") as f:
                f.write(meta_raw)
        elif meta:
            payload = {"spawnDepth": 1}
            if description is not None:
                payload["description"] = description
            if agent_type is not None:
                payload["agentType"] = agent_type
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(payload, f)
        return path

    def bare_meta_path(self, agent_id):
        """Where write_bare_agent puts the sibling meta for ``agent_id``."""
        subagents = os.path.dirname(os.path.dirname(self.wf_dir))
        return os.path.join(subagents, f"agent-{agent_id}.meta.json")

    def write_offload(self, name, size):
        with open(os.path.join(self.tool_results, name), "w", encoding="utf-8") as f:
            f.write("X" * size)

    def write_journal(self, lines):
        with open(os.path.join(self.wf_dir, "journal.jsonl"), "w", encoding="utf-8") as f:
            f.writelines(lines)

    def write_meta(self, agent_count, total_tool_calls, start_time=None):
        path = os.path.join(self.session, "workflows", "wf_a.json")
        payload = {"agentCount": agent_count, "totalToolCalls": total_tool_calls}
        if start_time is not None:
            payload["startTime"] = start_time
            payload["workflowName"] = "creatio-freedom-build-executor"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)


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

    def test_non_string_page_schema_values_are_ignored(self):
        # A journal whose pageSchemas carries a nested object (not a plain
        # schema-name string) must not leak into built_pages, or sorted()
        # in summary()/page_count() would raise TypeError on mixed types.
        self.fx.write_journal([
            _line({"type": "result", "result": {"pageSchemas": {
                "main": "Applicant_FormPage",
                "nested": {"unexpected": "object"},
                "list": ["also", "unexpected"],
            }}}),
        ])
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        self.assertEqual(report.built_pages, {"Applicant_FormPage"})
        # sorted() over the set must not raise.
        self.assertEqual(report.summary()["built_pages"], ["Applicant_FormPage"])

    def test_page_count_defaulted_is_false_when_a_page_was_built(self):
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        self.assertFalse(report.summary()["page_count_defaulted"])

    def test_page_count_defaulted_is_false_with_an_explicit_override(self):
        # An override means the caller supplied the count on purpose --
        # never "silently fell back to 1", even with no built page recorded.
        empty_fx = ExportFixture()
        self.addCleanup(empty_fx.cleanup)
        empty_fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _line({"message": {"role": "assistant", "usage": _usage(cr=100, out=1),
                               "content": [{"type": "tool_use", "id": "t1", "name": "Read"}]}}),
        ])
        report = Report(export_mod.discover(empty_fx.root), metrics.CostConfig(),
                         pages_override=4)
        self.assertFalse(report.summary()["page_count_defaulted"])

    def test_page_count_defaulted_is_true_with_no_built_page_and_no_override(self):
        # No journal recording a built page, and no --pages override: the
        # fallback to page_count()==1 must be reported explicitly rather than
        # read as a real single-page run (Done-criterion #4, ENG-95856).
        empty_fx = ExportFixture()
        self.addCleanup(empty_fx.cleanup)
        empty_fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _line({"message": {"role": "assistant", "usage": _usage(cr=100, out=1),
                               "content": [{"type": "tool_use", "id": "t1", "name": "Read"}]}}),
        ])
        report = Report(export_mod.discover(empty_fx.root), metrics.CostConfig())
        self.assertEqual(report.page_count(), 1)
        self.assertTrue(report.summary()["page_count_defaulted"])


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


class PerStageTtlWeightTest(unittest.TestCase):
    """Each stage/role is weighted by its OWN cache-write TTL mix, not the
    global blend. The driver session writes at 1h (x2.0) and the subagents at
    5m (x1.25); a single global weight would shift cost off the driver stage
    onto the subagents. The run total is unchanged (the per-TTL-bucket sums are
    identical either way) -- this guards the split, which N7/ENG-95538 relies on
    (discovery+plan is ~24% of cost, not ~20%)."""

    def setUp(self):
        self.fx = ExportFixture()
        # main (driver): 100 cache-write, ALL 1-hour TTL.
        self.fx.write_main([
            _line({"message": {"role": "assistant", "usage": _usage(cw=100, h1=100)}}),
        ])
        # one subagent: 100 cache-write, ALL 5-minute TTL.
        self.fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _line({"message": {"role": "assistant", "usage": _usage(cw=100, m5=100),
                               "content": [{"type": "tool_use", "id": "t1", "name": "Read"}]}}),
        ])
        self.report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())

    def tearDown(self):
        self.fx.cleanup()

    def test_stage_weight_follows_each_stage_ttl(self):
        weighted = {label: vals["weighted"] for label, vals in self.report.by_stage_table().rows}
        main = next(v for k, v in weighted.items() if k.startswith("main"))
        wf = next(v for k, v in weighted.items() if k.startswith("wf_a"))
        # main all 1h -> x2.0 -> 200; subagent all 5m -> x1.25 -> 125.
        # The global blend here is 1.625, which would give BOTH 162.5 -- the
        # mis-attribution this test guards against.
        self.assertAlmostEqual(main, 100 * 2.0)
        self.assertAlmostEqual(wf, 100 * 1.25)

    def test_total_is_unchanged_by_per_stage_weighting(self):
        # Per-bucket sum: 100*1.25 (5m) + 100*2.0 (1h) = 325. Both the by-stage
        # TOTAL row and weighted_total() must still agree with it.
        self.assertAlmostEqual(self.report.weighted_total(), 100 * 1.25 + 100 * 2.0)
        self.assertAlmostEqual(
            self.report.by_stage_table().total_values()["weighted"],
            100 * 1.25 + 100 * 2.0,
        )


class FriendlyLabelTest(unittest.TestCase):
    """Stage labels come from workflows/<wf>.json `workflowName` (minus the
    `creatio-` prefix); repeated workflows are numbered round 1/2/3 in
    start-time order -- never the opaque run-id directory name. A workflow
    with no readable name falls back to its raw run id."""

    def _write_wf(self, run_id, workflow_name, start):
        wf_dir = os.path.join(self.root, "sess-1", "subagents", "workflows", run_id)
        os.makedirs(wf_dir)
        meta_dir = os.path.join(self.root, "sess-1", "workflows")
        os.makedirs(meta_dir, exist_ok=True)
        with open(os.path.join(wf_dir, f"agent-{run_id}.jsonl"), "w", encoding="utf-8") as f:
            f.writelines([
                _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
                _line({"message": {"role": "assistant", "usage": _usage(cr=1000, m5=100),
                                   "content": [{"type": "tool_use", "id": "t", "name": "Read"}]}}),
            ])
        if workflow_name is not None:
            with open(os.path.join(meta_dir, run_id + ".json"), "w", encoding="utf-8") as f:
                json.dump({"workflowName": workflow_name, "startTime": start,
                           "agentCount": 1, "totalToolCalls": 1}, f)

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="cc-labels-")
        # two runs of the build workflow (written out of start-time order) and
        # one single-run analysis workflow.
        self._write_wf("wf_bbb", "creatio-freedom-build-executor", 200)
        self._write_wf("wf_aaa", "creatio-freedom-build-executor", 100)
        self._write_wf("wf_ccc", "creatio-classic-behaviour-analysis", 50)
        self.report = Report(export_mod.discover(self.root), metrics.CostConfig())

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_labels_use_workflow_name_and_round_numbers(self):
        labels = self.report.workflow_labels
        self.assertEqual(labels["wf_aaa"], "freedom-build-executor · round 1")  # earlier start
        self.assertEqual(labels["wf_bbb"], "freedom-build-executor · round 2")
        self.assertEqual(labels["wf_ccc"], "classic-behaviour-analysis")  # single run, no round
        # no raw run id leaks into the by-stage labels
        stage_labels = [lbl for lbl, _ in self.report.stage_aggs]
        self.assertTrue(any("round 1" in s for s in stage_labels))
        self.assertFalse(any(s.startswith("wf_") for s in stage_labels))

    def test_reconcile_carries_friendly_label_and_keeps_run_id(self):
        by_run = {r.run_id: r for r in self.report.reconcile()}
        self.assertEqual(by_run["wf_ccc"].workflow, "classic-behaviour-analysis")
        self.assertEqual(by_run["wf_aaa"].workflow, "freedom-build-executor · round 1")

    def test_missing_workflow_name_falls_back_to_run_id(self):
        self._write_wf("wf_nometa", None, None)  # no meta json written
        report = Report(export_mod.discover(self.root), metrics.CostConfig())
        self.assertEqual(report.workflow_labels["wf_nometa"], "wf_nometa")

    def test_non_object_meta_json_degrades_and_does_not_crash(self):
        # A meta file that is valid JSON but not an object (here ``null``) must
        # degrade to the raw run id, not raise. _workflow_labels runs in
        # Report.__init__, so without the isinstance guard EVERY section --
        # summary included -- would crash with AttributeError. reconcile()
        # exercises the same guard in _read_meta.
        self._write_wf("wf_null", None, None)  # writes the agent dir, no meta json
        meta_dir = os.path.join(self.root, "sess-1", "workflows")
        with open(os.path.join(meta_dir, "wf_null.json"), "w", encoding="utf-8") as f:
            f.write("null")
        report = Report(export_mod.discover(self.root), metrics.CostConfig())
        self.assertEqual(report.workflow_labels["wf_null"], "wf_null")
        # _read_meta must also survive the non-object meta (agents/tool counts
        # simply unknown -> reconcile reports them as None-backed, never raises).
        by_run = {r.run_id: r for r in report.reconcile()}
        self.assertIn("wf_null", by_run)
        self.assertIsNone(by_run["wf_null"].agents_meta)


class SymlinkConfinementTest(unittest.TestCase):
    """A file that resolves outside the export root (symlink escape) is skipped,
    while a genuine in-tree file is kept -- discovery stays confined to the
    directory the caller named (export.within_root)."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="cc-confine-")
        self.outside = tempfile.mkdtemp(prefix="cc-outside-")
        self.wf_dir = os.path.join(self.root, "sess-1", "subagents", "workflows", "wf_a")
        os.makedirs(self.wf_dir)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.outside, ignore_errors=True)

    def _agent_line(self):
        return _line({"message": {"role": "user", "content": "You are a BUILD agent."}})

    def test_symlinked_agent_pointing_outside_root_is_skipped(self):
        # a genuine agent transcript living inside the export
        with open(os.path.join(self.wf_dir, "agent-in.jsonl"), "w", encoding="utf-8") as f:
            f.write(self._agent_line())
        # a foreign transcript outside the export, linked in under a matching name
        foreign = os.path.join(self.outside, "secret.jsonl")
        with open(foreign, "w", encoding="utf-8") as f:
            f.write(self._agent_line())
        try:
            os.symlink(foreign, os.path.join(self.wf_dir, "agent-esc.jsonl"))
        except (OSError, NotImplementedError) as exc:
            self.skipTest(f"symlink creation not permitted here: {exc}")

        session = export_mod.discover(self.root)
        names = sorted(os.path.basename(p) for p in session.agent_files)
        self.assertEqual(names, ["agent-in.jsonl"])  # escaping symlink dropped


class UsageDedupTest(unittest.TestCase):
    """ENG-95856: one API message written to the transcript as several JSONL
    records must be charged once, not once per record -- and the FINAL
    record's ``output_tokens`` must win, since duplicates carry a provisional
    value that grows to the final one (a first-wins dedup understates output
    by roughly half)."""

    def setUp(self):
        self.fx = ExportFixture()

    def tearDown(self):
        self.fx.cleanup()

    def test_duplicate_records_same_message_id_counted_once_last_output_wins(self):
        # Same message.id, identical input/cache_* across all three records
        # (as real duplicates do), but a provisional output_tokens growing
        # 3 -> 3 -> 320 -- exactly the shape measured on the real defect.
        lines = [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _assistant_record("msg_1", _usage(inp=10, cw=100, cr=1000, out=3),
                               content=[{"type": "thinking", "text": "..."}]),
            _assistant_record("msg_1", _usage(inp=10, cw=100, cr=1000, out=3),
                               content=[{"type": "text", "text": "..."}]),
            _assistant_record("msg_1", _usage(inp=10, cw=100, cr=1000, out=320),
                               content=[{"type": "tool_use", "id": "t1", "name": "Read"}]),
        ]
        self.fx.write_agent("aaa", lines)
        agg = aggregate_transcript(os.path.join(self.fx.wf_dir, "agent-aaa.jsonl"))

        self.assertEqual(agg.turns, 1)               # one message, not three records
        self.assertEqual(agg.output, 320)             # FINAL value, not first (3) or sum (326)
        self.assertEqual(agg.input, 10)               # not summed to 30
        self.assertEqual(agg.cache_write, 100)        # not summed to 300
        self.assertEqual(agg.cache_read, 1000)        # not summed to 3000
        # Tool blocks are never deduplicated: each record's content is
        # distinct, so the tool_use on the third record must still be seen.
        self.assertEqual(agg.tool_calls["Read"], 1)

    def test_first_wins_dedup_is_rejected(self):
        # A dedup that kept the FIRST record per message.id (rather than the
        # last) would report output=3, not 320 -- guard the direction.
        lines = [
            _assistant_record("msg_1", _usage(out=3)),
            _assistant_record("msg_1", _usage(out=3)),
            _assistant_record("msg_1", _usage(out=320)),
        ]
        self.fx.write_agent("aaa", lines)
        agg = aggregate_transcript(os.path.join(self.fx.wf_dir, "agent-aaa.jsonl"))
        self.assertNotEqual(agg.output, 3)
        self.assertEqual(agg.output, 320)

    def test_records_without_message_id_are_not_deduplicated(self):
        # Pre-existing behaviour preserved: no id means no dedup key, so each
        # usage-bearing record is still counted once, in file order.
        lines = [
            _assistant_record(None, _usage(cr=100)),
            _assistant_record(None, _usage(cr=200)),
        ]
        self.fx.write_agent("aaa", lines)
        agg = aggregate_transcript(os.path.join(self.fx.wf_dir, "agent-aaa.jsonl"))
        self.assertEqual(agg.turns, 2)
        self.assertEqual(agg.cache_read, 300)

    def test_distinct_message_ids_both_counted(self):
        lines = [
            _assistant_record("msg_1", _usage(cr=100)),
            _assistant_record("msg_2", _usage(cr=200)),
        ]
        self.fx.write_agent("aaa", lines)
        agg = aggregate_transcript(os.path.join(self.fx.wf_dir, "agent-aaa.jsonl"))
        self.assertEqual(agg.turns, 2)
        self.assertEqual(agg.cache_read, 300)


def _bare_lines(cache_read, timestamp=None, tool=None):
    """A one-turn bare-agent transcript. Its opening prompt deliberately does
    NOT use the workflow role vocabulary -- that is what a real one looks like."""
    user = {"message": {"role": "user",
                        "content": "You are running the classic-ui-expert skill."}}
    if timestamp is not None:
        user["timestamp"] = timestamp
    content = [{"type": "tool_use", "id": "bt1", "name": tool}] if tool else None
    return [
        _line(user),
        _assistant_record(msg_id="bm1",
                          usage=_usage(inp=1, cw=20, cr=cache_read, out=2, m5=20),
                          content=content),
    ]


class _BareAgentExportTestCase(unittest.TestCase):
    """Shared fixture for the bare-subagent tests: a main transcript plus one
    single-agent workflow, which each subclass then adds bare agents to.

    No ``test_`` methods of its own -- it contributes nothing to the suite by
    itself, the same pattern ``_CompareExportTestCase`` uses in
    ``tests/test_cost_counter.py``. Subclasses vary the workflow through the
    three attributes below instead of restating the whole fixture; seven copies
    of it is what SonarCloud's duplication gate caught.
    """

    #: epoch-ms ``startTime`` for the run file, or None to omit the run file
    #: entirely -- the "workflow with no run file" case.
    workflow_start_time = 2000
    #: ISO timestamp on the workflow agent's turn, for stage-ordering tests.
    workflow_agent_timestamp = None
    #: the workflow agent's cache_read, so a test can tie it with a bare agent.
    workflow_agent_cache_read = 1000

    def setUp(self):
        self.fx = ExportFixture()
        self.fx.write_main([
            _assistant_record(msg_id="main1", usage=_usage(inp=5, cw=40, cr=200, out=8, h1=40)),
        ])
        self.fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _assistant_record(msg_id="m1", timestamp=self.workflow_agent_timestamp,
                              usage=_usage(cw=100, cr=self.workflow_agent_cache_read,
                                           out=10, m5=100)),
        ])
        if self.workflow_start_time is not None:
            self.fx.write_meta(agent_count=1, total_tool_calls=0,
                               start_time=self.workflow_start_time)

    def tearDown(self):
        self.fx.cleanup()

    def _report(self):
        return Report(export_mod.discover(self.fx.root), metrics.CostConfig())

    def _stage_labels(self):
        """Stage labels with the main driver stage (always index 0) dropped."""
        return [label for label, _ in self._report().stage_aggs][1:]


class BareSubagentTest(_BareAgentExportTestCase):
    """A subagent spawned with the plain Agent tool writes its transcript to
    ``<session>/subagents/agent-<id>.jsonl`` with no workflow directory. Globbing
    only for ``subagents/workflows`` skipped those files, so their entire cost
    was missing from every total -- and the same stage counted on one side of a
    ``--compare`` (where it ran as a workflow) and not on the other.
    """

    def test_discovery_finds_a_transcript_with_no_workflow_directory(self):
        path = self.fx.write_bare_agent(
            "bbb", _bare_lines(500), description="Classic UI behaviour analysis",
            agent_type="general-purpose")
        session = export_mod.discover(self.fx.root)
        self.assertEqual(len(session.bare_agents), 1)
        bare = session.bare_agents[0]
        # discover() realpaths the export root, which on Windows expands an
        # 8.3 short path segment in the temp dir -- compare resolved paths.
        self.assertEqual(bare.path, os.path.realpath(path))
        self.assertEqual(bare.label, "Classic UI behaviour analysis")
        self.assertEqual(bare.agent_type, "general-purpose")
        # It resolves offloaded bytes against its own session's tool-results.
        self.assertEqual(bare.tool_results_dir, os.path.realpath(self.fx.tool_results))
        # ... and it is a subagent, so the agents headline counts it.
        self.assertIn(os.path.realpath(path), session.agent_files)
        self.assertEqual(len(session.agent_files), 2)

    def test_a_session_with_only_bare_agents_is_still_discovered(self):
        # The regression at its worst: no `workflows` directory anywhere under
        # `subagents`, so the old glob matched nothing and the export read as
        # having no subagents at all.
        shutil.rmtree(os.path.dirname(self.fx.wf_dir))
        self.fx.write_bare_agent("bbb", _bare_lines(500), description="analysis")
        session = export_mod.discover(self.fx.root)
        self.assertEqual(session.workflows, [])
        self.assertEqual(len(session.bare_agents), 1)
        self.assertEqual(len(session.agent_files), 1)

    def test_its_cost_lands_in_the_totals_and_gets_its_own_stage_row(self):
        before = self._report()
        self.fx.write_bare_agent("bbb", _bare_lines(500),
                                 description="Classic UI behaviour analysis",
                                 agent_type="general-purpose")
        after = self._report()

        self.assertEqual(after.totals.cache_read, before.totals.cache_read + 500)
        self.assertGreater(after.weighted_total(), before.weighted_total())
        self.assertEqual(after.summary()["agents"], 2)

        labels = [label for label, _ in after.stage_aggs]
        self.assertIn("Classic UI behaviour analysis (1 agent)", labels)
        self.assertEqual(len(labels), len(before.stage_aggs) + 1)

        # The by-stage table reconciles to the run total, bare agent included.
        table = after.by_stage_table()
        rows = {label: values for label, values in table.rows}
        self.assertEqual(
            rows["Classic UI behaviour analysis (1 agent)"]["cache_read"], 500)
        self.assertEqual(table.total_values()["cache_read"], after.totals.cache_read)

    def test_the_stage_row_is_marked_agent_not_workflow_subagents(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500), description="analysis")
        table = self._report().by_stage_table()
        kinds = {label: values["kind"] for label, values in table.rows}
        self.assertEqual(kinds["analysis (1 agent)"], "agent")
        self.assertEqual(kinds["main (discovery+plan)"], "main")
        self.assertEqual(kinds["freedom-build-executor (1 agents)"], "subagents")

    def test_the_role_is_the_recorded_agent_type_not_a_parsed_junk_role(self):
        # "You are running the ..." parses to a role called RUNNING, which would
        # sit in the by-role table as if it were a real workflow role.
        self.fx.write_bare_agent("bbb", _bare_lines(500), description="analysis",
                                 agent_type="general-purpose")
        roles = {label: values for label, values in self._report().by_role_table().rows}
        self.assertIn("general-purpose", roles)
        self.assertNotIn("RUNNING", roles)
        self.assertEqual(roles["general-purpose"]["n"], 1)
        self.assertEqual(roles["general-purpose"]["cache_read"], 500)

    def test_a_missing_meta_costs_the_label_and_role_never_the_cost(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500), meta=False)
        report = self._report()
        self.assertEqual(report.totals.cache_read, 1700)   # 200 main + 1000 wf + 500 bare
        labels = [label for label, _ in report.stage_aggs]
        self.assertIn("bbb (1 agent)", labels)      # falls back to the agent id
        roles = {label for label, _ in report.by_role_table().rows}
        self.assertIn("?", roles)
        self.assertNotIn("RUNNING", roles)

    def test_stages_stay_in_run_order_across_both_kinds(self):
        # One axis, two clocks: the workflow's epoch-ms startTime (2000) against
        # the bare agent's ISO timestamp. Appending bare agents last would print
        # the earliest stage at the bottom.
        #
        # Each subcase writes its OWN agent id and compares the FULL label list.
        # Collapsing the result to "bare"/"workflow" hid how many stages there
        # were, and reusing one filename across subcases made the second case
        # depend on "w" truncating the first -- correct, but only by accident.
        early = "1970-01-01T00:00:01.000Z"     # 1000 ms -> before the workflow
        late = "1970-01-01T00:00:03.000Z"      # 3000 ms -> after it
        cases = (
            ("bbb", early, ["analysis-bbb (1 agent)", "freedom-build-executor (1 agents)"]),
            ("ccc", late, ["freedom-build-executor (1 agents)", "analysis-ccc (1 agent)"]),
        )
        for agent_id, stamp, expected in cases:
            with self.subTest(stamp=stamp):
                path = self.fx.write_bare_agent(
                    agent_id, _bare_lines(500, timestamp=stamp),
                    description=f"analysis-{agent_id}")
                try:
                    # index 0 is always the main driver stage
                    labels = [label for label, _ in self._report().stage_aggs][1:]
                    self.assertEqual(labels, expected)
                finally:
                    # each subcase writes its own id, so clear it before the
                    # next one rather than relying on a filename collision
                    os.remove(path)
                    os.remove(self.fx.bare_meta_path(agent_id))

    def test_bare_agents_produce_no_cross_check_row(self):
        # There is no workflows/<wf>.json for a bare agent and never could be,
        # so it must not add an unverifiable n/a row to the reconcile table.
        self.fx.write_bare_agent("bbb", _bare_lines(500), description="analysis")
        report = self._report()
        self.assertEqual([row.run_id for row in report.reconcile()], ["wf_a"])
        # Not vacuous: the agent really was discovered and did get a stage row.
        self.assertIn("analysis (1 agent)", [label for label, _ in report.stage_aggs])

    def test_offloaded_bytes_of_a_bare_agent_resolve_against_tool_results(self):
        self.fx.write_offload("bare-big.txt", 700)
        lines = _bare_lines(500, tool="Bash")
        lines.append(_line({"message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "bt1",
             "content": "Output too large. saved to /t/tool-results/bare-big.txt"},
        ]}}))
        self.fx.write_bare_agent("bbb", lines, description="analysis")
        table = self._report().by_tool_table()
        tools = {label: values for label, values in table.rows}
        self.assertEqual(tools["Bash"]["bytes"], 700)

    def test_the_surviving_leftover_split_still_hides_no_spend(self):
        # A bare agent belongs to no workflow, so no attempt superseded it: it
        # counts as surviving. Dropping it from both sides would break the
        # identity leftover_totals() promises.
        self.fx.write_agent("ccc", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _assistant_record(msg_id="m2", usage=_usage(cr=300, out=1, m5=10)),
        ])
        self.fx.write_meta(agent_count=2, total_tool_calls=0, start_time=2000)
        self.fx.write_bare_agent("bbb", _bare_lines(500), description="analysis")
        report = self._report()
        surviving, leftover = report.leftover_totals()
        main_agg = report.stage_aggs[0][1]
        for field in ("input", "output", "cache_write", "cache_read"):
            self.assertEqual(
                getattr(surviving, field) + getattr(leftover, field)
                + getattr(main_agg, field),
                getattr(report.totals, field),
                field,
            )


if __name__ == "__main__":
    unittest.main()


class BareAgentMetaDegradeTest(_BareAgentExportTestCase):
    """Every branch of the bare agent's meta reader.

    The contract is "never raises: a missing, unparseable or non-object meta
    file costs the agent its label and role, never its cost". Only the missing
    branch was exercised, so the degrade promise and the two path-confinement
    calls this reader added rested on reading the code.
    """

    def _bare(self):
        session = export_mod.discover(self.fx.root)
        self.assertEqual(len(session.bare_agents), 1)
        return session.bare_agents[0], Report(session, metrics.CostConfig())

    def _assert_counted_but_unlabelled(self, agent_id="bbb"):
        """The whole point of degrading: the agent is still discovered and its
        cost still counted; only the label and role fall back."""
        bare, report = self._bare()
        self.assertIsNone(bare.description)
        self.assertIsNone(bare.agent_type)
        self.assertEqual(bare.label, agent_id)          # falls back to the id
        self.assertEqual(report.summary()["agents"], 2)  # workflow agent + this one
        roles = [role for _, _, role, _ in report.agent_rows]
        self.assertIn("?", roles)
        return report

    def test_invalid_json_degrades_without_raising(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500), meta_raw="{not json at all")
        report = self._assert_counted_but_unlabelled()
        self.assertIn("bbb (1 agent)", [label for label, _ in report.stage_aggs])

    def test_a_truncated_meta_degrades_without_raising(self):
        # the shape a half-copied export actually produces
        self.fx.write_bare_agent("bbb", _bare_lines(500),
                                 meta_raw='{"spawnDepth": 1, "descrip')
        self._assert_counted_but_unlabelled()

    def test_a_json_list_is_not_an_object_and_degrades(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500), meta_raw='["description"]')
        self._assert_counted_but_unlabelled()

    def test_a_json_scalar_is_not_an_object_and_degrades(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500), meta_raw='"just a string"')
        self._assert_counted_but_unlabelled()

    def test_an_empty_meta_file_degrades(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500), meta_raw="")
        self._assert_counted_but_unlabelled()

    def test_a_valid_meta_with_no_agent_type_still_yields_a_question_mark(self):
        # The README used to say `?` means the meta was missing or unusable.
        # This meta is neither -- it parses and carries a description.
        self.fx.write_bare_agent("bbb", _bare_lines(500), description="analysis")
        bare, report = self._bare()
        self.assertEqual(bare.label, "analysis")
        self.assertIsNone(bare.agent_type)
        self.assertEqual(report_mod._bare_agent_role(bare), "?")

    def test_a_non_string_agent_type_never_reaches_the_role_table(self):
        # A number here would land in by_role_table as a non-string label.
        self.fx.write_bare_agent(
            "bbb", _bare_lines(500),
            meta_raw='{"spawnDepth": 1, "description": "analysis", "agentType": 7}')
        bare, report = self._bare()
        self.assertIsNone(bare.agent_type)
        self.assertEqual(report_mod._bare_agent_role(bare), "?")
        for role in report.by_role_table().rows:
            self.assertIsInstance(role[0], str)

    def test_an_empty_agent_type_is_treated_as_absent(self):
        self.fx.write_bare_agent(
            "bbb", _bare_lines(500),
            meta_raw='{"spawnDepth": 1, "description": "analysis", "agentType": ""}')
        bare, _ = self._bare()
        self.assertIsNone(bare.agent_type)

    def test_a_non_string_description_is_treated_as_absent(self):
        self.fx.write_bare_agent(
            "bbb", _bare_lines(500),
            meta_raw='{"spawnDepth": 1, "description": {"a": 1}}')
        self._assert_counted_but_unlabelled()

    def test_a_meta_symlinked_outside_the_root_is_not_read(self):
        # The meta path is derived from the transcript path, so it is a second
        # place a symlink could carry the reader out of the export. The
        # analogous workflow-agent path has SymlinkConfinementTest; this one had
        # nothing.
        outside = tempfile.mkdtemp(prefix="cc-outside-meta-")
        self.addCleanup(shutil.rmtree, outside, True)
        foreign = os.path.join(outside, "foreign.json")
        with open(foreign, "w", encoding="utf-8") as f:
            json.dump({"description": "LEAKED", "agentType": "leaked-type"}, f)

        self.fx.write_bare_agent("bbb", _bare_lines(500), meta=False)
        try:
            os.symlink(foreign, self.fx.bare_meta_path("bbb"))
        except (OSError, NotImplementedError) as exc:
            self.skipTest(f"symlink creation not permitted here: {exc}")

        bare, report = self._bare()
        self.assertIsNone(bare.description)
        self.assertIsNone(bare.agent_type)
        self.assertNotIn("LEAKED", report.by_stage_table().render())
        # and the transcript is still counted -- confinement costs the label only
        self.assertEqual(report.summary()["agents"], 2)


class BareAgentLabelHygieneTest(_BareAgentExportTestCase):
    """`description` is free text written by the spawning model and it becomes a
    report label, so it is bounded and flattened at the trust boundary."""

    def _labels(self):
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        return [label for label, _ in report.stage_aggs], report

    def test_an_over_long_description_is_truncated(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500), description="A" * 400)
        labels, _ = self._labels()
        stage = next(l for l in labels if l.startswith("A"))
        # bounded, and the truncation is visible rather than silent
        self.assertLess(len(stage), 120)
        self.assertIn("...", stage)

    def test_newlines_are_flattened_so_the_text_table_stays_intact(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500),
                                 description="first line\nsecond line")
        labels, report = self._labels()
        self.assertIn("first line second line (1 agent)", labels)
        rendered = report.by_stage_table().render()
        # every rendered line is one table row -- no row split in half
        self.assertNotIn("second line\n", rendered.replace("first line second line", "x"))

    def test_control_characters_are_dropped(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500),
                                 description="analysis\x07\x00 done")
        labels, _ = self._labels()
        self.assertIn("analysis done (1 agent)", labels)

    def test_a_pipe_in_a_description_cannot_split_a_markdown_row(self):
        # Unescaped, this shifts every figure one header to the left and the
        # table silently misreports.
        self.fx.write_bare_agent("bbb", _bare_lines(500),
                                 description="analysis | 999 | 999")
        _, report = self._labels()
        md = report.by_stage_table().to_markdown().splitlines()
        header_cells = md[0].count("|")
        for row in md[2:]:
            self.assertEqual(row.count("|") - row.count("\\|"), header_cells,
                             f"row has a different column count: {row}")


class BareAgentLabelUniquenessTest(_BareAgentExportTestCase):
    """Two bare agents may carry the same `description` -- the harness has no
    rule against it -- and two identically-labelled stage rows are collapsed by
    any consumer that keys stages by label, including this suite."""

    def test_repeated_descriptions_are_numbered_in_run_order(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500, timestamp="1970-01-01T00:00:01.000Z"),
                                 description="analysis")
        self.fx.write_bare_agent("ccc", _bare_lines(700, timestamp="1970-01-01T00:00:03.000Z"),
                                 description="analysis")
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        labels = [label for label, _ in report.stage_aggs]
        self.assertIn("analysis · 1 (1 agent)", labels)
        self.assertIn("analysis · 2 (1 agent)", labels)
        # no label appears twice, so keying stages by label loses nothing
        self.assertEqual(len(labels), len(set(labels)))
        # the earlier agent is the one numbered 1
        stages = dict(report.stage_aggs)
        self.assertEqual(stages["analysis · 1 (1 agent)"].cache_read, 500)
        self.assertEqual(stages["analysis · 2 (1 agent)"].cache_read, 700)

    def test_a_description_that_occurs_once_is_left_alone(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500), description="analysis")
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        self.assertIn("analysis (1 agent)", [label for label, _ in report.stage_aggs])

    def test_both_rows_survive_into_the_per_agent_table(self):
        self.fx.write_bare_agent("bbb", _bare_lines(500, timestamp="1970-01-01T00:00:01.000Z"),
                                 description="analysis")
        self.fx.write_bare_agent("ccc", _bare_lines(700, timestamp="1970-01-01T00:00:03.000Z"),
                                 description="analysis")
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        ids = sorted(agent_id for _, agent_id, _, _ in report.agent_rows)
        self.assertEqual(ids, ["aaa", "bbb", "ccc"])


class StageOrderingAcrossKindsTest(_BareAgentExportTestCase):
    """The case the bare-agent time-axis fallback originally left out: a
    workflow whose run file is missing, so it has no ``startTime`` to key on.

    Ordering with a run file present is covered by
    ``BareSubagentTest.test_stages_stay_in_run_order_across_both_kinds``."""

    # no run file at all, and the workflow's own agent carries the timestamp
    # the fallback has to find
    workflow_start_time = None
    workflow_agent_timestamp = "1970-01-01T00:00:02.000Z"

    def test_a_workflow_with_no_run_file_still_sorts_by_when_it_ran(self):
        # No write_meta() at all: the run file is absent, so there is no
        # startTime. The workflow's own agent transcript is stamped 2000 ms, the
        # bare agent 3000 ms, so the workflow ran FIRST and must print first.
        # Keying workflows on startTime alone dropped it to the end of the
        # report -- on exactly the population the n/a cross-check rule covers.
        self.fx.write_bare_agent("bbb", _bare_lines(500, timestamp="1970-01-01T00:00:03.000Z"),
                                 description="analysis")
        labels = self._stage_labels()
        self.assertEqual(len(labels), 2)
        self.assertEqual(labels, ["wf_a (1 agents)", "analysis (1 agent)"])

    def test_a_workflow_with_no_usable_timestamp_anywhere_sorts_last(self):
        # The fallback is a fallback, not a new rule: with nothing to key on the
        # workflow still goes to the end, deterministically.
        self.fx.write_agent("aaa", [
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _assistant_record(msg_id="m1", usage=_usage(cw=100, cr=1000, out=10, m5=100)),
        ])
        self.fx.write_bare_agent("bbb", _bare_lines(500, timestamp="1970-01-01T00:00:03.000Z"),
                                 description="analysis")
        labels = self._stage_labels()
        self.assertEqual(labels, ["analysis (1 agent)", "wf_a (1 agents)"])


class PerAgentIdColumnTest(_BareAgentExportTestCase):
    """The per-agent table's id cell follows one rule for both kinds of agent."""

    def setUp(self):
        super().setUp()
        self.fx.write_bare_agent("bbb", _bare_lines(500), description="analysis")

    def test_a_workflow_agent_id_carries_no_file_extension(self):
        # The workflow branch hand-sliced the "agent-" prefix off and left the
        # ".jsonl" on, so it rendered "aaa.jsonl" beside the bare agent's "bbb".
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        ids = sorted(agent_id for _, agent_id, _, _ in report.agent_rows)
        self.assertEqual(ids, ["aaa", "bbb"])
        for agent_id in ids:
            self.assertNotIn(".jsonl", agent_id)

    def test_the_rendered_table_shows_both_ids_the_same_way(self):
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        rendered = report.per_agent_table().render()
        self.assertNotIn(".jsonl", rendered)


class AgentRowOrderTest(_BareAgentExportTestCase):
    """`agent_rows` is built in execution order now that bare agents share the
    axis, not in `session.workflows` declaration order. per_agent_table() sorts
    stably on -cache_read, so equal-cost rows follow that order."""

    # the workflow agent ties with the bare one on cache_read, so only the
    # build order can decide which row comes first
    workflow_agent_timestamp = "1970-01-01T00:00:02.000Z"
    workflow_agent_cache_read = 500

    def test_equal_cost_rows_follow_run_order(self):
        # Same cache_read as the workflow agent (500), but it ran first.
        self.fx.write_bare_agent("bbb", _bare_lines(500, timestamp="1970-01-01T00:00:01.000Z"),
                                 description="analysis")
        report = Report(export_mod.discover(self.fx.root), metrics.CostConfig())
        self.assertEqual([r[3].cache_read for r in report.agent_rows], [500, 500])
        self.assertEqual([agent_id for _, agent_id, _, _ in report.agent_rows],
                         ["bbb", "aaa"])
        # and the stable sort in per_agent_table preserves it
        rows = sorted(report.agent_rows, key=lambda r: -r[3].cache_read)
        self.assertEqual([agent_id for _, agent_id, _, _ in rows], ["bbb", "aaa"])
