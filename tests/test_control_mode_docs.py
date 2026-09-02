"""ENG-96204 — the control mode is a hard precondition, and the docs have to say so where the DRIVER reads.

The engine and the executor both implement it: an absent `mode` returns `stopped: 'mode-not-chosen'`
before any stand write, the two round-boundary modes stop after a round, and the operator's answers
travel as run-scoped entries in `resolutions.json`. None of that is reachable if the skill that
LAUNCHES the build still tells a driving agent that `auto` is the default it may apply silently — an
instruction gap is invisible to every engine test, which is why ENG-95503's channel needed its own
lock here and why this one does too.

Four things are pinned, each in the file whose reader depends on it:

* the migration skill (the launcher, and the only thing that can ask a human) must present the mode
  as REQUIRED, offer both new modes, name the non-interactive escape, and name the round-boundary
  stop's artifacts;
* the executor skill (the contract the build runs under) must state the refusal, the two stop
  mechanisms, and the run-scoped answer entries;
* the per-page recipe (what a fresh-context BUILD agent reads) must state the two-pass split and
  which step the layout pass does not own;
* the documentation reference (what a driver reads when it sets the folder up) must list
  `run-status.md` and the reserved `run` kind.

The superseded claim — that an omitted mode means `auto` — must not survive anywhere in the two
skills, because a driving agent that finds it will act on it.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MIGRATION_SKILL = ROOT / "skills/classic-to-freedom-migration/SKILL.md"
EXECUTOR_SKILL = ROOT / "skills/freedom-build-executor/SKILL.md"
BUILD_RECIPE = ROOT / "skills/freedom-build-executor/references/04-per-page-build-recipe.md"
MIGRATION_DOCS = ROOT / "skills/classic-to-freedom-migration/references/migration-documentation.md"

PINNED = (MIGRATION_SKILL, EXECUTOR_SKILL, BUILD_RECIPE, MIGRATION_DOCS)

# The modes, as the operator types them. `buildModes()` in the workflow core is the source of truth;
# this list is the DOC side of the same contract, and the point of the check is that the two agree —
# every mode the run accepts has to be offered somewhere a human can read it.
MODES = ("auto", "checkpoints", "guided", "round1", "layout-first")


def read_text(path):
    return path.read_text(encoding="utf-8").replace("’", "'")


def flat(text):
    """Collapse whitespace runs so a pin survives a Markdown re-wrap."""
    return re.sub(r"\s+", " ", text)


def missing_markers(text, markers):
    flattened = flat(text)
    return [marker for marker in markers if flat(marker) not in flattened]


class ControlModeDocTests(unittest.TestCase):
    def test_pinned_docs_are_present_and_non_empty(self):
        # The negative pins below pass vacuously on empty text, so they rest on this guard.
        for path in PINNED:
            self.assertTrue(read_text(path).strip(), f"{path} is empty")

    def test_launcher_presents_the_mode_as_required(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "THE RUN REFUSES TO START UNTIL YOU DO",
                "There is no default `mode` any more",
                "stopped: 'mode-not-chosen'",
                # The reason, not just the rule: a driving agent that knows only the rule will look
                # for a way around it.
                "the one answer a user cannot un-choose",
            ],
        )
        self.assertFalse(missing, f"the launcher must present the mode as required; missing {missing}")

    def test_launcher_offers_every_mode_the_run_accepts(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = [mode for mode in MODES if f"`{mode}`" not in content]
        self.assertFalse(missing, f"a mode the run accepts but the launcher never offers is unreachable; missing {missing}")

    def test_launcher_names_the_non_interactive_escape(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "pass `defaultMode` instead of `mode`",
                "`modeSource`",
            ],
        )
        self.assertFalse(missing, f"the unattended path must be declared, not guessed; missing {missing}")

    def test_launcher_names_the_round_stop_and_how_to_continue(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "stopped: 'paused-at-round'",
                "correctness before fidelity",
                "run-status.md",
                '{ "kind": "run", "item": "round-<N>", "answer": "go" }',
                "stopped: 'awaiting-round-decision'",
                # Mode C's honesty requirement: a layout stop's open logic rows are on plan.
                "scheduled for the logic pass, not a shortfall",
            ],
        )
        self.assertFalse(missing, f"the round-boundary stop and its resume must be documented for the relayer; missing {missing}")

    def test_executor_contract_states_the_refusal_and_both_stop_mechanisms(self):
        content = read_text(EXECUTOR_SKILL)
        missing = missing_markers(
            content,
            [
                "THE MODE IS REQUIRED",
                "There is no default mode.",
                "stopped: 'mode-not-chosen'",
                "Two stop mechanisms, not five behaviours",
                "stopped: 'paused-at-round'",
                "stopped: 'paused-at-checkpoint'",
                # `layout-first` must not read as a licence to stop mid-unit.
                "never a mid-unit stop",
            ],
        )
        self.assertFalse(missing, f"the executor contract must carry the refusal and both mechanisms; missing {missing}")

    def test_executor_contract_names_the_run_scoped_answer_entries(self):
        content = read_text(EXECUTOR_SKILL)
        missing = missing_markers(
            content,
            [
                'under the reserved kind `run`',
                '`{ "kind": "run", "item": "control-mode", "answer": "<mode>" }`',
                "`--units.runResolutions`",
                "excluded from\n`resolutionsUnmatched`",
                "There is no second channel",
            ],
        )
        self.assertFalse(missing, f"the one-channel rule must be stated where the build contract lives; missing {missing}")

    def test_build_recipe_carries_the_two_pass_split(self):
        content = read_text(BUILD_RECIPE)
        missing = missing_markers(
            content,
            [
                "TWO PASSES over the same unit",
                "steps 1-5 and 7-11 and **not step 6**",
                "SCHEDULED for the next invocation, not dropped",
                # The gate WILL read short on a layout pass; without this the builder repairs rows
                # nobody asked it to build.
                "will report the unit short, and that is the\n> correct verdict",
                # And a single-pass unit must not read the block as applying to it.
                "if\n> it says nothing about a pass, this is an ordinary single-pass unit",
            ],
        )
        self.assertFalse(missing, f"a fresh-context builder reads only this file; missing {missing}")

    def test_documentation_reference_lists_the_new_artifacts(self):
        content = read_text(MIGRATION_DOCS)
        missing = missing_markers(
            content,
            [
                "run-status.md",
                "the RUN-level decisions, under the reserved kind `run`",
                '{ "kind": "run", "item": "control-mode", "answer": "round1" }',
                "`run-status.md` is ENGINE-WRITTEN",
            ],
        )
        self.assertFalse(missing, f"the folder contract must list what a stop writes; missing {missing}")

    def test_the_superseded_default_claim_is_gone(self):
        # The exact sentences that told a driving agent it could apply `auto` itself. Both were
        # true before this ticket and are now the opposite of the contract.
        for path in (MIGRATION_SKILL, EXECUTOR_SKILL):
            content = flat(read_text(path))
            self.assertNotIn("omit them only when the user chose `auto`", content, str(path))
            self.assertNotIn("do not assume `auto` because it is the default in the script", content, str(path))
            self.assertNotIn("Three modes, one mechanism", content, str(path))


if __name__ == "__main__":
    unittest.main()
