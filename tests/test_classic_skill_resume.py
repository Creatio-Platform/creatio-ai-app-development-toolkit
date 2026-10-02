"""Guards on where the classic-to-freedom-migration build runs once the plan is sliced.

Every build turn pays for the whole conversation before it, so a driver that
planned and then built in one session carried discovery and planning into each
of hundreds of build turns. After approval the engine writes `resume.md`
(`--tasks <dir> --handoff`) and the driver ASKS the user where the build runs:
a new session that pastes one prompt, this session as it is, or this session
after `/compact`. The answer is recorded once in `worklog.md` and the step-8
repair round follows it. These tests keep the gate, its three answers, the
resume entry and its reading list in the skill text.
"""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills/classic-to-freedom-migration"
SKILL = SKILL_DIR / "SKILL.md"
ORCHESTRATE = SKILL_DIR / "references/orchestrate-build.md"
ENGINE_README = SKILL_DIR / "engine/README.md"

HANDOFF_CMD = "--tasks <migration-folder>/build-tasks --handoff"
GATE_HEADING = "**7.1b The BUILD SESSION GATE"
COMPACT_NOTE = "`/compact Keep only: migration folder <migration-folder>.`"
CONTINUE_MESSAGE = "`Continue the build from <migration-folder>/resume.md.`"
OPTION_LABELS = ("New session (Recommended)", "Continue here", "Compress here")
WORKLOG_LINE = "`Build session: new | here | compact`"
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


def bullet(text, label):
    """The bullet that opens on `label`, up to the next bullet or the end of its list."""
    begin = text.find(label)
    if begin < 0:
        raise AssertionError(f"anchor not found: {label!r}")
    rest = text[begin:]
    ends = [i for i in (rest.find("\n- "), rest.find("\n\n")) if i > 0]
    return rest[:min(ends)] if ends else rest



class HandOffPointTests(unittest.TestCase):
    """7.1b runs the hand-off, then asks where the build runs."""

    def setUp(self):
        self.text = read(ORCHESTRATE)
        self.handoff = section(self.text, GATE_HEADING, "**7.2 ")

    def test_7_1b_sits_between_slicing_and_the_contract(self):
        self.assertLess(self.text.find("**7.1 Record the approval"), self.text.find("**7.1b "))
        self.assertLess(self.text.find("**7.1b "), self.text.find("**7.2 The orchestrator contract"))

    def test_7_1b_names_the_handoff_command(self):
        self.assertIn(HANDOFF_CMD, self.handoff)

    def test_7_1b_names_both_handoff_points(self):
        self.assertIn("more than one task", self.handoff)
        self.assertIn("opens repair tasks", self.handoff)

    def answer(self, label):
        """The per-answer bullet that opens on `label`, up to the next bullet."""
        return bullet(self.handoff, f"- **{label}**")

    def test_7_1b_is_a_gate_that_asks_once(self):
        self.assertIn("BUILD SESSION GATE", self.handoff)
        self.assertIn("exactly ONE `AskUserQuestion`", self.handoff)
        self.assertIn("names the task count", self.handoff)
        self.assertIn("stop until it is answered", self.handoff)

    def test_7_1b_offers_three_options_with_their_cost(self):
        for label in OPTION_LABELS:
            self.assertIn(label, self.handoff, f"7.1b does not offer {label!r}")
        self.assertIn("every build step then starts small", self.handoff)
        self.assertIn("carries the whole planning conversation", self.handoff)
        self.assertIn("a smaller saving than a new session", self.handoff)

    def test_7_1b_asks_only_over_the_budget(self):
        self.assertIn("over `TASK_BUDGET.run`", self.handoff)
        self.assertIn("A run within `TASK_BUDGET.run` is not asked", self.handoff)

    def test_stop_belongs_to_the_new_session_answer_alone(self):
        new = self.answer("New session")
        self.assertIn("STOP", new)
        self.assertIn("no `--start`", new)
        self.assertEqual(self.handoff.count("STOP"), new.count("STOP"),
                         "7.1b stops outside the new-session answer")

    def test_7_1b_says_the_driver_does_not_write_the_resume(self):
        self.assertIn("never write `resume.md` yourself", self.handoff)

    def test_step_8_names_the_post_verify_handoff(self):
        begin = self.text.find("## Step 8 — the driver's side")
        self.assertGreaterEqual(begin, 0, "step 8 heading not found")
        step8 = self.text[begin:]
        self.assertIn("--handoff", step8)
        self.assertIn("7.1b", step8)
        self.assertIn("repair tasks", step8)

    def test_step_8_follows_the_recorded_build_session(self):
        repairs = section(self.text, "**When that run opens repair tasks", "**`--verify --built <file>`")
        self.assertIn("`Build session:`", repairs)
        self.assertIn("without asking again", repairs)

        def branch(label):
            return bullet(repairs, f"- {label}")

        new = branch("*new*")
        self.assertIn(HANDOFF_CMD, new)
        self.assertIn("STOP", new)
        compact = branch("*compact*")
        self.assertIn("compress steps", compact)
        self.assertIn("end the turn", compact)
        self.assertIn("*Resuming*", compact)
        here = branch("*here*")
        self.assertIn("in this session with `--next`", here)
        self.assertNotIn("STOP", here)
        unasked = branch("*no `Build session:` line*")
        self.assertIn("TASK_BUDGET.run", unasked)
        self.assertIn("in this session with `--next`", unasked)


class BuildSessionAnswerTests(unittest.TestCase):
    """Each 7.1b answer names its action; option 3 is offered only where `/compact` exists."""

    def setUp(self):
        self.handoff = section(read(ORCHESTRATE), GATE_HEADING, "**7.2 ")

    def answer(self, label):
        return bullet(self.handoff, f"- **{label}**")

    def test_new_session_gives_the_resume_prompt(self):
        self.assertIn("resume prompt", self.answer("New session"))

    def test_continue_here_runs_the_loop_in_this_session(self):
        here = self.answer("Continue here")
        self.assertIn("--next", here)
        self.assertIn("7.2", here)

    def test_compress_here_gives_the_compact_line_and_ends_the_turn(self):
        compact = self.answer("Compress here")
        self.assertIn(COMPACT_NOTE, compact)
        self.assertIn(CONTINUE_MESSAGE, compact)
        self.assertIn("end the turn", compact)
        self.assertIn("*Resuming*", compact)

    def test_the_answer_is_recorded_before_any_stop(self):
        # A new or compacted session learns the choice only from worklog.md; a driver that
        # stops first never writes it.
        record = self.handoff.index("first record it")
        self.assertLess(record, self.handoff.index("**STOP**"))
        self.assertLess(record, self.handoff.index("end the turn"))
        self.assertIn("BEFORE anything below", self.handoff)

    def test_option_3_is_offered_only_on_a_host_with_compact(self):
        self.assertIn("only on a host that has `/compact` (Claude Code, Codex CLI)", self.handoff)
        self.assertIn("ask with options 1 and 2", self.handoff)

    def test_the_answer_is_recorded_once_and_can_change(self):
        self.assertIn(WORKLOG_LINE, self.handoff)
        self.assertIn("`worklog.md`", self.handoff)
        self.assertIn("once per run", self.handoff)
        self.assertIn("update the line", self.handoff)


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

    def test_it_names_both_entries(self):
        self.assertIn("a new session", self.resuming)
        self.assertIn("after `/compact`", self.resuming)

    def test_it_does_not_say_the_build_always_moves(self):
        self.assertNotIn("The build loop runs in a fresh session once the plan is sliced", self.resuming)


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
        handoff = section(read(ORCHESTRATE), GATE_HEADING, "**7.2 ")
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

    def test_step_7_asks_where_the_build_runs(self):
        step7 = section(read(SKILL), "### 7. Implement The Approved Plan", "### 8.")
        line = section(step7, "**7.1b ", "**7.2 ")
        self.assertIn("ASK where the build runs", line)
        self.assertIn("new session, here, or `/compact`", line)
        self.assertNotIn("relay its prompt for a fresh", line)

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
