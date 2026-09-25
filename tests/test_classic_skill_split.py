"""Guards on how the classic-to-freedom-migration skill is split across files.

SKILL.md is loaded whole into the driver's context the moment the skill starts,
and loaded text cannot be unloaded. So the body holds what the plan phase always
needs, and every block read by one reader at one moment - the build orchestration,
each sub-agent's brief, a plan-phase step that runs only when its condition holds -
lives in a reference the step that needs it names. These tests keep that shape:
the body cannot regrow past its budget, no line is long enough for a file reader to
truncate it, and the brief a sub-agent is handed is exactly the one its task kind
names in the orchestrator's routing table.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills/classic-to-freedom-migration"
SKILL = SKILL_DIR / "SKILL.md"
REFERENCES = SKILL_DIR / "references"
ORCHESTRATE = REFERENCES / "orchestrate-build.md"
TASKS_ENGINE = SKILL_DIR / "engine/tasks.mjs"

# The body budget, in bytes. The driver pays for every one of them on every run,
# before it has read a single page of the stand.
SKILL_BYTE_BUDGET = 95_000
# A file reader that truncates longer lines hands an agent half a rule and no sign
# that the other half exists.
MAX_LINE_CHARS = 2000

# Every sub-agent brief, by the task kind that is handed it. A brief missing from
# the routing table is a file no sub-agent is ever given.
BRIEFS = (
    "build-task-execution.md",
    "build-page.md",
    "build-scaffolding.md",
    "build-dashboards.md",
    "read-back-brief.md",
    "judge-brief.md",
    "reference-cache-brief.md",
)
# The references this split created; each must be reachable from the body.
NEW_REFERENCES = BRIEFS[1:] + (
    "orchestrate-build.md",
    "behaviour-analysis-run.md",
    "manifest-conditional-inputs.md",
)


def read(path):
    return path.read_text(encoding="utf-8")


def section(text, start, end):
    """The text between the first `start` and the next `end` after it.

    Raises instead of returning an empty slice: a missing anchor would otherwise
    make every containment check below pass while reading nothing.
    """
    begin = text.find(start)
    if begin < 0:
        raise AssertionError(f"anchor {start!r} not found")
    stop = text.find(end, begin + len(start))
    if stop < 0:
        raise AssertionError(f"end anchor {end!r} not found after {start!r}")
    return text[begin:stop]


def brief_table(text):
    """Rows of the task-kind table under step 7.3, as (kind cell, brief paths)."""
    step = section(text, "**7.3 What each sub-agent is handed.**", "**7.4 ")
    rows = []
    for line in step.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if not line.lstrip().startswith("|") or len(cells) < 3 or set(cells[0]) <= set("-: "):
            continue
        paths = re.findall(r"`\./references/([A-Za-z0-9._-]+\.md)`", cells[-1])
        if paths:
            rows.append((cells[0], paths))
    return rows


def brief_table_recognisers(text):
    """The "How to recognise it" cell of every row of the step-7.3 task-kind table."""
    step = section(text, "**7.3 What each sub-agent is handed.**", "**7.4 ")
    cells = []
    for line in step.splitlines():
        row = [c.strip() for c in line.strip().strip("|").split("|")]
        if line.lstrip().startswith("|") and len(row) >= 3 and not set(row[0]) <= set("-: "):
            cells.append(row[1])
    return cells[1:]  # drop the header row


def engine_task_labels():
    """What tasks.mjs writes into a task file's `group:`, `writesTo:` and `kind:` lines.

    Read from the engine source, so a label renamed there is a label renamed here.
    """
    source = read(TASKS_ENGINE)
    consts = dict(re.findall(r'^(?:export )?const (\w+) = "([^"]+)";', source, re.M))
    table = section(source, "const ARTIFACT_LABEL = new Map([", "]);")
    groups = {consts.get(v, v.strip('"')) for v in re.findall(r'\[\w+, (\w+|"[^"]+")\]', table)}
    fallback = re.search(r'const artifactLabel = \(artifact\) =>\s*\n?\s*ARTIFACT_LABEL\.get\(artifact\) \|\| '
                         r'\(artifact\.startsWith\("review:"\) \? (\w+) : "([^"]+)"\);', source)
    if not fallback:
        raise AssertionError("artifactLabel() no longer has the shape this test reads")
    groups |= {consts[fallback.group(1)], fallback.group(2)}
    writes = {consts[k] for k in ("ARTIFACT_SCAFFOLD", "ARTIFACT_WHOLE")}
    return groups, writes, consts["REPAIR_KIND"]


class SkillBodyBudgetTests(unittest.TestCase):
    def test_skill_body_stays_within_its_byte_budget(self):
        size = len(SKILL.read_bytes())
        self.assertLessEqual(
            size, SKILL_BYTE_BUDGET,
            f"SKILL.md is {size} bytes; the budget is {SKILL_BYTE_BUDGET}. Move text a single "
            "reader needs at a single moment into the reference that reader is handed.",
        )

    def test_no_line_is_long_enough_to_be_truncated(self):
        files = [SKILL, *sorted(REFERENCES.glob("*.md"))]
        self.assertGreater(len(files), 1, "no reference files found")
        long_lines = []
        for path in files:
            for number, line in enumerate(read(path).splitlines(), 1):
                if len(line) > MAX_LINE_CHARS:
                    long_lines.append(f"{path.name}:{number} ({len(line)} chars)")
        self.assertFalse(long_lines, f"lines over {MAX_LINE_CHARS} chars: {long_lines}")


class BriefRoutingTableTests(unittest.TestCase):
    def test_every_brief_the_table_names_exists(self):
        rows = brief_table(read(ORCHESTRATE))
        self.assertGreaterEqual(len(rows), 6, f"the 7.3 task-kind table has {len(rows)} rows")
        for kind, paths in rows:
            for name in paths:
                self.assertTrue((REFERENCES / name).is_file(), f"{kind}: {name} does not exist")

    def test_every_brief_file_is_named_in_the_table(self):
        named = {name for _, paths in brief_table(read(ORCHESTRATE)) for name in paths}
        on_disk = {
            p.name for p in REFERENCES.glob("*.md")
            if p.name.startswith("build-") or p.name.endswith("-brief.md")
        }
        self.assertFalse(set(BRIEFS) - on_disk, f"brief files missing: {set(BRIEFS) - on_disk}")
        self.assertFalse(on_disk - named, f"briefs no task kind is handed: {on_disk - named}")

    def test_the_table_recognises_tasks_by_the_labels_the_engine_writes(self):
        # The table is the only place that decides which briefs a sub-agent gets, and it
        # keys on strings tasks.mjs writes. A label renamed on one side only would send a
        # task to the "not recognised" fallback while every other guard stays green.
        groups, writes, repair = engine_task_labels()
        self.assertGreaterEqual(len(groups), 5, f"read only {groups} from tasks.mjs")
        cells = " ".join(brief_table_recognisers(read(ORCHESTRATE)))
        table_groups = {g.rstrip("…").strip() for g in re.findall(r"`group: ([^`]+)`", cells)}
        self.assertEqual(table_groups, groups,
                         "the 7.3 table's `group:` labels and the engine's task groups differ")
        table_writes = set(re.findall(r"`writesTo: ([a-z]+)`", cells))
        self.assertEqual(table_writes, writes,
                         "the 7.3 table's `writesTo:` values and the engine's artifacts differ")
        self.assertIn(f"`kind: {repair}`", cells, "the repair row does not use the engine's repair kind")

    def test_the_mapping_reference_goes_to_every_page_builder(self):
        rows = brief_table(read(ORCHESTRATE))
        page_rows = [paths for kind, paths in rows if "build-page.md" in paths]
        self.assertTrue(page_rows, "no task kind is handed build-page.md")
        for paths in page_rows:
            self.assertIn("classic-to-freedom-mapping.md", paths)
            self.assertIn("build-task-execution.md", paths)


class ReferencePlacementTests(unittest.TestCase):
    """Each moved block is cited from the step that needs it, not only listed."""

    def test_step_7_sends_the_driver_to_the_orchestration_reference_once(self):
        step7 = section(read(SKILL), "### 7. Implement The Approved Plan", "### 8.")
        self.assertIn("./references/orchestrate-build.md", step7)
        self.assertIn("ONCE", step7)
        self.assertIn("--tasks <migration-folder>/build-tasks --next", step7)
        self.assertIn("do not pick one from `index.md`", step7)

    def test_step_5_1_cites_the_behaviour_analysis_run(self):
        step51 = section(read(SKILL), "**5.1 — ", "**Complex components carry a required SHAPE")
        self.assertIn("./references/behaviour-analysis-run.md", step51)
        self.assertIn("`stubs: 0`", step51)
        self.assertIn("BEFORE the final `--plan --out`", step51)
        self.assertIn("`manifest.behaviourIndex`", step51)

    def test_step_4_2_cites_the_conditional_manifest_inputs(self):
        step42 = section(read(SKILL), "**4.2 — ", "**4.3 — ")
        self.assertIn("./references/manifest-conditional-inputs.md", step42)
        # One citation per section of the reference, each pointing at that section.
        anchors = re.findall(r"^## (.+?) — ", read(REFERENCES / "manifest-conditional-inputs.md"), re.M)
        self.assertGreaterEqual(len(anchors), 5, f"reference sections found: {anchors}")
        for anchor in anchors:
            self.assertIn(
                f"`./references/manifest-conditional-inputs.md` → *{anchor}*", step42,
                f"step 4.2 does not cite the {anchor!r} section of the reference",
            )
        # Each citation stays behind the signal that makes it apply.
        for trigger in (
            "`changeSet.profileCards`",
            "record `manifest.addRecordMiniPage: false` when there is verifiably none",
            "when chain 1 returns any dashboard",
            "open a different edit page per Type",
            "tells you a child entity has a section of its own",
        ):
            self.assertIn(trigger, step42, f"step 4.2 lost the condition {trigger!r}")

    def test_step_3_1_cites_the_scaffolding_brief(self):
        step31 = section(read(SKILL), "**3.1 — ", "### 4. ")
        self.assertIn("./references/build-scaffolding.md", step31)

    def test_step_8_keeps_the_browser_check_and_the_final_gate(self):
        step8 = section(read(SKILL), "### 8. Validate", "## References")
        self.assertIn("./references/freedom-ui-browser-check.md", step8)
        self.assertIn("--verify --from <migration-folder> --tasks <migration-folder>/build-tasks", step8)
        self.assertIn("Present that file verbatim", step8)

    def test_references_section_lists_every_new_file(self):
        refs = section(read(SKILL), "## References", "## Known Traps")
        missing = [n for n in NEW_REFERENCES if f"`./references/{n}`" not in refs]
        self.assertFalse(missing, f"References section does not list {missing}")


if __name__ == "__main__":
    unittest.main()
