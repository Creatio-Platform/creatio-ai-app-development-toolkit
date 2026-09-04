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
import shutil
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


class SanityTests(unittest.TestCase):
    def test_pinned_doc_is_present_and_non_empty(self):
        # The negative/anti-vacuity pins in this module pass vacuously on empty text.
        self.assertTrue(read_text(MIGRATION_SKILL).strip(), f"{MIGRATION_SKILL} is empty")


class BundleWarningsDocTests(unittest.TestCase):
    def test_bundle_warnings_are_nested_and_gate_structure(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "`bundleWarnings` / `bundleWarningDispositions`",
                "manifest.bundleWarnings",
                "manifest.bundleWarningDispositions",
                "BLOCKS the structure gate",
                "renders as an `ℹ` note instead of a blocker",
            ],
        )
        self.assertFalse(missing, f"bundleWarnings must be documented and gate structure; missing {missing}")

    def test_the_consequence_is_stated(self):
        content = flat(read_text(MIGRATION_SKILL))
        for figure in ("three details had no bound entity", "truncated at 80 rows"):
            self.assertIn(figure, content, f"bundleWarnings rule must state its consequence: {figure}")

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
        content = flat(read_text(MIGRATION_SKILL))
        for figure in (
            "13 rows / 2 scopes / 1 Describe agent / 76.8 minutes total / 993k tokens",
            "Context 23 min",
            "Describe 26 min",
            "Critique 6 min",
            "repair round 8.5 min",
            "Merge 12.5 min",
        ):
            self.assertIn(figure, content, f"measurement paragraph must state: {figure}")

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
        missing = missing_markers(
            content,
            [
                "A SURFACE with `stubs: 0` and no member rows skips step 5.1 entirely",
                "not a SCOPE-level one",
                "a zero-row SCOPE inside an otherwise-worked surface is still described",
                "`overrideOnly`",
                "one card per override without a `callParent`",
            ],
        )
        self.assertFalse(missing, f"scope-vs-surface zero-row distinction missing pieces: {missing}")

    def test_the_applicants_scope_regression_is_stated(self):
        content = flat(read_text(MIGRATION_SKILL))
        for figure in ("scope `\"section\"` was skipped", "rowSelected", "750 ms delay",
                       "mini-card that never closed"):
            self.assertIn(figure, content, f"scope zero-row rule must state its consequence: {figure}")


class TmpdirSubAgentDocTests(unittest.TestCase):
    def test_tmpdir_rule_binds_every_sub_agent(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "This binds every workflow sub-agent too, not only the main agent.",
                "`$TMPDIR/<run>/`",
                "never `/private/tmp`",
            ],
        )
        self.assertFalse(missing, f"$TMPDIR sub-agent rule missing pieces: {missing}")

    def test_the_consequence_is_stated(self):
        content = flat(read_text(MIGRATION_SKILL))
        self.assertIn("12 Classic bodies", content)
        self.assertIn("121 KB `BasePageV2_base.js`", content)

    def test_cleanup_step_still_deletes_the_tmpdir(self):
        content = read_text(MIGRATION_SKILL)
        self.assertIn("Clean up (step 4.2 inputs)", content)


class PlanNotesDocTests(unittest.TestCase):
    def test_plan_notes_replaces_plan_md_as_the_remedy_source(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "read the REMEDY for it from `<plan-basename>.notes.md` beside `--out`",
                "`plan.md` -> `plan.notes.md`".replace("->", "→"),
                "never from `plan.md` itself",
                "`plan.md` carries only user-facing text",
            ],
        )
        self.assertFalse(missing, f"plan.notes.md pointer missing pieces: {missing}")

    def test_two_coverage_numbers_and_worklist_wording(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "prints TWO coverage numbers, not one",
                "digest rows described vs. engine ledger members",
                "the digest is a WORKLIST",
                "not a census of the schema",
                "`coverage.total` stays as an alias of `digestRows` for one release",
            ],
        )
        self.assertFalse(missing, f"two-coverage-numbers pin missing pieces: {missing}")


class GuardCanFailTests(unittest.TestCase):
    """Prove each pin can actually fail, by temporarily corrupting the doc via a $TMPDIR copy.

    No git is used: the live file is copied to $TMPDIR, mutated in place, checked, then the
    original bytes are copied back over it.
    """

    def test_pins_fail_when_the_doc_is_corrupted(self):
        import os
        import tempfile

        original_bytes = MIGRATION_SKILL.read_bytes()
        tmp_dir = Path(tempfile.mkdtemp(prefix="eng96571-guard-"))
        backup = tmp_dir / "SKILL.md.orig"
        backup.write_bytes(original_bytes)
        try:
            corrupted = original_bytes.decode("utf-8").replace(
                "manifest.bundleWarnings", "manifest.somethingElse"
            ).replace(
                "76.8 minutes total", "unmeasured"
            ).replace(
                "plan.notes.md", "plan-notes-removed"
            )
            MIGRATION_SKILL.write_text(corrupted, encoding="utf-8")

            with self.assertRaises(AssertionError):
                BundleWarningsDocTests("test_bundle_warnings_are_nested_and_gate_structure").test_bundle_warnings_are_nested_and_gate_structure()
            with self.assertRaises(AssertionError):
                MeasurementDocTests("test_the_applicants_measurement_is_recorded").test_the_applicants_measurement_is_recorded()
            with self.assertRaises(AssertionError):
                PlanNotesDocTests("test_plan_notes_replaces_plan_md_as_the_remedy_source").test_plan_notes_replaces_plan_md_as_the_remedy_source()
        finally:
            shutil.copyfile(backup, MIGRATION_SKILL)
            restored = MIGRATION_SKILL.read_bytes()
            self.assertEqual(restored, original_bytes, "SKILL.md must be restored byte-for-byte")
            shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
