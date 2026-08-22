"""ENG-95503 — the answered-⚠-Confirm channel must be named where the DRIVER reads.

The engine and the executor both implement the channel: `--units --resolutions` attaches an
operator's answer to the queue item that asked it, and the executor hands it to the builder for
that page. A full Applicant1Section run still shipped every ⚠ Confirm item with
`resolution: null` and no `resolutions.json` anywhere in the migration folder — because the one
instruction a driving agent actually executes named `decisions.md` as "what the build reads",
while the corrected wording lived only in the reference doc. An instruction gap is invisible to
every engine test, so it gets its own lock here: the channel has to be named at the step that
records an answer, in the doc-set list, and in the step-7 hand-over, and the superseded claim
must not survive anywhere in the file.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MIGRATION_SKILL = ROOT / "skills/classic-to-freedom-migration/SKILL.md"
MIGRATION_DOCS = ROOT / "skills/classic-to-freedom-migration/references/migration-documentation.md"


def read_text(path):
    return path.read_text(encoding="utf-8").replace("’", "'")


def flat(text):
    """Collapse whitespace runs so a pin survives a Markdown re-wrap."""
    return re.sub(r"\s+", " ", text)


def missing_markers(text, markers):
    flattened = flat(text)
    return [marker for marker in markers if flat(marker) not in flattened]


class ResolutionsChannelDocTests(unittest.TestCase):
    def test_pinned_docs_are_present_and_non_empty(self):
        # The negative pin below passes vacuously on empty text, so it rests on this guard.
        for path in (MIGRATION_SKILL, MIGRATION_DOCS):
            self.assertTrue(read_text(path).strip(), f"{path} is empty")

    def test_answer_recording_step_names_the_machine_channel(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "Record every answer TWICE",
                "in `resolutions.json` for the build",
                "does NOT reach the builder",
                "copied VERBATIM from `--units.preflight`",
            ],
        )
        self.assertFalse(missing, f"the answer-recording step must name the channel; missing {missing}")

    def test_the_superseded_claim_is_gone(self):
        # The exact sentence measured on the failed run: it told every driving agent that
        # recording the answer in `decisions.md` was enough for the build to read it.
        self.assertNotIn(
            "Record every answer in `decisions.md` (it is what the build reads)",
            flat(read_text(MIGRATION_SKILL)),
        )

    def test_doc_set_list_carries_the_resolutions_file_at_both_scopes(self):
        content = flat(read_text(MIGRATION_SKILL))
        self.assertIn("- **Scale to scope:**", content, "the doc-set bullet is gone — re-anchor this pin")
        # BOTH halves of that bullet, each pinned by its own neighbours: a file named only in the
        # whole-package list is a file a single-section run never writes, and every run this ticket
        # measured was single-section.
        missing = missing_markers(
            content,
            [
                "`worklog.md` + `decisions.md` + `resolutions.json`",     # single-section
                "`decisions.md`, `resolutions.json`, `worklog.md`",       # whole-package
                "it is the ONLY channel that carries an answered",
            ],
        )
        self.assertFalse(missing, f"both scopes must list the file; missing {missing}")

    def test_handover_step_says_to_write_the_file_before_launching(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "WRITE `resolutions.json` into that output dir BEFORE you launch",
                "every build agent is handed `resolution: null`",
                "do not fall back to `findings`",
            ],
        )
        self.assertFalse(missing, f"the hand-over step must own writing the file; missing {missing}")

    def test_reference_doc_and_skill_agree_on_the_key(self):
        # The two files a driver may read in either order must not disagree about the key
        # again: that disagreement is the whole defect.
        for path in (MIGRATION_SKILL, MIGRATION_DOCS):
            content = flat(read_text(path))
            self.assertIn("--units.preflight", content, path)
            self.assertIn("`pageKey` half moves between runs", content, path)


if __name__ == "__main__":
    unittest.main()
