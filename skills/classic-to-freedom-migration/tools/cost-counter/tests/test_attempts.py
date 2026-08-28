"""Attempt classification: which transcripts the surviving run's record claims.

The export invariants pinned here:

* ``cached`` is written only when true, never as ``false``;
* a fully-replayed resume writes no new transcript, so it is not interrupted --
  the plain sum is already right for it;
* a killed agent leaves a full-size transcript with a journal ``started`` and no
  ``result``, and drops out of ``workflowProgress`` once the run is resumed;
* a re-run agent reuses the cache ``key`` of the attempt it replaces, so journal
  outcomes are matched on ``agentId``.
"""
import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest

import attempts
import cost_counter
import export as export_mod
import metrics
from report import Report


def _line(obj):
    return json.dumps(obj) + "\n"


def _usage(inp=0, cw=0, cr=0, out=0):
    return {
        "input_tokens": inp,
        "cache_creation_input_tokens": cw,
        "cache_read_input_tokens": cr,
        "output_tokens": out,
    }


class Fixture:
    """A minimal export whose run file carries a real ``workflowProgress``."""

    def __init__(self):
        self.root = tempfile.mkdtemp(prefix="cc-attempts-")
        self.session = os.path.join(self.root, "sess-1")
        self.wf_dir = os.path.join(self.session, "subagents", "workflows", "wf_a")
        os.makedirs(self.wf_dir)
        os.makedirs(os.path.join(self.session, "workflows"))
        with open(os.path.join(self.root, "transcript.jsonl"), "w", encoding="utf-8") as f:
            f.write(_line({"message": {"role": "assistant", "usage": _usage(inp=1)}}))

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)

    @property
    def meta_path(self):
        return os.path.join(self.session, "workflows", "wf_a.json")

    @property
    def journal_path(self):
        return os.path.join(self.wf_dir, "journal.jsonl")

    def agent(self, agent_id, out=5):
        path = os.path.join(self.wf_dir, f"agent-{agent_id}.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            f.write(_line({"message": {"role": "user", "content": "You are a BUILD agent."}}))
            f.write(_line({"message": {"role": "assistant", "id": f"m-{agent_id}",
                                       "usage": _usage(inp=10, cw=100, cr=50, out=out)}}))
        return path

    def run_file(self, agents, agent_count=None, status="completed", total_tokens=1234,
                 tool_calls=0):
        """``agents`` is [(agentId, cached_bool), ...]; cached=False writes NO key."""
        progress = [{"type": "workflow_phase", "index": 1, "title": "Build"}]
        for index, (agent_id, cached) in enumerate(agents, start=1):
            entry = {"type": "workflow_agent", "index": index, "label": f"build:{index}",
                     "agentId": agent_id, "state": "done"}
            if cached:
                entry["cached"] = True
            progress.append(entry)
        payload = {
            "agentCount": len(agents) if agent_count is None else agent_count,
            "totalToolCalls": tool_calls,
            "workflowName": "creatio-freedom-build-executor",
            "startTime": 1000,
            "status": status,
            "totalTokens": total_tokens,
            "workflowProgress": progress,
        }
        with open(self.meta_path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def journal(self, entries):
        """``entries`` is [(type, key, agentId), ...]."""
        with open(self.journal_path, "w", encoding="utf-8") as f:
            for kind, key, agent_id in entries:
                f.write(_line({"type": kind, "key": key, "agentId": agent_id}))

    def report(self):
        return Report(export_mod.discover(self.root), metrics.CostConfig())


class ReadRunRecordTest(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()

    def tearDown(self):
        self.fx.cleanup()

    def test_splits_replayed_from_live_on_the_cached_key(self):
        self.fx.run_file([("a1", True), ("a2", False)])
        record = attempts.read_run_record(self.fx.meta_path)
        self.assertTrue(record.readable)
        self.assertEqual(record.replayed, frozenset({"a1"}))
        self.assertEqual(record.live, frozenset({"a2"}))
        self.assertEqual(record.recorded, frozenset({"a1", "a2"}))

    def test_absent_cached_key_means_live_not_unknown(self):
        # The harness never writes `cached: false`; an entry without the key ran.
        self.fx.run_file([("a1", False)])
        with open(self.fx.meta_path, encoding="utf-8") as handle:
            entry = [e for e in json.load(handle)["workflowProgress"]
                     if e.get("type") == "workflow_agent"][0]
        self.assertNotIn("cached", entry)
        self.assertEqual(attempts.read_run_record(self.fx.meta_path).live, frozenset({"a1"}))

    def test_carries_status_and_total_tokens(self):
        self.fx.run_file([("a1", False)], status="killed", total_tokens=230357)
        record = attempts.read_run_record(self.fx.meta_path)
        self.assertEqual(record.status, "killed")
        self.assertEqual(record.total_tokens, 230357)

    def test_start_time_and_timestamp_stay_separate(self):
        # Execution order keys on startTime alone; only the label falls back to
        # timestamp. Merging them in the record would change sort behaviour.
        with open(self.fx.meta_path, "w", encoding="utf-8") as f:
            json.dump({"timestamp": 77}, f)
        record = attempts.read_run_record(self.fx.meta_path)
        self.assertIsNone(record.start_time)
        self.assertEqual(record.timestamp, 77)

    def test_missing_unparseable_and_non_object_all_degrade(self):
        self.assertFalse(attempts.read_run_record(None).readable)
        self.assertFalse(attempts.read_run_record(self.fx.meta_path).readable)  # not written
        for content in ("{not json", "null", "[1, 2]"):
            with open(self.fx.meta_path, "w", encoding="utf-8") as f:
                f.write(content)
            self.assertFalse(attempts.read_run_record(self.fx.meta_path).readable, content)


class JournalOutcomeTest(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()

    def tearDown(self):
        self.fx.cleanup()

    def test_result_is_matched_on_agent_id_not_on_the_reused_key(self):
        # Observed on a killed-then-resumed run: the re-run agent reuses the
        # cache key of the agent it replaces, and only IT gets a result. Keying
        # on `key` would credit the killed transcript with its successor's work.
        self.fx.journal([
            ("started", "k1", "killed-agent"),
            ("started", "k1", "rerun-agent"),
            ("result", "k1", "rerun-agent"),
        ])
        produced = attempts.produced_result_ids(self.fx.journal_path)
        self.assertEqual(produced, frozenset({"rerun-agent"}))
        self.assertNotIn("killed-agent", produced)

    def test_missing_journal_is_unknown_not_empty(self):
        # None means "cannot tell". The empty set would report every transcript
        # as wasted spend on an export that simply has no journal.
        self.assertIsNone(attempts.produced_result_ids(self.fx.journal_path))
        self.assertIsNone(attempts.produced_result_ids(None))


class AttributeTest(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()

    def tearDown(self):
        self.fx.cleanup()

    def _attribute(self, files, produced=None):
        record = attempts.read_run_record(self.fx.meta_path)
        return attempts.attribute(files, record, produced)

    def test_classifies_live_replayed_and_leftover(self):
        kept = self.fx.agent("a1")
        replayed = self.fx.agent("a2")
        orphan = self.fx.agent("a3")
        self.fx.run_file([("a2", True), ("a1", False)], agent_count=2)
        result = self._attribute([kept, replayed, orphan])
        self.assertTrue(result.classified)
        self.assertEqual(result.classes[kept], attempts.LIVE)
        self.assertEqual(result.classes[replayed], attempts.REPLAYED)
        self.assertEqual(result.classes[orphan], attempts.LEFTOVER)
        self.assertEqual(result.counts,
                         {attempts.LIVE: 1, attempts.REPLAYED: 1, attempts.LEFTOVER: 1})
        self.assertTrue(result.interrupted)

    def test_fully_replayed_resume_is_not_interrupted(self):
        # A resume that replayed everything writes no new transcript, so the
        # plain sum is already correct and no leftover block should appear.
        files = [self.fx.agent("a1"), self.fx.agent("a2")]
        self.fx.run_file([("a1", True), ("a2", True)])
        result = self._attribute(files)
        self.assertFalse(result.interrupted)
        self.assertEqual(result.counts[attempts.LEFTOVER], 0)
        self.assertEqual(result.counts[attempts.REPLAYED], 2)

    def test_killed_status_counts_as_interrupted_without_surplus_files(self):
        # A killed run exported before any resume has its agents still in the
        # record (state: progress) and no extra files -- status is the only clue.
        files = [self.fx.agent("a1")]
        self.fx.run_file([("a1", False)], status="killed")
        self.assertTrue(self._attribute(files).interrupted)

    def test_produced_nothing_lists_transcripts_without_a_journal_result(self):
        kept = self.fx.agent("a1")
        orphan = self.fx.agent("a2")
        self.fx.run_file([("a1", False)], agent_count=1)
        result = self._attribute([kept, orphan], produced=frozenset({"a1"}))
        self.assertTrue(result.outcomes_known)
        self.assertEqual(result.produced_nothing, frozenset({orphan}))

    def test_unknown_outcomes_do_not_mark_everything_wasted(self):
        files = [self.fx.agent("a1")]
        self.fx.run_file([("a1", False)])
        result = self._attribute(files, produced=None)
        self.assertFalse(result.outcomes_known)
        self.assertEqual(result.produced_nothing, frozenset())

    def test_how_names_only_a_real_kill_a_kill(self):
        # An export captured mid-run must not claim a kill that never happened.
        self.assertEqual(attempts.Attribution(status="killed").how, "killed")
        self.assertEqual(attempts.Attribution(status="running").how, "interrupted")
        self.assertEqual(attempts.Attribution(status="failed").how, "interrupted")
        self.assertEqual(attempts.Attribution(status="completed").how, "resumed")
        self.assertEqual(attempts.Attribution(status=None).how, "resumed")

    def test_record_consistency_compares_the_claim_with_the_entries(self):
        self.assertTrue(attempts.Attribution(agent_count=3, recorded_count=3).record_consistent)
        self.assertFalse(attempts.Attribution(agent_count=3, recorded_count=2).record_consistent)
        # No claim to contradict is unverifiable, not inconsistent.
        self.assertTrue(attempts.Attribution(agent_count=None, recorded_count=2).record_consistent)

    def test_recorded_count_is_the_number_of_progress_entries(self):
        files = [self.fx.agent("a1"), self.fx.agent("a2")]
        self.fx.run_file([("a1", True), ("a2", False)])
        self.assertEqual(self._attribute(files).recorded_count, 2)

    def test_unreadable_record_yields_no_classification(self):
        files = [self.fx.agent("a1")]
        result = attempts.attribute(files, attempts.RunRecord(), None)
        self.assertFalse(result.classified)
        self.assertFalse(result.interrupted)
        self.assertEqual(result.classes, {})


class CleanRunUnchangedTest(unittest.TestCase):
    """An export that was never interrupted must look exactly as it did before."""

    def setUp(self):
        self.fx = Fixture()
        self.fx.agent("a1")
        self.fx.agent("a2")
        self.fx.run_file([("a1", False), ("a2", False)], tool_calls=0)
        self.fx.journal([("started", "k1", "a1"), ("result", "k1", "a1"),
                         ("started", "k2", "a2"), ("result", "k2", "a2")])

    def tearDown(self):
        self.fx.cleanup()

    def test_no_attempts_key_in_the_summary_payload(self):
        report = self.fx.report()
        self.assertFalse(report.interrupted)
        self.assertNotIn("attempts", report.summary())

    def test_no_note_and_no_attempt_rows(self):
        report = self.fx.report()
        self.assertEqual(report.attempt_rows(), [])
        for row in report.reconcile():
            self.assertIsNone(row.note)
            self.assertTrue(row.agents_ok)
            self.assertTrue(row.tool_calls_ok)
            self.assertTrue(row.tool_calls_comparable)

    def test_footer_and_json_keep_their_pre_feature_wording_and_keys(self):
        report = self.fx.report()
        rows = report.reconcile()
        self.assertEqual(cost_counter._reconcile_verdict(rows), "all workflows reconcile")
        payload = cost_counter._reconcile_payload(report)[0]
        self.assertIs(payload["tool_calls_ok"], True)   # a real bool, not null
        self.assertNotIn("tool_calls_comparable", payload)
        self.assertNotIn("note", payload)


class UnreadableRunFileTest(unittest.TestCase):
    """No usable run file: report totals, claim nothing about attempts."""

    def setUp(self):
        self.fx = Fixture()
        self.fx.agent("a1")
        self.fx.agent("a2")

    def tearDown(self):
        self.fx.cleanup()

    def test_missing_run_file_degrades_to_totals_only(self):
        report = self.fx.report()   # run_file() never called
        self.assertFalse(report.interrupted)
        self.assertNotIn("attempts", report.summary())
        self.assertGreater(report.weighted_total(), 0)
        for row in report.reconcile():
            self.assertFalse(row.explained)
            self.assertIsNone(row.note)        # nothing to compare against
            # No meta count -> nothing to disagree with, so *_ok stays True,
            # but nothing was verified either: the cell must render n/a.
            self.assertTrue(row.agents_ok)
            self.assertFalse(row.agents_comparable)
            self.assertFalse(row.tool_calls_comparable)
            self.assertEqual(
                cost_counter._mark(row.agents_ok, row.agents_comparable), "n/a")
            self.assertEqual(
                cost_counter._mark(row.tool_calls_ok, row.tool_calls_comparable), "n/a")

    def test_a_journal_without_a_run_file_is_not_reported_as_reconciled(self):
        # The shape a session exported mid-run has: the workflow ran (journal
        # present, transcripts present) but `workflows/<wf>.json` was never
        # written. Nothing can be cross-checked, so the row must render n/a and
        # the footer must not claim "all workflows reconcile" -- it did so over
        # a real 6-agent / 190-tool-call workflow that nobody had checked.
        self.fx.journal([("started", "k1", "a1"), ("result", "k1", "a1"),
                         ("started", "k2", "a2"), ("result", "k2", "a2")])
        self.assertFalse(os.path.exists(self.fx.meta_path))
        report = self.fx.report()

        rows = report.reconcile()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertIsNone(row.agents_meta)
        self.assertIsNone(row.tool_calls_meta)
        self.assertEqual(row.agents_seen, 2)
        self.assertEqual(
            cost_counter._reconcile_verdict(rows),
            "all comparable checks reconcile (1 n/a)",
        )

        # The printed cells: an absent meta count reads as a dash, not None.
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            cost_counter._print_check(report)
        out = buf.getvalue()
        self.assertIn("-/2 n/a", out)
        self.assertNotIn("None", out)
        self.assertNotIn(" ok", out)

        # ... and the JSON says null on both axes, never a bare true.
        payload = cost_counter._reconcile_payload(report)[0]
        self.assertIsNone(payload["agents_ok"])
        self.assertIsNone(payload["tool_calls_ok"])
        self.assertFalse(payload["agents_comparable"])
        self.assertFalse(payload["tool_calls_comparable"])

    def test_the_markdown_renderer_says_n_a_too(self):
        # The three renderers used to hold a verbatim copy each of the cell
        # rule, and only the text one was covered -- so an edit reaching two of
        # three left this table printing "None/2 ok" over a never-verified
        # workflow with the suite green. --format md is the Jira-paste path.
        self.fx.journal([("started", "k1", "a1"), ("result", "k1", "a1"),
                         ("started", "k2", "a2"), ("result", "k2", "a2")])
        out = cost_counter._reconcile_markdown(self.fx.report())

        self.assertIn("| -/2 n/a |", out)
        self.assertNotIn("None", out)
        self.assertNotIn(" ok |", out)
        self.assertIn("_all comparable checks reconcile (1 n/a)_", out)
        self.assertNotIn("all workflows reconcile", out)

    def test_the_markdown_renderer_still_says_ok_on_a_verified_workflow(self):
        # The other half of the three-state rule: a row that really was checked
        # must keep reading "ok", so the n/a fix did not simply mute the table.
        self.fx.journal([("started", "k1", "a1"), ("result", "k1", "a1"),
                         ("started", "k2", "a2"), ("result", "k2", "a2")])
        self.fx.run_file([("a1", False), ("a2", False)], agent_count=2,
                         status="completed", tool_calls=0)
        out = cost_counter._reconcile_markdown(self.fx.report())

        self.assertIn("| 2/2 ok |", out)
        self.assertNotIn("n/a", out)
        self.assertIn("_all workflows reconcile_", out)

    def test_a_verified_run_carries_no_comparable_keys_in_the_json(self):
        # *_comparable rides along only to explain a suppressed check, so an
        # ordinary export's payload must be byte-for-byte what it always was.
        self.fx.journal([("started", "k1", "a1"), ("result", "k1", "a1"),
                         ("started", "k2", "a2"), ("result", "k2", "a2")])
        self.fx.run_file([("a1", False), ("a2", False)], agent_count=2,
                         status="completed", tool_calls=0)
        payload = cost_counter._reconcile_payload(self.fx.report())[0]

        self.assertTrue(payload["agents_ok"])
        self.assertTrue(payload["tool_calls_ok"])
        self.assertNotIn("agents_comparable", payload)
        self.assertNotIn("tool_calls_comparable", payload)

    def test_non_object_run_file_degrades_the_same_way(self):
        with open(self.fx.meta_path, "w", encoding="utf-8") as f:
            f.write("null")
        report = self.fx.report()
        self.assertFalse(report.interrupted)
        self.assertNotIn("attempts", report.summary())

    def test_a_surplus_of_transcripts_is_what_the_leftover_bucket_is_for(self):
        # More transcripts than the record accounts for is the normal resumed
        # shape: the record is self-consistent, so the surplus is explained and
        # the extra file lands in the leftover bucket.
        self.fx.run_file([("a1", False)], agent_count=1, status="completed")
        report = self.fx.report()
        row = report.reconcile()[0]
        self.assertEqual((row.agents_meta, row.agents_seen), (1, 2))
        self.assertTrue(row.explained)
        self.assertEqual(report.summary()["attempts"]["leftover_agents"], 1)

    def test_a_run_file_that_disagrees_with_itself_is_not_explained(self):
        # agentCount claims 5 while workflowProgress lists 1: the record is
        # internally inconsistent, and no leftover bucket accounts for that.
        # This is the case the class-sum equality could never catch.
        self.fx.run_file([("a1", False)], agent_count=5)
        row = self.fx.report().reconcile()[0]
        self.assertEqual((row.agents_meta, row.agents_seen), (5, 2))
        self.assertFalse(row.explained)
        self.assertFalse(row.agents_ok)

    def test_a_deficit_reports_missing_transcripts_not_a_surplus(self):
        # Fewer transcripts than the record claims: a truncated or partially
        # copied export. Calling that a surplus would invert the diagnosis.
        os.remove(os.path.join(self.fx.wf_dir, "agent-a2.jsonl"))
        self.fx.run_file([("a1", False), ("a2", False)])
        row = self.fx.report().reconcile()[0]
        self.assertEqual((row.agents_meta, row.agents_seen), (2, 1))
        self.assertFalse(row.agents_ok)
        self.assertIn("missing", row.note)
        self.assertNotIn("surplus", row.note)


class InterruptedRunReportTest(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        self.fx.agent("live1")
        self.fx.agent("replayed1")
        self.fx.agent("leftover1")
        # tool_calls=7 against transcripts that make none: the counts differ, as
        # they do on a real interrupted run, so the suppression path is exercised.
        self.fx.run_file([("replayed1", True), ("live1", False)], agent_count=2, tool_calls=7)
        # leftover1 started and never produced a result -- killed or stalled.
        self.fx.journal([
            ("started", "k1", "replayed1"), ("result", "k1", "replayed1"),
            ("started", "k2", "live1"), ("result", "k2", "live1"),
            ("started", "k3", "leftover1"),
        ])
        self.report = self.fx.report()

    def tearDown(self):
        self.fx.cleanup()

    def test_surplus_is_explained_rather_than_reported_as_a_discrepancy(self):
        row = self.report.reconcile()[0]
        self.assertEqual((row.agents_meta, row.agents_seen), (2, 3))
        self.assertTrue(row.explained)
        self.assertTrue(row.agents_ok)
        self.assertTrue(row.tool_calls_ok)
        self.assertIn("leftover", row.note)

    def test_tool_calls_are_reported_not_comparable_rather_than_ok(self):
        # totalToolCalls is on its own basis once a run is interrupted, matching
        # no subset of the transcripts. Suppressing the MISMATCH is correct;
        # reporting "ok" would claim a comparison that never ran.
        row = self.report.reconcile()[0]
        self.assertTrue(row.tool_calls_ok)
        self.assertFalse(row.tool_calls_comparable)
        self.assertEqual(cost_counter._mark(row.tool_calls_ok, row.tool_calls_comparable), "n/a")
        # The agent counts ARE explained by the leftover bucket, so they stay ok.
        self.assertEqual(cost_counter._mark(row.agents_ok), "ok")

    def test_the_footer_does_not_fold_a_suppressed_check_into_a_pass(self):
        rows = self.report.reconcile()
        verdict = cost_counter._reconcile_verdict(rows)
        self.assertEqual(verdict, "all comparable checks reconcile (1 n/a)")
        self.assertNotEqual(verdict, "all workflows reconcile")

    def test_json_reports_a_suppressed_check_as_null_not_true(self):
        # A consumer reading tool_calls_ok alone must not see a clean pass over
        # a comparison that never ran.
        row = cost_counter._reconcile_payload(self.report)[0]
        self.assertIsNone(row["tool_calls_ok"])
        self.assertFalse(row["tool_calls_comparable"])
        self.assertTrue(row["agents_ok"])   # this one really was verified

    def test_summary_reports_the_three_classes_and_the_run_file_total(self):
        payload = self.report.summary()["attempts"]
        self.assertTrue(payload["interrupted"])
        self.assertEqual(payload["live_agents"], 1)
        self.assertEqual(payload["replayed_agents"], 1)
        self.assertEqual(payload["leftover_agents"], 1)
        self.assertEqual(payload["produced_nothing_agents"], 1)
        self.assertEqual(payload["run_file_total_tokens"], {"wf_a": 1234})

    def test_split_hides_no_spend(self):
        # Naming the leftovers must not remove them from the run total: the two
        # classes are a partition of the subagent transcripts, so their raw token
        # streams add back up to the run total minus the main transcript's stage.
        surviving, leftover = self.report.leftover_totals()
        main_agg = self.report.stage_aggs[0][1]
        for field in ("input", "output", "cache_write", "cache_read"):
            self.assertEqual(
                getattr(surviving, field) + getattr(leftover, field) + getattr(main_agg, field),
                getattr(self.report.totals, field),
                field,
            )
        self.assertGreater(self.report.summary()["attempts"]["leftover_weighted"], 0)


if __name__ == "__main__":
    unittest.main()
