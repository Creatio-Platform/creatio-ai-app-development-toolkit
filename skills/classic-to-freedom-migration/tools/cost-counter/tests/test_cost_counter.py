"""Entry-point smoke tests: run()/main() over a synthetic export.

Pins the CLI plumbing -- section dispatch, the empty-export exit code, the
--pages override, and the ttl/check/normalization printers -- so a refactor of
cost_counter.py cannot silently break the reporting surface.
"""
import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

import cost_counter as counter
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
        self.root = tempfile.mkdtemp(prefix="cc-counter-")
        # main() resolves its path arguments through a PathStore (the default
        # is the home directory). Point the CLI at a store rooted where this
        # fixture actually lives, so the suite does not depend on the machine's
        # temp directory sitting under the user's profile.
        self.store = counter.path_store.PathStore(os.path.dirname(self.root))
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
            rc = counter.run(self.root, section, pages, metrics.CostConfig())
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
                rc = counter.run(empty, "all", None, metrics.CostConfig())
            self.assertEqual(rc, 2)
            self.assertIn("no transcripts found", buf.getvalue())
        finally:
            shutil.rmtree(empty, ignore_errors=True)

    def test_main_parses_argv_and_returns_zero(self):
        self.assertEqual(counter.main([self.root, "stage"], store=self.store), 0)

    def test_json_format_parses_and_mirrors_the_report(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = counter.run(self.root, "all", None, metrics.CostConfig(), "json")
        self.assertEqual(rc, 0)
        doc = json.loads(buf.getvalue())  # must be valid JSON
        self.assertIn("config", doc)
        self.assertIn("by_stage", doc["tables"])
        self.assertEqual(doc["tables"]["by_stage"]["total"]["label"], "TOTAL")
        self.assertIn("reconcile", doc)
        self.assertIn("normalization", doc)

    def test_md_format_emits_markdown_tables(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = counter.run(self.root, "all", None, metrics.CostConfig(), "md")
        self.assertEqual(rc, 0)
        out = buf.getvalue()
        self.assertIn("Weighted-cost config", out)
        self.assertIn("### By stage", out)
        self.assertIn("| **TOTAL**", out)  # bold total row, GFM table

    def test_main_accepts_format_flag(self):
        self.assertEqual(counter.main([self.root, "role", "--format", "md"], store=self.store), 0)
        self.assertEqual(counter.main([self.root, "--format", "json"], store=self.store), 0)

    def test_main_defaults_to_home_store_when_store_is_omitted(self):
        # Every other main() test injects store=; this one pins the real
        # default-wiring branch (`store = store or path_store.home_store()`) that
        # every actual CLI invocation takes. Patch home_store so the assertion
        # does not depend on where the machine puts $HOME, and confirm main()
        # routes its resolution through the default store.
        with patch.object(counter.path_store, "home_store",
                          return_value=self.store) as home:
            rc = counter.main([self.root, "stage"])
        home.assert_called_once()
        self.assertEqual(rc, 0)

    def test_main_refuses_a_compare_the_store_cannot_serve(self):
        # A valid export_dir but an out-of-store --compare must exit 2 from
        # main() -- the --compare resolution path is otherwise only reached by
        # compare() tests that bypass main()/store entirely.
        store = counter.path_store.PathStore(self.root)  # base == the export dir
        outside = tempfile.mkdtemp(prefix="cc-outside-compare-")
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = counter.main([self.root, "--compare", outside], store=store)
        self.assertEqual(rc, 2)
        self.assertIn("outside the directory this tool may read", buf.getvalue())

    def test_main_refuses_an_export_the_store_cannot_serve(self):
        # An export outside the store is reported and exits 2 -- never opened.
        # This is the CLI half of the runtime/path_store.py contract: the path
        # argument selects among entries the store already holds, so anything
        # else has no way through.
        elsewhere = counter.path_store.PathStore(os.path.dirname(os.path.abspath(__file__)))
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = counter.main([self.root, "stage"], store=elsewhere)
        self.assertEqual(rc, 2)
        self.assertIn("outside the directory this tool may read", buf.getvalue())

    def test_pages_zero_is_rejected(self):
        # --pages 0 must not reach page_count() (it would divide by zero in
        # per-page normalization); argparse rejects it with a non-zero exit.
        with self.assertRaises(SystemExit) as ctx:
            counter.main([self.root, "--pages", "0"])
        self.assertNotEqual(ctx.exception.code, 0)

    def test_pages_negative_is_rejected(self):
        # --pages -3 would print a nonsensical negative cost-per-page.
        with self.assertRaises(SystemExit) as ctx:
            counter.main([self.root, "--pages", "-3"])
        self.assertNotEqual(ctx.exception.code, 0)


class CliFallbackTest(unittest.TestCase):
    """No cache_creation TTL breakdown in the export.

    The effective cache-write weight falls back to the 5m rate (1.25); the
    header must annotate it and normalization must emit the note, so the
    effective weight is never read as an exact, run-derived blend that
    contradicts the "no TTL breakdown" TTL block (R4).
    """

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="cc-fallback-")
        wf_dir = os.path.join(self.root, "sess-1", "subagents", "workflows", "wf_a")
        os.makedirs(wf_dir)
        with open(os.path.join(wf_dir, "agent-aaa.jsonl"), "w", encoding="utf-8") as f:
            f.writelines([
                _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
                _line({"message": {"role": "assistant",
                                   # cache-write volume but NO m5/h1 TTL split.
                                   "usage": _usage(inp=10, cw=100, cr=1000, out=5),
                                   "content": [{"type": "tool_use", "id": "t1", "name": "Bash"}]}}),
            ])

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_fallback_weight_is_annotated_and_noted(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = counter.run(self.root, "all", None, metrics.CostConfig())
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("effective cache_write weight for this run: 1.250", out)
        # header effective-weight line is annotated as a fallback, not bare.
        self.assertIn("no cache_creation TTL breakdown in export", out)
        # normalization always emits the explicit fallback note.
        self.assertIn("fell back to 1.25", out)


def _build_compare_export(cr, m5, page):
    """A minimal export usable by `compare()`/`run(..., "summary")`: one
    agent transcript plus a journal recording the given built page (or none,
    for `page=None` -- a schema-only / rule-only run)."""
    root = tempfile.mkdtemp(prefix="cc-cmp-")
    wf = os.path.join(root, "sess-1", "subagents", "workflows", "wf_a")
    os.makedirs(wf)
    with open(os.path.join(wf, "agent-a.jsonl"), "w", encoding="utf-8") as f:
        f.writelines([
            _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
            _line({"message": {"role": "assistant", "usage": _usage(cr=cr, m5=m5, out=5),
                               "content": [{"type": "tool_use", "id": "t", "name": "Read"}]}}),
        ])
    with open(os.path.join(wf, "journal.jsonl"), "w", encoding="utf-8") as f:
        if page is not None:
            f.write(_line({"type": "result", "result": {"pageSchemas": {"main": page}}}))
    return root


class _CompareExportTestCase(unittest.TestCase):
    """Shared fixture for compare()-oriented tests: builds throwaway exports
    and captures stdout. No test_ methods of its own -- contributes nothing
    to the suite by itself."""

    def _export(self, cr, m5, page):
        root = _build_compare_export(cr, m5, page)
        self._tmp.append(root)
        return root

    def setUp(self):
        self._tmp = []

    def tearDown(self):
        for root in self._tmp:
            shutil.rmtree(root, ignore_errors=True)

    def _out(self, fn, *args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = fn(*args)
        return rc, buf.getvalue()


class CompareAndSummaryTest(_CompareExportTestCase):
    """The concise single-run summary, and the cost-only baseline->candidate
    compare with its same-section guard and verdict."""

    def test_summary_section_is_concise(self):
        rc, out = self._out(counter.run, self._export(1000, 100, "PageA"),
                            "summary", None, metrics.CostConfig())
        self.assertEqual(rc, 0)
        self.assertIn("weighted cost per built page", out)
        self.assertNotIn("by agent role", out)  # not the full report

    def test_compare_same_section_reports_cheaper(self):
        base = self._export(1000, 100, "PageA")
        cand = self._export(500, 50, "PageA")   # fewer tokens, same page
        rc, out = self._out(counter.compare, base, cand, metrics.CostConfig())
        self.assertEqual(rc, 0)
        self.assertIn("same section", out)
        self.assertIn("cheaper per built page", out)

    def test_compare_cross_section_is_void(self):
        base = self._export(1000, 100, "PageA")
        cand = self._export(500, 50, "PageB")   # different section
        rc, out = self._out(counter.compare, base, cand, metrics.CostConfig())
        self.assertEqual(rc, 0)
        self.assertIn("comparison void", out)

    def test_compare_empty_sections_are_the_same_section(self):
        # Two schema-only runs (no built pages recorded) are structurally the
        # same section: the compare must NOT be voided just because both
        # built_pages sets are empty.
        base = self._export(1000, 100, None)
        cand = self._export(500, 50, None)
        rc, out = self._out(counter.compare, base, cand, metrics.CostConfig())
        self.assertEqual(rc, 0)
        self.assertNotIn("comparison void", out)
        self.assertIn("same section", out)

    def test_compare_json_has_deltas_and_verdict(self):
        base = self._export(1000, 100, "PageA")
        cand = self._export(500, 50, "PageA")
        rc, out = self._out(counter.compare, base, cand, metrics.CostConfig(), "json")
        self.assertEqual(rc, 0)
        doc = json.loads(out)
        self.assertTrue(doc["same_section"])
        self.assertIn("verdict", doc)
        self.assertEqual(len(doc["deltas"]), len(counter._COMPARE_MEASURES))

    def test_compare_rejects_empty_export(self):
        empty = tempfile.mkdtemp(prefix="cc-empty-")
        self._tmp.append(empty)
        base = self._export(1000, 100, "PageA")
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = counter.compare(base, empty, metrics.CostConfig())
        self.assertEqual(rc, 2)


class VersionNoteTest(_CompareExportTestCase):
    """ENG-95856 Done-criterion #3: --compare states which side was measured
    with which counter version, and refuses a diff across the fix boundary."""

    def test_matching_versions_state_both_sides(self):
        base = {"counter_version": "2.0"}
        cand = {"counter_version": "2.0"}
        self.assertEqual(counter._version_note(base, cand),
                         "both sides measured with counter version 2.0")

    def test_mismatched_versions_are_refused(self):
        base = {"counter_version": "1.0"}
        cand = {"counter_version": "2.0"}
        note = counter._version_note(base, cand)
        self.assertIn("REFUSED", note)
        self.assertIn("1.0", note)
        self.assertIn("2.0", note)

    def test_missing_counter_version_does_not_raise_and_is_its_own_value(self):
        # A summary saved before this field existed has no counter_version
        # key at all -- must not raise KeyError, and "missing" must not be
        # silently treated as matching a versioned candidate.
        base = {}
        cand = {"counter_version": "2.0"}
        note = counter._version_note(base, cand)
        self.assertIn("REFUSED", note)
        self.assertIn("unversioned", note)

    def test_compare_verdict_short_circuits_on_version_mismatch(self):
        base = {"counter_version": "1.0", "weighted_per_page": 100}
        cand = {"counter_version": "2.0", "weighted_per_page": 50}
        verdict = counter._compare_verdict(base, cand, same_section=True)
        self.assertIn("REFUSED", verdict)

    def test_compare_end_to_end_refuses_across_a_saved_pre_fix_summary(self):
        # Drives compare() itself (not just _version_note in isolation): a
        # summary saved from an older run (different counter_version, or none
        # at all) compared against a live export must short-circuit to
        # REFUSED and never reach the ratio computation.
        old_summary = {
            "summary": {
                "weighted_total": 1000, "weighted_per_page": 1000,
                "page_count": 1, "page_count_defaulted": False,
                "built_pages": ["PageA"], "input": 1, "cache_write": 1,
                "cache_read": 1, "output": 1, "tool_calls": 1, "agents": 1,
                "turns": 1, "effective_w": 1.25,
                # no counter_version key: pre-dates this field.
            }
        }
        # `mkstemp` returns (fd, path) and the fd is OPEN. Discarding it with `[1]` leaks the handle, and on
        # Windows an open handle makes the `os.remove` cleanup fail with `PermissionError: [WinError 32]` — the
        # file is deleteable only once nothing holds it. POSIX unlinks an open file happily, which is why this
        # only ever failed on the Windows leg. Close it before handing the path to anything else.
        fd, saved = tempfile.mkstemp(prefix="cc-old-summary-", suffix=".json")
        os.close(fd)
        self.addCleanup(os.remove, saved)
        with open(saved, "w", encoding="utf-8") as f:
            json.dump(old_summary, f)

        live = self._export(500, 50, "PageA")
        rc, out = self._out(counter.compare, saved, live, metrics.CostConfig(), "json")
        self.assertEqual(rc, 0)
        doc = json.loads(out)
        self.assertIn("REFUSED", doc["verdict"])
        self.assertIn("unversioned", doc["version_note"])

    def test_compare_rejects_a_json_file_missing_the_summary_key(self):
        # Same `mkstemp` fd leak as above — close the descriptor or the Windows cleanup raises WinError 32.
        fd, not_a_summary = tempfile.mkstemp(prefix="cc-bad-json-", suffix=".json")
        os.close(fd)
        self.addCleanup(os.remove, not_a_summary)
        with open(not_a_summary, "w", encoding="utf-8") as f:
            json.dump({"tables": {}}, f)
        live = self._export(500, 50, "PageA")
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = counter.compare(not_a_summary, live, metrics.CostConfig())
        self.assertEqual(rc, 2)
        self.assertIn("not a saved cost-counter summary", buf.getvalue())


class CounterVersionEverywhereTest(unittest.TestCase):
    """ENG-95856 Done-criterion #3: counter_version must surface in every
    output format, for every --section -- not only 'all' and 'summary'."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="cc-cv-")
        wf_dir = os.path.join(self.root, "sess-1", "subagents", "workflows", "wf_a")
        os.makedirs(wf_dir)
        with open(os.path.join(wf_dir, "agent-aaa.jsonl"), "w", encoding="utf-8") as f:
            f.writelines([
                _line({"message": {"role": "user", "content": "You are a BUILD agent."}}),
                _line({"message": {"role": "assistant",
                                   "usage": _usage(inp=10, cw=100, cr=1000, out=5, m5=80, h1=20),
                                   "content": [{"type": "tool_use", "id": "t1", "name": "Bash"}]}}),
            ])

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_text_format_prints_counter_version_for_a_non_all_section(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = counter.run(self.root, "role", None, metrics.CostConfig())
        self.assertEqual(rc, 0)
        self.assertIn(f"counter version: {counter.COUNTER_VERSION}", buf.getvalue())

    def test_json_format_carries_counter_version_for_a_non_all_section(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = counter.run(self.root, "ttl", None, metrics.CostConfig(), "json")
        self.assertEqual(rc, 0)
        doc = json.loads(buf.getvalue())
        self.assertEqual(doc["counter_version"], counter.COUNTER_VERSION)

    def test_md_format_carries_counter_version_for_a_non_all_section(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = counter.run(self.root, "check", None, metrics.CostConfig(), "md")
        self.assertEqual(rc, 0)
        self.assertIn(f"_counter version: {counter.COUNTER_VERSION}_", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
