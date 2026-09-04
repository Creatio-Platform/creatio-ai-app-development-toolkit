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
# The shipped bundle: the generated file the executor actually loads at run time, carrying its own
# copy of `buildModes()`. This is what `test_mode_list_matches_the_shipped_buildModes` reads to prove
# the pin below, rather than trusting the comment.
WORKFLOW_BUNDLE = ROOT / "skills/freedom-build-executor/freedom-build-executor.workflow.js"

PINNED = (MIGRATION_SKILL, EXECUTOR_SKILL, BUILD_RECIPE, MIGRATION_DOCS)

# The modes, as the operator types them. `buildModes()` in the workflow core is the source of truth;
# this list is the DOC side of the same contract. The agreement is ENFORCED, not just asserted in this
# comment: `test_mode_list_matches_the_shipped_buildModes` below reads `WORKFLOW_BUNDLE`, extracts the
# array literal out of the shipped `buildModes()`, and fails the suite if it and this tuple diverge —
# so a sixth mode added to the engine and never mentioned here is a red test, not a silent gap.
MODES = ("auto", "checkpoints", "guided", "round1", "layout-first")

# The subset an operator is actually SHOWN (DR-6). `MODES` above is what the run ACCEPTS; this is what
# the menu renders. The gap is deliberate and is the whole of DR-6: `auto` answers a different question
# ("nobody is watching this run", declared through `defaultMode`) and `checkpoints` is an inherited mode
# ENG-96204 does not specify, so neither is offered — while both stay legal when passed on purpose.
# PR review (thread on `tests/test_control_mode_docs.py:48`): this file pinned `MODES` against the
# shipped `buildModes()` but never pinned the OFFERED set against `offeredModes()`, so a regression that
# put `auto` back on the menu — re-opening exactly what DR-6 closed — was invisible from the doc side.
OFFERED_MODES = ("guided", "round1", "layout-first")


def read_text(path):
    return path.read_text(encoding="utf-8").replace("’", "'")


def flat(text):
    """Collapse whitespace runs so a pin survives a Markdown re-wrap.

    A Markdown re-wrap is free to move where a `> ` blockquote line starts — the prose is the same,
    only the wrap width changed, and a `> ` at the start of the new line is a wrap artifact, not
    content. Strip that prefix BEFORE collapsing whitespace, or a pin that happens to have been
    hand-copied with the original wrap point baked in (marker text containing `\n> `) would stop
    matching text that re-wrapped one word earlier — the exact failure this function exists to
    prevent. Markers themselves must stay plain single-line text with no embedded `> `; the stripping
    happens on both sides of the comparison in `missing_markers`, so nothing forces a marker to fake
    the blockquote syntax it is trying to survive.
    """
    text = re.sub(r"(?m)^\s*>\s?", " ", text)
    return re.sub(r"\s+", " ", text)


def missing_markers(text, markers):
    flattened = flat(text)
    return [marker for marker in markers if flat(marker) not in flattened]


class ControlModeDocTests(unittest.TestCase):
    def test_pinned_docs_are_present_and_non_empty(self):
        # The negative pins below pass vacuously on empty text, so they rest on this guard.
        for path in PINNED:
            self.assertTrue(read_text(path).strip(), f"{path} is empty")

    def test_mode_list_matches_the_shipped_buildModes(self):
        # `MODES` above is a hand-copy of the engine's `buildModes()`, kept as a plain tuple because every
        # other test in this file needs to iterate it. A hand-copy drifts silently unless something reads
        # the ACTUAL shipped source and compares — that is this test, not the comment next to `MODES`.
        bundle_text = read_text(WORKFLOW_BUNDLE)
        # Tolerant of however the array literal happens to be wrapped (one line, one entry per line, extra
        # trailing comma) — the shipped bundle is generated output and its exact formatting is not the
        # contract. What IS the contract is that `buildModes` returns exactly this array of string literals.
        match = re.search(
            r"function\s+buildModes\s*\(\s*\)\s*\{\s*return\s*\[(?P<items>[^\]]*)\]\s*\}",
            bundle_text,
        )
        self.assertIsNotNone(
            match,
            "could not find `function buildModes() { return [...] }` in the shipped bundle "
            f"({WORKFLOW_BUNDLE}) — the extraction regex and the generated source have drifted, "
            "and this must fail loudly rather than let the pin below pass vacuously",
        )
        item_pattern = re.compile(r"""['"]([^'"]+)['"]""")
        shipped_modes = tuple(item_pattern.findall(match.group("items")))
        self.assertTrue(
            shipped_modes,
            f"`buildModes()` matched but no string literals were extracted from it: {match.group('items')!r}",
        )
        self.assertEqual(
            set(shipped_modes),
            set(MODES),
            "the DOC-side MODES tuple and the engine's own buildModes() have diverged — a mode added to "
            "one and not the other is unreachable from one side of the contract",
        )
        # Every mode the engine ships has to be reachable from the one place a human can read about it.
        launcher_text = flat(read_text(MIGRATION_SKILL))
        missing = [mode for mode in shipped_modes if f"`{mode}`" not in launcher_text]
        self.assertFalse(
            missing,
            f"buildModes() ships a mode the launcher skill never offers as `mode`; missing {missing}",
        )

    def test_offered_mode_list_matches_the_shipped_offeredModes(self):
        """`offeredModes()` is what the menu renders, so pin it the way `buildModes()` is pinned.

        Same technique as the test above -- read the shipped bundle, extract the array literal, and
        fail loudly if the regex and the generated source have drifted rather than letting the
        assertion pass on nothing. Three things are checked, because they fail in different ways: the
        shipped offered set equals this file's, the offered set is a strict subset of the accepted
        set, and the difference is exactly ``auto`` and ``checkpoints`` -- so a mode added to one list
        and forgotten in the other is red either way round.
        """
        bundle_text = read_text(WORKFLOW_BUNDLE)
        match = re.search(
            r"function\s+offeredModes\s*\(\s*\)\s*\{\s*return\s*\[(?P<items>[^\]]*)\]\s*\}",
            bundle_text,
        )
        self.assertIsNotNone(
            match,
            "could not find `function offeredModes() { return [...] }` in the shipped bundle "
            f"({WORKFLOW_BUNDLE}) -- the extraction regex and the generated source have drifted, "
            "and this must fail loudly rather than let the pins below pass vacuously",
        )
        item_pattern = re.compile(r"""['\"]([^'\"]+)['\"]""")
        shipped_offered = tuple(item_pattern.findall(match.group("items")))
        self.assertTrue(
            shipped_offered,
            f"`offeredModes()` matched but no string literals were extracted: {match.group('items')!r}",
        )
        self.assertEqual(
            set(shipped_offered),
            set(OFFERED_MODES),
            "the DOC-side OFFERED_MODES and the engine's own offeredModes() have diverged -- either a "
            "mode is on the operator's menu that this file does not document, or one is documented as "
            "offered and is not",
        )
        self.assertLess(
            set(OFFERED_MODES),
            set(MODES),
            "the offered set must be a STRICT subset of the accepted set: an offered mode the run "
            "would refuse is a menu entry that cannot be chosen",
        )
        self.assertEqual(
            set(MODES) - set(OFFERED_MODES),
            {"auto", "checkpoints"},
            "DR-6 fixes the difference at exactly `auto` (the unattended path, declared through "
            "`defaultMode`) and `checkpoints` (inherited, not specified by ENG-96204). A change to "
            "that difference is a change to DR-6 and must be made deliberately, not by drift",
        )

    def test_launcher_offers_exactly_the_offered_modes_and_no_others(self):
        """Mentioning a mode is not offering it.

        ``test_launcher_offers_every_mode_the_run_accepts`` checks all five modes are *mentioned* in
        the launcher, which a launcher that put `auto` on the menu would also satisfy -- the earlier
        pins on that are prose markers. This one counts the option rows: exactly the offered modes get
        one, and neither unoffered mode does.
        """
        content = flat(read_text(MIGRATION_SKILL))
        for label, token in (("Guided", "guided"), ("Round by round", "round1"),
                             ("Layout first", "layout-first")):
            self.assertIn(
                f"| **{label}** | `{token}` |", content,
                f"`{token}` is in offeredModes() but the launcher's option table has no row for it",
            )
        for token in set(MODES) - set(OFFERED_MODES):
            self.assertNotIn(
                f"| `{token}` |", content,
                f"`{token}` is NOT offered (DR-6) but appears as a row in the launcher's option "
                f"table -- that table is the menu, so a row there is an offer",
            )

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

    def test_launcher_offers_the_label_and_keeps_the_token_to_itself(self):
        """The user picks by NAME; the agent passes the TOKEN.

        A bare `round1` in front of a reader looks like a version number, so the launcher shows a
        label. But a label is never parsed back into a mode -- ``buildMode`` accepts only the tokens
        -- so the doc has to carry BOTH, next to each other, or an agent reading it will eventually
        pass "Round by round" as ``mode`` and the run will throw. Pinned as the pairing rather than
        as two independent greps for that reason.
        """
        content = flat(read_text(MIGRATION_SKILL))
        for token, label in (("guided", "Guided"), ("round1", "Round by round"),
                             ("layout-first", "Layout first")):
            self.assertIn(
                f"| **{label}** | `{token}` |", content,
                f"the launcher must map the label {label!r} to `{token}` in the table the agent reads",
            )
            self.assertIn(
                f"- **{label}** — ", content,
                f"the option offered to the user must be the bare label {label!r}",
            )
            self.assertNotIn(
                f"**{label}** (`{token}`)", content,
                f"the token must NOT ride along in brackets beside {label!r}: the user picks from a "
                f"list and never types a mode, so the token is an implementation detail there",
            )
        self.assertIn(
            "Offer the LABEL ALONE", content,
            "the launcher must say the token is not shown, or an agent will paste it into the question",
        )

    def test_launcher_describes_steps_without_showing_unit_keys(self):
        """The user hears page names; the agent keeps the keys.

        `mini:Applicant` is an internal identifier. Putting it in the question that asks how closely
        someone wants to watch a build is noise, and the agent does not need the user to repeat it --
        it holds the mapping and translates "the record page came back wrong" into the right
        ``findings`` entry itself. Pinned because the instruction it replaced said the opposite
        ("SHOW EACH STEP'S KEY"), so a future edit could reinstate it without anything objecting.
        """
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "NAME THE STEPS, NOT THEIR KEYS",
                "Do NOT put unit keys in front of the user",
                "You hold the mapping, they do not",
            ],
        )
        self.assertFalse(
            missing,
            f"the launcher must describe steps in plain language and keep unit keys internal; missing {missing}",
        )
        self.assertNotIn(
            "SHOW EACH STEP'S KEY", content,
            "the superseded instruction to show unit keys must be gone, not merely contradicted later",
        )

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
                # ENG-96204 rework: the stop reports COUNTS and points at the artifacts that hold the
                # rows. A relayer told to relay "the open rows" would relay an empty list, because the
                # rows do not cross the capped Reconcile boundary the build's numbers travel on.
                "`openCounts`",
                "the open set as COUNTS",
                "The open ROWS are on disk, not in the stop",
                "`verify.json`",
                # The severity axis survives — as the engine's per-row stamp, read where it is stamped.
                "correctness before fidelity",
                "run-status.md",
                '{ "kind": "run", "item": "round-<N>", "answer": "go" }',
                "stopped: 'awaiting-round-decision'",
                # Mode C's honesty requirement: a layout stop's open logic rows are on plan.
                "scheduled for the logic pass, not a shortfall",
            ],
        )
        self.assertFalse(missing, f"the round-boundary stop and its resume must be documented for the relayer; missing {missing}")

    def test_executor_contract_reports_counts_and_points_at_the_verify_artifacts(self):
        """ENG-96204 rework — the stop reports counts plus a pointer, following ENG-95930.

        The first cut of this ticket carried every open row in the stop's return and inlined them
        into ``run-status.md``. That contract cannot be honoured on this boundary: the central verify
        Reconcile is counts-only and its answer is capped, so a large open set never arrives at all.
        The contract the build runs under has to say where the rows actually are, or a driving agent
        relays "nothing is open" off a stop that stopped precisely because something was.
        """
        content = read_text(EXECUTOR_SKILL)
        missing = missing_markers(
            content,
            [
                "`openCounts`",
                "the open set as **counts, not rows**",
                "The open ROWS are not in the return and not in `run-status.md`",
                # Where they are, and which end of the axis to repair first.
                "`verify.json` is the same rows",
                "`rowSeverity`",
                "read the correctness rows first",
                # And WHY, so nobody re-adds the rows: the ceiling is the reason, not a preference.
                "capped at 16000 wire bytes",
                # ENG-96204 Part C: the severity tally is real for pages — the engine publishes the two
                # per-page counts and the stop tallies them. A doc still calling `unstamped` the normal
                # reading would send an operator to `verify.json` for a band the status already states.
                "publishes `openCorrectness` / `openFidelity` per page",
                "`unstamped` is left only for a page whose summary predates the two fields",
            ],
        )
        self.assertFalse(missing, f"the counts-plus-pointer contract must be stated where the build runs; missing {missing}")

    def test_executor_contract_no_longer_calls_unstamped_the_normal_reading(self):
        # ENG-96204 Part C — the sentence the severity-count publication superseded. Pinned as ABSENT so the
        # claim cannot come back in a re-wrap: `fidelity` is no longer structurally zero for pages.
        content = flat(read_text(EXECUTOR_SKILL))
        self.assertNotIn("`unstamped` in the tally is therefore the normal reading for page rows", content)

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
                "excluded from `resolutionsUnmatched`",
                "There is no second channel",
            ],
        )
        self.assertFalse(missing, f"the one-channel rule must be stated where the build contract lives; missing {missing}")

    def test_executor_contract_states_that_answers_accumulate_and_consumption_is_the_runs_record(self):
        """ENG-96204 / ENG-96474 — one answer, one round, and the record of it is in the QUEUE file.

        A driving agent that reads the contract has to learn three things or it will do the wrong
        one: the operator's file is append-only input (so it must not edit or remove an entry to
        mark it used), the run records consumption in its own file (so a refusal is not a bug to
        work around by re-recording the same entry), and the refusal has its own verdict.
        """
        content = read_text(EXECUTOR_SKILL)
        missing = missing_markers(
            content,
            [
                "One answer authorises exactly one round",
                "Answers ACCUMULATE in `resolutions.json`",
                "append-only input",
                "Consumption is recorded in the queue file",
                "`consumedRoundAnswers`",
                "`roundAnswerVerdict: 'consumed'`",
                "lists the spent answers against the one currently awaited",
                "DR-5",
            ],
        )
        self.assertFalse(missing, f"the consumption record and its ownership must be stated where the build contract lives; missing {missing}")

    def test_documentation_reference_states_the_answer_file_is_append_only_and_where_consumption_lives(self):
        content = read_text(MIGRATION_DOCS)
        missing = missing_markers(
            content,
            [
                "Round answers accumulate, and `resolutions.json` is append-only input the run never writes into",
                "Consumption is recorded in the queue file",
                "`consumedRoundAnswers`",
                "the round answers already SPENT against the one currently AWAITED",
            ],
        )
        self.assertFalse(missing, f"the folder contract must say where consumption is recorded; missing {missing}")

    def test_no_doc_tells_the_run_to_write_into_the_answer_file(self):
        # The rejected alternative (DR-5): stamping the operator's file. If a doc ever says the run
        # marks an entry as used there, a driving agent will start doing it by hand.
        for path in PINNED:
            content = flat(read_text(path))
            self.assertNotIn("consumedAt", content, str(path))
            self.assertNotIn("removes the entry from `resolutions.json`", content, str(path))

    def test_executor_contract_publishes_the_round_answer_vocabulary(self):
        """PR review F1 — the round gate is fail-closed, so the words it accepts must be readable.

        The gate stopped treating any non-blank answer as consent: a recorded ``no`` used to
        authorise the very round it was declining, and the round it authorises writes to a live
        stand. A fail-closed gate whose accepted vocabulary lives only in ``helpers.mjs`` is a
        guessing game for the driving agent that has to record a human's answer — so the words,
        all three verdicts, and the "record it verbatim" instruction are pinned in the contract
        the build runs under, where that agent reads.
        """
        content = read_text(EXECUTOR_SKILL)
        missing = missing_markers(
            content,
            [
                "The answer is a CHECKED VALUE, not a presence test",
                # The affirmative and the negative sides both have to be listed: an agent that
                # knows only "go works" cannot tell a decline from an unreadable answer.
                "`go`, `yes`, `y`, `ok`, `okay`, `continue`, `proceed`",
                "`no`, `n`, `stop`, `halt`, `hold`, `hold off`, `not yet`",
                # And the default has to be stated, or "unrecognised" reads as "probably fine".
                "An answer the gate cannot read is NOT authorisation",
                "roundAnswerVerdict: 'refused'",
                # The instruction to the RELAYER, which is where the original defect entered:
                # the natural way to record a decline is to record the decline.
                "record it verbatim",
            ],
        )
        self.assertFalse(missing, f"the fail-closed round vocabulary must be published where a driving agent reads it; missing {missing}")

    def test_executor_contract_states_what_a_round_boundary_costs(self):
        """PR review F13 — the cost note belongs next to the decision that buys it.

        A round-boundary mode pays the fixed read-only startup once per ROUND rather than once
        per migration, and ``layout-first`` dispatches every page unit twice. The cores already
        carry that arithmetic; the operator choosing the mode did not see it anywhere.
        """
        content = read_text(EXECUTOR_SKILL)
        missing = missing_markers(
            content,
            [
                "once per invocation, and therefore once per round",
                "dispatches every page unit **twice**",
            ],
        )
        self.assertFalse(missing, f"the cost of a round boundary must be stated where the mode is chosen; missing {missing}")

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
                "will report the unit short, and that is the correct verdict",
                # And a single-pass unit must not read the block as applying to it.
                "if it says nothing about a pass, this is an ordinary single-pass unit",
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

    def test_the_superseded_ranked_open_rows_claim_is_gone(self):
        # ENG-96204's own first cut. `openRanked` was removed from the return and the ranked row list
        # from `run-status.md`; a doc that still promises either sends a relayer looking for a field
        # that does not exist, or tells an operator the rows are in a file that does not carry them.
        for path in PINNED:
            content = flat(read_text(path))
            self.assertNotIn("openRanked", content, str(path))
            self.assertNotIn("the open rows ranked correctness-first", content, str(path))


if __name__ == "__main__":
    unittest.main()
