"""Guards on how the classic-to-freedom-migration build hands off to a fresh session.

Every build turn pays for the whole conversation before it, so a driver that
planned and then built in one session carried discovery and planning into each
of hundreds of build turns. After approval the build loop is handed to a fresh
session: the engine writes `resume.md` (`--tasks <dir> --handoff`), the driver
gives the user one prompt to paste and stops, and the fresh session reads that
file and the orchestration reference instead of steps 0-6. These tests keep the
two hand-off points, the resume entry and its reading list in the skill text.
"""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills/classic-to-freedom-migration"
SKILL = SKILL_DIR / "SKILL.md"
ORCHESTRATE = SKILL_DIR / "references/orchestrate-build.md"
ENGINE_README = SKILL_DIR / "engine/README.md"

HANDOFF_CMD = "--tasks <migration-folder>/build-tasks --handoff"
SKILL_BYTE_BUDGET = 95_000


def read(path):
    return path.read_text(encoding="utf-8")


def section(text, start, end):
    """The text between the first `start` and the next `end` after it.

    Raises instead of returning an empty slice: a missing anchor would otherwise
    make every containment check below pass while reading nothing.
    """
    begin = text.find(start)
    if begin < 0:
        raise AssertionError(f"anchor not found: {start!r}")
    stop = text.find(end, begin + len(start))
    if stop < 0:
        raise AssertionError(f"end anchor not found after {start!r}: {end!r}")
    return text[begin:stop]


class HandOffPointTests(unittest.TestCase):
    """7.1b names both hand-off points, the command, and the stop."""

    def setUp(self):
        self.text = read(ORCHESTRATE)
        self.handoff = section(self.text, "**7.1b Hand off to a fresh session", "**7.2 ")

    def test_7_1b_sits_between_slicing_and_the_contract(self):
        self.assertLess(self.text.find("**7.1 Record the approval"), self.text.find("**7.1b "))
        self.assertLess(self.text.find("**7.1b "), self.text.find("**7.2 The orchestrator contract"))

    def test_7_1b_names_the_handoff_command(self):
        self.assertIn(HANDOFF_CMD, self.handoff)

    def test_7_1b_names_both_handoff_points(self):
        self.assertIn("more than one task", self.handoff)
        self.assertIn("opens repair tasks", self.handoff)

    def test_7_1b_says_to_stop(self):
        self.assertIn("STOP", self.handoff)
        self.assertIn("fresh session", self.handoff)

    def test_7_1b_says_the_driver_does_not_write_the_resume(self):
        self.assertIn("never write `resume.md` yourself", self.handoff)

    def test_step_8_names_the_post_verify_handoff(self):
        begin = self.text.find("## Step 8 — the driver's side")
        self.assertGreaterEqual(begin, 0, "step 8 heading not found")
        step8 = self.text[begin:]
        self.assertIn("--handoff", step8)
        self.assertIn("7.1b", step8)
        self.assertIn("repair tasks", step8)


class ResumeSectionTests(unittest.TestCase):
    """The Resuming section names exactly what the fresh driver reads before --next."""

    def setUp(self):
        self.resuming = section(read(ORCHESTRATE), "## Resuming", "## Step 7")

    def test_it_reads_resume_md_then_asks_next(self):
        self.assertIn("`resume.md`", self.resuming)
        self.assertIn("--tasks <migration-folder>/build-tasks --next", self.resuming)

    def test_it_names_what_it_does_not_read(self):
        self.assertIn("steps 0-6", self.resuming)
        for name in ("discovery.md", "plan.md"):
            self.assertIn(name, self.resuming, f"Resuming does not rule out {name}")

    def test_it_keeps_route_and_approval_from_the_resume(self):
        self.assertIn("`Route:`", self.resuming)
        self.assertIn("plan version", self.resuming)

    def test_it_forbids_re_reading_the_planning_material(self):
        # The names alone would pass a section that told the fresh driver to read them.
        self.assertIn("Do not re-read `discovery.md`, `plan.md`, the manifest", self.resuming)
        self.assertIn("Do not widen what you read", self.resuming)

    def test_it_takes_the_manifest_copy_from_the_resume(self):
        self.assertIn("`resume-manifest.json`", self.resuming)


class WholeReadsAgreeTests(unittest.TestCase):
    """The build's whole-read list and the Resuming section name the same reads for a resumed session."""

    def test_both_passages_name_resume_md_and_this_file_only(self):
        text = read(ORCHESTRATE)
        reads = section(text, "**Your own whole reads, each once:**", "## Resuming")
        self.assertIn("`resume.md` and this file instead, and nothing else", reads)
        resuming = section(text, "## Resuming", "## Step 7")
        self.assertIn("the two are your only whole reads", resuming)
        self.assertIn("`decisions.md`\n   and `worklog.md` are targeted reads", resuming)


class ManifestCopyTests(unittest.TestCase):
    """--handoff copies the manifest into the folder; the clean-up deletes that copy too."""

    def test_7_1b_names_the_copy(self):
        handoff = section(read(ORCHESTRATE), "**7.1b Hand off to a fresh session", "**7.2 ")
        self.assertIn("`resume-manifest.json`", handoff)

    def test_the_step_4_2_clean_up_names_the_copy(self):
        clean_up = section(read(SKILL), "**Clean up (step 4.2 inputs).**", "\n")
        self.assertIn("`resume-manifest.json`", clean_up)

    def test_the_template_value_line_holds_only_the_version(self):
        doc = read(SKILL_DIR / "references/migration-documentation.md")
        template = section(doc, "### decisions.md\n```markdown", "### worklog.md")
        self.assertIn("- Plan version: plan-<hash>\n", template)


class SkillRouteTests(unittest.TestCase):
    """SKILL.md routes a folder with resume.md to the resume path, within budget."""

    def test_inputs_route_a_resume_folder(self):
        inputs = section(read(SKILL), "## Inputs", "## Migration Scope")
        self.assertIn("`resume.md`", inputs)
        self.assertIn("steps 0-6", inputs)
        self.assertIn("./references/orchestrate-build.md", inputs)

    def test_step_7_names_the_handoff(self):
        step7 = section(read(SKILL), "### 7. Implement The Approved Plan", "### 8.")
        self.assertIn("--handoff", step7)
        self.assertIn("7.1b", step7)

    def test_skill_body_stays_within_its_byte_budget(self):
        self.assertLessEqual(len(SKILL.read_bytes()), SKILL_BYTE_BUDGET)


class EngineReadmeTests(unittest.TestCase):
    def test_readme_documents_the_mode(self):
        readme = read(ENGINE_README)
        self.assertIn("--handoff", readme)
        self.assertIn("resume.md", readme)

    def test_readme_states_the_refusals_the_code_makes(self):
        entry = section(read(ENGINE_README), "- **`--handoff` moves the build loop", "- **`--start` enforces")
        self.assertIn("in stages", entry)
        self.assertNotIn("at once, no", entry)
        for fragment in ("plan-level gaps", "stdin", "`Approved by:`", "`## ` entry",
                         "`Route: TBD` is no route", "cites", "`ledger` or `stuck`", "`resume-manifest.json`"):
            self.assertIn(fragment, entry)


if __name__ == "__main__":
    unittest.main()
