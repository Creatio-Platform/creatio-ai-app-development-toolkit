"""ENG-96571 C1 — where an answered ⚠ Confirm row is recorded, pinned where a driver reads it.

The measured loss: the only way to answer a ⚠ Confirm row was to append it to the plan's
*Adjustments* list, and `migrate.mjs --plan --out` rewrites `plan.md` wholesale on every run. The
answer was gone on the next regenerate and the engine asked the same question again — run after
run, for questions an operator had already resolved on the stand.

`manifest.confirmDispositions` is the machine channel that fixes that, and `decisions.md` stays
the source of record. Three facts have to reach the driver, and none of them is observable to an
engine test, which is why they are prose pins:

1. `decisions.md` is where a decision lives; the disposition map is only how the ENGINE learns it.
2. `confirmDispositions` is keyed as the worklist prints the row, and only four disposition words
   close it — anything else leaves the row OPEN and is named.
3. The plan's `Adjustments` list is DERIVED and overwritten by every `--plan --out`. It is never
   the place a decision is recorded.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MIGRATION_DOCS = ROOT / "skills/classic-to-freedom-migration/references/migration-documentation.md"


def read_text(path):
    return path.read_text(encoding="utf-8").replace("’", "'")


def flat(text):
    """Collapse whitespace runs so a pin survives a Markdown re-wrap."""
    return re.sub(r"\s+", " ", text)


def missing_markers(text, markers):
    flattened = flat(text)
    return [marker for marker in markers if flat(marker) not in flattened]


class ConfirmDispositionsDocTests(unittest.TestCase):
    def test_pinned_doc_is_present_and_non_empty(self):
        # Every pin below would pass vacuously on empty text, so they all rest on this guard.
        self.assertTrue(read_text(MIGRATION_DOCS).strip(), f"{MIGRATION_DOCS} is empty")

    def test_confirm_dispositions_is_named_as_the_machine_channel_with_its_key_shape(self):
        text = read_text(MIGRATION_DOCS)
        missing = missing_markers(text, [
            "manifest.confirmDispositions",
            # the key shape — both forms, because a scoped answer is what keeps one page's answer
            # from closing another page's identical question
            '"<kind>:<item>"',
            '"<schema>::<kind>:<item>"',
            # a worked example, so the shape is copyable rather than described
            '"resolved": true',
        ])
        self.assertEqual([], missing, f"{MIGRATION_DOCS} no longer documents the confirmDispositions channel: {missing}")

    def test_the_four_disposition_words_are_named_and_a_wrong_word_leaves_the_row_open(self):
        text = read_text(MIGRATION_DOCS)
        missing = missing_markers(text, [
            "accepted",
            "reproduced-manually",
            "resolved-on-stand",
            # the validated-enum rule: a typo must not clear a question nobody answered
            "leaves the row OPEN and the plan names the word that was rejected",
        ])
        self.assertEqual([], missing, f"{MIGRATION_DOCS} no longer states the disposition enum rule: {missing}")

    def test_a_closed_row_stays_auditable_rather_than_vanishing(self):
        text = read_text(MIGRATION_DOCS)
        missing = missing_markers(text, [
            "CLOSED by a recorded disposition",
            "(N open, M closed)",
        ])
        self.assertEqual([], missing, f"{MIGRATION_DOCS} no longer says a closed row is still printed: {missing}")

    def test_decisions_md_is_the_source_of_record(self):
        text = read_text(MIGRATION_DOCS)
        missing = missing_markers(text, [
            "`decisions.md` is still the source of record",
            "how the ENGINE learns the decision",
        ])
        self.assertEqual([], missing, f"{MIGRATION_DOCS} no longer names decisions.md as the source of record: {missing}")

    def test_the_plans_adjustments_list_is_derived_and_overwritten_never_a_record(self):
        text = read_text(MIGRATION_DOCS)
        missing = missing_markers(text, [
            # DERIVED, and why that matters: --plan --out rewrites the whole file
            "every `--plan --out` overwrites `plan.md` wholesale",
            "Never record an answer in the plan",
            # and the same statement where the Adjustments list is introduced
            "the plan's `Adjustments` list is DERIVED",
            "never the place a decision or an answered ⚠ Confirm row is recorded",
        ])
        self.assertEqual([], missing, f"{MIGRATION_DOCS} no longer states that Adjustments is derived: {missing}")


if __name__ == "__main__":
    unittest.main()
