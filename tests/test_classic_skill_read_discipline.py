"""Guards on how the classic-to-freedom-migration briefs tell an agent to read.

Every byte a command prints stays in the agent's conversation for the rest of its
task and is paid for again on every later turn. So each brief an agent role is
handed carries the same read-discipline block, inline - an agent does not fetch a
reference it is only pointed at - and the instructions that would drive a
whole-document read are written as targeted reads instead. These tests keep the
block present and identical everywhere it is inlined, and keep the role-specific
instructions from sliding back to whole reads.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills/classic-to-freedom-migration"
SKILL = SKILL_DIR / "SKILL.md"
REFERENCES = SKILL_DIR / "references"

START = "<!-- read-discipline:start -->"
END = "<!-- read-discipline:end -->"

# Every file an agent role is handed as its read contract: the four briefs a
# sub-agent receives and the orchestrator's own build reference.
CARRIERS = (
    "build-task-execution.md",
    "judge-brief.md",
    "read-back-brief.md",
    "reference-cache-brief.md",
    "orchestrate-build.md",
)

# The largest pointer SKILL.md may carry; the full block lives in the references.
POINTER_MAX_BYTES = 350


def read(path):
    return path.read_text(encoding="utf-8")


def block(text, name):
    """The read-discipline block of one file, markers included.

    Raises instead of returning an empty string: a missing block would otherwise
    compare equal to another missing block and pass the identity check.
    """
    begin = text.find(START)
    if begin < 0:
        raise AssertionError(f"{name}: read-discipline block not found")
    if text.find(START, begin + len(START)) >= 0:
        raise AssertionError(f"{name}: read-discipline block appears more than once")
    stop = text.find(END, begin)
    if stop < 0:
        raise AssertionError(f"{name}: read-discipline block is not closed")
    return text[begin : stop + len(END)]


def flat(text):
    """Text with line breaks folded, so a phrase wrapped across lines still matches."""
    return re.sub(r"\s+", " ", text)


class ReadDisciplineBlockTests(unittest.TestCase):
    def test_every_carrier_holds_the_block_byte_identical(self):
        blocks = {name: block(read(REFERENCES / name), name) for name in CARRIERS}
        reference = blocks[CARRIERS[0]]
        drifted = [name for name, text in blocks.items() if text != reference]
        self.assertFalse(
            drifted,
            f"read-discipline block differs from {CARRIERS[0]} in: {drifted}. The block is "
            "inlined, not linked, so every copy must be edited together.",
        )

    def test_the_block_names_each_rule(self):
        text = flat(block(read(REFERENCES / CARRIERS[0]), CARRIERS[0]))
        required = {
            "output over the threshold goes to a file": "~200 lines or ~8 KB",
            "the locate step": "grep -n",
            "the window step": "sed -n",
            "chunked paging is a full read": "in chunks is a full read",
            "JSON is queried, not printed": "Query JSON, never print it whole",
            "the query tool": "node -e",
            "no re-read of held files": "Do not re-read",
            "a worked targeted read": "A good targeted read",
            "the whole-read exceptions": "When a whole read is right",
            "own task file is a whole read": "your own task file",
        }
        missing = [what for what, phrase in required.items() if phrase not in text]
        self.assertFalse(missing, f"read-discipline block lacks: {missing}")

    def test_skill_body_points_at_the_block_within_budget(self):
        lines = [line for line in read(SKILL).splitlines() if "**Read discipline**" in line]
        self.assertEqual(len(lines), 1, "SKILL.md must carry exactly one read-discipline pointer")
        pointer = lines[0]
        self.assertIn("./references/orchestrate-build.md", pointer)
        size = len(pointer.encode("utf-8"))
        self.assertLessEqual(size, POINTER_MAX_BYTES, f"the pointer is {size} bytes")


class BuilderReadTests(unittest.TestCase):
    def setUp(self):
        self.text = flat(read(REFERENCES / "build-task-execution.md"))

    def test_builder_is_not_told_to_re_read_the_whole_plan(self):
        self.assertNotIn("Re-read the approved `plan.md`", self.text)

    def test_builder_starts_from_its_task_file_and_reads_one_plan_section(self):
        for phrase in (
            "your own task file first",
            "read that section alone",
            "never the whole plan",
        ):
            self.assertIn(phrase, self.text)

    def test_builder_reads_cited_cards_by_id(self):
        self.assertIn("by its id", self.text)
        self.assertIn("customizations-", self.text)


class ReadBackAndJudgeTests(unittest.TestCase):
    def test_read_back_copies_files_instead_of_printing_them(self):
        text = flat(read(REFERENCES / "read-back-brief.md"))
        self.assertIn("whole, never a slice", text)
        self.assertIn("Copy, do not print", text)
        for route in ("`cp`", "redirect", "--output-file"):
            self.assertIn(route, text)

    def test_judge_queries_its_records_by_id(self):
        text = flat(read(REFERENCES / "judge-brief.md"))
        self.assertIn("Query the records by id, never print them whole", text)
        for record in ("`evidence.json`", "`judge.json`", "`findings.md`"):
            self.assertIn(record, text)


if __name__ == "__main__":
    unittest.main()
