"""ENG-96571 — three instruction gaps the Applicants run paid for, pinned where a driver reads them.

Each group below locks one measured loss:

1. **Polling a running workflow.** The `Workflow` tool returns its result and a task-notification
   announces completion, and `behaviour-index.json` is written only in the Merge phase — so a
   sleep-loop watching for it can only ever observe "not there yet". One run spent 72 minutes,
   27 turns and 8.09M cache-read tokens (17% of the session) doing exactly that, plus a Bash
   loop killed by the 600 s limit.
2. **Explicit full autonomy was undefined.** The skill has three blocking `AskUserQuestion`
   points and said nothing about a run the user handed full autonomy, so the agent improvised.
   The clause now names the substitution AND the two things a grant never covers; a clause
   stated once in the Contract and referenced nowhere is a clause no driver finds, so all three
   sites are pinned too.
3. **Three clio arg-facts read wrong.** `ping` was read as an MCP tool name (`unknown tool
   'ping'`), `get-component-info` was called with `search-pattern`, and step 4.0's `output-file`
   pointed at an agent scratch dir clio's validator refuses (55 s lost).

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


class WorkflowNoPollingDocTests(unittest.TestCase):
    def test_pinned_doc_is_present_and_non_empty(self):
        # The negative pins in this module pass vacuously on empty text, so they rest on this guard.
        self.assertTrue(read_text(MIGRATION_SKILL).strip(), f"{MIGRATION_SKILL} is empty")

    def test_route_one_forbids_polling_and_names_the_two_real_channels(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "**NEVER poll a running workflow.**",
                "task-notification arrives when the run completes",
                "it is written in the **Merge** phase",
                "`subagents/workflows/<runId>/journal.jsonl` **ONCE per notification**",
                "never on a timer",
            ],
        )
        self.assertFalse(missing, f"route 1 must carry the no-polling rule; missing {missing}")

    def test_the_measured_cost_of_polling_is_stated(self):
        # A rule with no consequence gets read as advice. These are the run's own figures.
        content = flat(read_text(MIGRATION_SKILL))
        for figure in ("72 minutes", "27 turns", "8.09M cache-read tokens", "17% of the session",
                       "killed by the 600 s limit"):
            self.assertIn(figure, content, f"the no-polling rule must state its measured cost: {figure}")

    def test_no_polling_pins_are_not_satisfied_by_pre_existing_text(self):
        """Anti-vacuity: each phrase this ticket introduced must occur EXACTLY ONCE.

        A pin a second unrelated occurrence already satisfies cannot fail when the sentence it is
        named for is rewritten.
        """
        doc = read_text(MIGRATION_SKILL).replace("**", "")
        for phrase in ("NEVER poll a running workflow.",
                       "journal.jsonl",
                       "8.09M cache-read tokens"):
            self.assertEqual(doc.count(phrase), 1, f"expected exactly one occurrence of {phrase!r}")


class AutonomousModeClauseDocTests(unittest.TestCase):
    CLAUSE_NAME = "AUTONOMOUS-MODE CLAUSE"

    def test_the_clause_states_the_substitution(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                self.CLAUSE_NAME,
                "every `AskUserQuestion` in this skill is replaced by",
                "take the option this skill RECOMMENDS",
                "record it in `decisions.md` with status **`(assumption)`**",
                "repeat it in the final summary as a changeable item",
            ],
        )
        self.assertFalse(missing, f"the autonomy clause must state the substitution; missing {missing}")

    def test_the_clause_names_the_two_never_autonomous_things(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "**plan approval is NEVER autonomous**",
                "the run stops at the ready plan and waits",
                "**stand-mutating action beyond what the approved plan lists**",
            ],
        )
        self.assertFalse(missing, f"a grant must not cover the two gates; missing {missing}")

    def test_the_route_gate_decides_instead_of_waiting_under_autonomy(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "Under an explicit grant of full autonomy there is nobody to answer, so do not ask",
                "Take **route 1** when `Workflow` is available; otherwise take **route 3**",
                "write what that costs into `worklog.md`",
                "Stopping to wait for an answer that cannot arrive",
            ],
        )
        self.assertFalse(missing, f"the ROUTE GATE must resolve itself under autonomy; missing {missing}")

    def test_all_three_blocking_dialog_points_reference_the_clause(self):
        """The clause has to be reachable from each place that blocks, not only from the Contract.

        Three sites: the section-boundary guard-rail (step 4.2), the ROUTE GATE (step 5.1), and the
        Adjustments decision rule (step 6). A clause stated once and cross-referenced nowhere is the
        same invisible instruction this ticket is closing.
        """
        content = flat(read_text(MIGRATION_SKILL))
        self.assertGreaterEqual(
            content.count(self.CLAUSE_NAME), 4,
            "the clause plus all three referencing sites must name it",
        )
        missing = missing_markers(
            content,
            [
                # step 4.2 — the section boundary
                "record it `(assumption)` per the Contract's AUTONOMOUS-MODE CLAUSE",
                # step 5.1 — the ROUTE GATE
                "decide (Contract's AUTONOMOUS-MODE CLAUSE)",
                # step 6 — the Adjustments split
                "the Contract's AUTONOMOUS-MODE CLAUSE; plan approval still stops the run",
            ],
        )
        self.assertFalse(missing, f"each blocking point must reference the clause; missing {missing}")

    def test_the_blocking_questions_still_stand_without_a_grant(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "Where the autonomy clause is silent, the blocking question stands.",
                "Without a grant, nothing here changes",
            ],
        )
        self.assertFalse(missing, f"the clause must not widen into a default; missing {missing}")


class ClioArgFactsDocTests(unittest.TestCase):
    def test_ping_cannot_be_read_as_an_mcp_tool(self):
        # The literal that was read as a tool name. It has to be GONE, and the sentence that
        # replaced it has to name the two calls that really confirm connectivity — a bare
        # absence pin would also pass if the whole paragraph were deleted.
        content = flat(read_text(MIGRATION_SKILL))
        self.assertNotIn("clio ping", content, "the `clio ping` literal reads as an MCP tool name")
        missing = missing_markers(
            content,
            [
                "**Do not reach for a `ping` tool to check that — there is no `ping` MCP tool**",
                "`unknown tool 'ping'`",
                "Connectivity is confirmed AFTER `reg-web-app` by `list-environments`",
                "plus one real read — `get-app-info`",
            ],
        )
        self.assertFalse(missing, f"the replacement must name the real check; missing {missing}")

    def test_get_component_info_takes_search(self):
        content = flat(read_text(MIGRATION_SKILL))
        self.assertIn("`get-component-info` takes **`search`** — **not** `search-pattern`", content)
        self.assertIn("rejected as an unknown argument", content,
                      "the arg-fact must state what a wrong name costs")

    def test_find_entity_schema_needs_the_wrapped_shape(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "`find-entity-schema` is resident and takes that same wrapped shape",
                '`{"args": { … }}`',
                "a top-level payload is rejected as a bad request",
            ],
        )
        self.assertFalse(missing, f"the wrapped-shape fact must cover find-entity-schema; missing {missing}")

    def test_step_4_0_takes_the_output_path_from_tmpdir(self):
        """The path rule is anchored by its neighbours, not by an occurrence count.

        `$TMPDIR` legitimately appears elsewhere in this file (the temp policy for classic bodies),
        so this pin proves the rule is at the `output-file` site by co-occurrence in one paragraph.
        """
        paragraph = next(
            (line for line in read_text(MIGRATION_SKILL).splitlines()
             if "get-classic-page-sources" in line and "output-file" in line and "$TMPDIR" in line),
            None,
        )
        self.assertIsNotNone(paragraph, "step 4.0's output-file paragraph must carry the $TMPDIR rule")
        missing = missing_markers(
            paragraph,
            [
                "**Take the output path from `echo $TMPDIR`**",
                "accepts only the workspace or the directory `$TMPDIR` reports",
                "`resolves outside the allowed locations`",
                "measured 55 s lost",
            ],
        )
        self.assertFalse(missing, f"the $TMPDIR rule must state the rejection and its cost; missing {missing}")

    def test_the_superseded_scratch_dir_wording_is_gone(self):
        # The exact instruction that sent a run at an agent scratch dir clio refuses.
        self.assertNotIn(
            "Point `--output-file` at your scratch dir, never the repo",
            flat(read_text(MIGRATION_SKILL)),
        )


if __name__ == "__main__":
    unittest.main()
