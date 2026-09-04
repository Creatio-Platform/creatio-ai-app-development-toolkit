"""ENG-96571 (wave 2, writer w2d) — five doc-and-measurement gaps in classic-to-freedom-migration.

Each group below pins one instruction the Applicants run either lacked or got wrong:

1. **`bundleWarnings` / `bundleWarningDispositions`.** The bundle's own `warnings` array from
   `get-classic-page-sources` was not nested into the manifest, so three details with no bound
   entity and an 80-row child-page truncation never reached the structure gate — it read
   `structure.complete: true` regardless.
2. **The first real `--stubs` measurement.** `rowsPerAgent`/`maxDescribeAgents` were reasoned
   defaults with no profiled run behind them; the Applicants run supplies the first one.
3. **Zero-row SCOPE vs zero-row SURFACE.** "A surface with `stubs: 0` skips step 5.1" was read as
   licensing a zero-row scope inside an otherwise-worked surface too, and a `rowSelected` override
   on scope "section" was missed as a result.
4. **The `$TMPDIR` rule applies to every sub-agent, not just the main agent.** A run that let a
   sub-agent write Classic bodies into the migration repo's own working tree left 12 files
   (including a 121 KB `BasePageV2_base.js`) in the user's project tree.
5. **`plan.notes.md` replaces `plan.md` as the source of agent-facing remedy instructions.** The
   engine now writes agent-facing notes beside `--out` (`plan.md` -> `plan.notes.md`); `plan.md`
   itself carries only user-facing text. The plan header also now prints two coverage numbers
   (digest rows described vs. engine ledger members), and the digest is a worklist, not a census.

An instruction gap is invisible to every engine test, which is why these are prose pins.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MIGRATION_SKILL = ROOT / "skills/classic-to-freedom-migration/SKILL.md"


def read_text(path):
    return path.read_text(encoding="utf-8").replace("’", "'")


def flat(text):
    """Collapse whitespace runs so a pin survives a Markdown re-wrap."""
    return re.sub(r"\s+", " ", text)


def missing_markers(text, markers):
    flattened = flat(text)
    return [marker for marker in markers if flat(marker) not in flattened]


# ENG-96571 (review 1, C) — THE MARKER LISTS ARE MODULE CONSTANTS. Each test below reads its list from here, and
# so does `GuardCanFailTests`: proving a pin CAN fail is a question about `missing_markers` and a string, and it
# needs no file on disk. The old guard test wrote a corrupted copy of the tracked `SKILL.md` over the real file
# and restored it in a `finally` — so an interrupted run (Ctrl+C, a crash, a killed worker), or two workers
# running it at once, left a corrupted tracked file in the working tree, and any concurrent reader of `SKILL.md`
# saw the corruption. A test must never write to a tracked source file to prove a point about a string.
BUNDLE_WARNING_MARKERS = [
    "`bundleWarnings` / `bundleWarningDispositions`",
    "manifest.bundleWarnings",
    "manifest.bundleWarningDispositions",
    "BLOCKS the structure gate",
    "renders as an `ℹ` note instead of a blocker",
]

# ENG-96571 (review 1, T) — ONE representative figure for this rule, not five. The per-phase breakdown
# (Context 23 min / Describe 26 min / Critique 6 min / repair 8.5 min / Merge 12.5 min) was pinned figure by
# figure: five pins that all break together on any re-measurement, none of which holds a contract. `76.8 minutes
# total` is the number the rule rests on (it is why `rowsPerAgent` came down to 12), so it is the one that stays.
MEASUREMENT_MARKERS = ["76.8 minutes total"]

PLAN_NOTES_MARKERS = [
    "read the REMEDY for it from `<plan-basename>.notes.md` beside `--out`",
    "`plan.md` → `plan.notes.md`",
    "never from `plan.md` itself",
    "`plan.md` carries only user-facing text",
]

SCOPE_ZERO_ROW_MARKERS = [
    "A SURFACE with `stubs: 0` and no member rows skips step 5.1 entirely",
    "not a SCOPE-level one",
    "a zero-row SCOPE inside an otherwise-worked surface is still described",
    "`overrideOnly`",
    "one card per override without a `callParent`",
]

TMPDIR_MARKERS = [
    "This binds every workflow sub-agent too, not only the main agent.",
    "`$TMPDIR/<run>/`",
    "never `/private/tmp`",
]

TWO_COVERAGE_MARKERS = [
    "prints TWO coverage numbers, not one",
    "digest rows described vs. engine ledger members",
    "the digest is a WORKLIST",
    "not a census of the schema",
    "`coverage.total` stays as an alias of `digestRows` for one release",
]


class SanityTests(unittest.TestCase):
    def test_pinned_doc_is_present_and_non_empty(self):
        # The negative/anti-vacuity pins in this module pass vacuously on empty text.
        self.assertTrue(read_text(MIGRATION_SKILL).strip(), f"{MIGRATION_SKILL} is empty")


class BundleWarningsDocTests(unittest.TestCase):
    def test_bundle_warnings_are_nested_and_gate_structure(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(content, BUNDLE_WARNING_MARKERS)
        self.assertFalse(missing, f"bundleWarnings must be documented and gate structure; missing {missing}")

    def test_the_documented_key_and_disposition_words_match_the_engine(self):
        # The provisional "confirm with whoever lands that change" hedge is GONE: the engine
        # side landed, so the doc states the verified contract of `bundleWarningState`
        # (migrate.mjs) instead of hedging about it.
        content = flat(read_text(MIGRATION_SKILL))
        self.assertNotIn(
            "confirm with whoever lands that change before relying on them",
            content,
            "the provisional hedge must be replaced by the verified contract, not kept beside it",
        )
        for marker in (
            'keyed by the warning\'s `code`, with the exact `message` text accepted as a bare fallback',
            "there is no index keying",
            '"resolved": true',
            '"resolved-manually"|"accepted"|"n/a"',
        ):
            self.assertIn(marker, content, f"bundleWarningDispositions contract must state: {marker}")


class MeasurementDocTests(unittest.TestCase):
    def test_the_applicants_measurement_is_recorded(self):
        # One representative figure — see MEASUREMENT_MARKERS for why the per-phase breakdown is not pinned.
        missing = missing_markers(read_text(MIGRATION_SKILL), MEASUREMENT_MARKERS)
        self.assertFalse(missing, f"measurement paragraph must state: {missing}")

    def test_new_defaults_are_stated(self):
        content = flat(read_text(MIGRATION_SKILL))
        self.assertIn("`rowsPerAgent` now defaults to **12**", content)
        # The fan-out condition must match `planBatches` (helpers.mjs), which is
        # `worked.length === 1 || totalRows <= rowsPerAgent` — NOT the earlier prose claim
        # that "a multi-scope surface always fans out per scope". A 2-scope/9-row surface
        # stays on one agent, so the doc has to state BOTH legs of the shortcut.
        self.assertIn("ONE Describe agent takes the whole surface on exactly two conditions", content)
        self.assertIn("single worked scope", content)
        self.assertIn("at or under `rowsPerAgent`", content)
        self.assertNotIn(
            "multi-scope surface always fans out per scope",
            content,
            "the false unconditional fan-out claim must not survive alongside the corrected wording",
        )

    def test_context_parallel_describe_is_a_followup_not_done(self):
        content = flat(read_text(MIGRATION_SKILL))
        self.assertIn(
            "Context ∥ Describe",
            content,
            "the doc must name the Context-parallel-Describe follow-up explicitly",
        )
        self.assertIn(
            "is a documented follow-up, not something this run did",
            content,
            "Context ∥ Describe must be marked as NOT done",
        )

    def test_stale_theoretical_thresholds_language_is_gone(self):
        content = flat(read_text(MIGRATION_SKILL))
        self.assertNotIn(
            "The thresholds are theoretical until measured.",
            content,
            "the old 'theoretical until measured' paragraph must be replaced, not kept alongside",
        )


class ScopeVsSurfaceZeroRowDocTests(unittest.TestCase):
    def test_scope_zero_row_is_distinguished_from_surface_zero_row(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(content, SCOPE_ZERO_ROW_MARKERS)
        self.assertFalse(missing, f"scope-vs-surface zero-row distinction missing pieces: {missing}")

    def test_the_applicants_scope_regression_is_stated(self):
        content = flat(read_text(MIGRATION_SKILL))
        # `750 ms` is dropped (review 1, T): it is an anecdotal timing, and the rule rests on the OVERRIDE being
        # missed, not on how slow it was.
        for figure in ("scope `\"section\"` was skipped", "rowSelected", "mini-card that never closed"):
            self.assertIn(figure, content, f"scope zero-row rule must state its consequence: {figure}")


class TmpdirSubAgentDocTests(unittest.TestCase):
    def test_tmpdir_rule_binds_every_sub_agent(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(content, TMPDIR_MARKERS)
        self.assertFalse(missing, f"$TMPDIR sub-agent rule missing pieces: {missing}")

    def test_cleanup_step_still_deletes_the_tmpdir(self):
        content = read_text(MIGRATION_SKILL)
        self.assertIn("Clean up (step 4.2 inputs)", content)


class PlanNotesDocTests(unittest.TestCase):
    def test_plan_notes_replaces_plan_md_as_the_remedy_source(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(content, PLAN_NOTES_MARKERS)
        self.assertFalse(missing, f"plan.notes.md pointer missing pieces: {missing}")

    def test_two_coverage_numbers_and_worklist_wording(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(content, TWO_COVERAGE_MARKERS)
        self.assertFalse(missing, f"two-coverage-numbers pin missing pieces: {missing}")


class GuardCanFailTests(unittest.TestCase):
    """Prove each pin can actually fail — IN MEMORY, with no disk write of any kind.

    A pin is `missing_markers(<doc text>, <marker list>)`. Whether it can fail is therefore a question about
    that function and a string, and answering it needs no file: the doc is read once, corrupted as a Python
    string, and the corrupted STRING is passed to `missing_markers`. The previous version wrote the corrupted
    bytes over the tracked `skills/classic-to-freedom-migration/SKILL.md` and restored them in a `finally`, so an
    interrupted or parallel run could leave a corrupted tracked file in the working tree.
    """

    def setUp(self):
        self.text = read_text(MIGRATION_SKILL)

    def test_the_doc_read_is_not_empty(self):
        # Without this every assertion below is satisfied by the empty string.
        self.assertTrue(self.text.strip())

    def test_bundle_warning_pins_fail_on_a_corrupted_string(self):
        corrupted = self.text.replace("manifest.bundleWarnings", "manifest.somethingElse")
        self.assertNotEqual(corrupted, self.text, "the corruption changed nothing — the pin's subject is gone")
        self.assertEqual([], missing_markers(self.text, BUNDLE_WARNING_MARKERS))
        self.assertNotEqual([], missing_markers(corrupted, BUNDLE_WARNING_MARKERS))

    def test_measurement_pins_fail_on_a_corrupted_string(self):
        corrupted = self.text.replace("76.8 minutes total", "unmeasured")
        self.assertNotEqual(corrupted, self.text)
        self.assertEqual([], missing_markers(self.text, MEASUREMENT_MARKERS))
        self.assertNotEqual([], missing_markers(corrupted, MEASUREMENT_MARKERS))

    def test_plan_notes_pins_fail_on_a_corrupted_string(self):
        corrupted = self.text.replace("plan.notes.md", "plan-notes-removed")
        self.assertNotEqual(corrupted, self.text)
        self.assertEqual([], missing_markers(self.text, PLAN_NOTES_MARKERS))
        self.assertNotEqual([], missing_markers(corrupted, PLAN_NOTES_MARKERS))

    def test_the_remaining_pin_groups_fail_on_a_corrupted_string_too(self):
        for markers, needle, replacement in (
            (SCOPE_ZERO_ROW_MARKERS, "`overrideOnly`", "`somethingElse`"),
            (TMPDIR_MARKERS, "`$TMPDIR/<run>/`", "`/private/tmp/<run>/`"),
            (TWO_COVERAGE_MARKERS, "prints TWO coverage numbers, not one", "prints a coverage number"),
        ):
            with self.subTest(needle=needle):
                corrupted = self.text.replace(needle, replacement)
                self.assertNotEqual(corrupted, self.text)
                self.assertEqual([], missing_markers(self.text, markers))
                self.assertNotEqual([], missing_markers(corrupted, markers))

    def test_the_doc_file_is_never_written(self):
        # The point of the rewrite, asserted rather than described: nothing above touched the file.
        before = MIGRATION_SKILL.read_bytes()
        self.test_bundle_warning_pins_fail_on_a_corrupted_string()
        self.test_measurement_pins_fail_on_a_corrupted_string()
        self.test_plan_notes_pins_fail_on_a_corrupted_string()
        self.assertEqual(before, MIGRATION_SKILL.read_bytes())


if __name__ == "__main__":
    unittest.main()
