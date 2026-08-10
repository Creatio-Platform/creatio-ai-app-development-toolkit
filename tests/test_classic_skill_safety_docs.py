import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MIGRATION_SKILL = ROOT / "skills/classic-to-freedom-migration/SKILL.md"
CARD_CONTRACT = ROOT / "skills/classic-ui-expert/references/08-card-contract.md"
MEMBER_LEDGER = ROOT / "skills/classic-ui-expert/references/03-member-ledger.md"
REFERENCE_FOLLOWING = ROOT / "skills/classic-ui-expert/references/05-reference-following.md"
SURFACE_RESOLUTION = ROOT / "skills/classic-ui-expert/references/01-surface-resolution.md"
CLASSIC_SKILL = ROOT / "skills/classic-ui-expert/SKILL.md"
PLATFORM_PATTERNS = ROOT / "skills/classic-ui-expert/references/06-platform-patterns.md"

EVIDENCE_HEAD = "**A ported behaviour's Evidence lists every AC of its card, one line each.**"
GATE_HEAD = "**Gate-toggle safety (shared stand).**"
PLACEMENT_HEAD = "**Where the evidence goes.**"
CONDITION_HEAD = "- **Port every condition the card states"
CHILD_PAGE_HEAD = "**A child or related page in scope gets the SAME ledger discipline as the main page**"


def read_text(path):
    # Normalize curly apostrophes so a typographic pass over the Markdown cannot turn a
    # safety assertion red with a message about the wrong problem.
    return path.read_text(encoding="utf-8").replace("’", "'")


def flat(text):
    """Collapse whitespace runs so a pin survives a Markdown re-wrap.

    These docs hard-wrap at ~100 chars, so any multi-word phrase can straddle a newline
    the moment a sentence above it grows. Matching on flattened text pins the wording,
    not the line breaks.
    """
    return re.sub(r"\s+", " ", text)


def missing_markers(text, markers):
    """Return the markers ABSENT from text — empty list means all present."""
    flattened = flat(text)
    return [marker for marker in markers if flat(marker) not in flattened]


def paragraph(text, head):
    """The single paragraph starting with `head`.

    Scoping assertions to the paragraph rather than the whole file is what makes a
    *moved* sentence visible: whole-file assertIn stays green when a rule migrates into
    a neighbouring paragraph whose surrounding text changes its meaning. (The section
    slicing in tests/test_default_contract_docs.py:574-597 gives the same guarantee
    ad hoc, by index arithmetic; these helpers are new, not ported from there.)
    Requires the head to be unique — a duplicated head would silently pin whichever
    copy comes first, so it fails instead.
    """
    matches = [p for p in text.split("\n\n") if p.lstrip().startswith(head)]
    if len(matches) != 1:
        raise AssertionError(f"{len(matches)} paragraphs start with {head!r}; need exactly one")
    return matches[0]


def bullet(text, head):
    """The single list item starting with `head`.

    A bullet is one physical line inside a block with no blank lines, so paragraph()
    cannot scope it — line scoping gives the same guarantee: a marker that drifts into a
    neighbouring bullet turns the assertion red instead of staying green. Same uniqueness
    requirement as paragraph().
    """
    matches = [ln for ln in text.splitlines() if ln.lstrip().startswith(head)]
    if len(matches) != 1:
        raise AssertionError(f"{len(matches)} list items start with {head!r}; need exactly one")
    return matches[0]


class ClassicSkillSafetyDocTests(unittest.TestCase):
    """Pin the normative phrases of prose-only safety guarantees.

    Each guarantee below regressed at least once during ENG-94529 review — raw-value
    logging (bf31563), the toggle fail-safe (7944948), the card contract's closed set
    (65266ce), and the Evidence rule closing on the instruction it supersedes. Prose
    review caught each one late; these locks catch the next one at commit time.
    """

    def test_every_pinned_doc_is_present_and_non_empty(self):
        # The module's negative pins (assertNotIn / assertNotRegex) pass vacuously on
        # empty text, so their strength rests on this guard: a renamed or emptied doc
        # fails here loudly instead of turning the negative half of the suite
        # green-by-absence. (Path.read_text raises on a missing file; this closes the
        # emptied-file case too.) CLASSIC_SKILL and PLATFORM_PATTERNS carry edits from
        # the same branch without phrase pins of their own — the guard is all the
        # backstop they have, so they are listed too.
        for path in (
            MIGRATION_SKILL,
            CARD_CONTRACT,
            MEMBER_LEDGER,
            REFERENCE_FOLLOWING,
            SURFACE_RESOLUTION,
            CLASSIC_SKILL,
            PLATFORM_PATTERNS,
        ):
            self.assertTrue(read_text(path).strip(), f"{path} is missing or empty")

    # --- the rule this branch exists to add -------------------------------------

    def test_evidence_paragraph_requires_a_line_per_ac(self):
        para = paragraph(read_text(MIGRATION_SKILL), EVIDENCE_HEAD)
        missing = missing_markers(
            para,
            [
                "one line per acceptance criterion",
                "Test each AC, don't argue it",
                "must NOT happen",
                "`⚠ Partial`",
            ],
        )
        self.assertFalse(missing, f"per-AC evidence rule incomplete; missing {missing}")

    def test_evidence_placement_never_accepts_the_card_citation(self):
        # The regression this replaces: the paragraph used to close on "copy from there"
        # / "It goes in the Evidence column", whose referent is the card+AC *citation* —
        # the weaker rule the per-AC rule supersedes.
        content = read_text(MIGRATION_SKILL)
        para = paragraph(content, PLACEMENT_HEAD)
        missing = missing_markers(
            para,
            [
                "card + AC list to walk",
                "per-AC result lines",
                "never the **Described in** citation copied across",
            ],
        )
        self.assertFalse(missing, f"evidence-placement rule incomplete; missing {missing}")
        # Regex-tolerant: a lightly reworded reintroduction ("copy it from there",
        # "This goes in the Evidence column") must fail the same as the original.
        self.assertNotRegex(flat(content), r"copy(\s+\w+)? from there")
        self.assertNotRegex(flat(content), r"goes in the (\*\*)?Evidence(\*\*)? column")

    def test_condition_substitution_is_a_deviation_never_self_approved(self):
        # The round-4 defect this rule closes: one of three conjunctive gates was swapped
        # for a guard judged "strictly stronger", inverting the card's negative AC. Every
        # other rule tied to a measured failure is pinned here; this one was not.
        item = bullet(read_text(MIGRATION_SKILL), CONDITION_HEAD)
        missing = missing_markers(
            item,
            [
                "is a DEVIATION you propose, never one you approve for yourself",
                "conditions are conjunctive",
                "holds for **every** AC of the card, negative ones included",
                "never invent a workaround and self-certify it",
            ],
        )
        self.assertFalse(missing, f"condition substitution rule incomplete; missing {missing}")

    # --- surface resolution ---------------------------------------------------------

    def test_child_pages_get_the_same_ledger_discipline(self):
        # Measured failure: the main record page reached 49/51 methods attributed while one
        # child edit page left 4/6 in no unit — and those four were a single real behaviour.
        para = paragraph(read_text(SURFACE_RESOLUTION), CHILD_PAGE_HEAD)
        missing = missing_markers(
            para,
            [
                "every member attributed or a counted zero",
                "49 of 51",
                "4 of 6",
                "declared out of scope",
            ],
        )
        self.assertFalse(missing, f"child-page ledger discipline incomplete; missing {missing}")

    # --- gate-toggle safety, scoped to its own paragraph -------------------------

    def test_gate_toggle_names_the_row_it_touches(self):
        para = paragraph(read_text(MIGRATION_SKILL), GATE_HEAD)
        missing = missing_markers(
            para, ["SysSettingsValue", "culture/user/role", "per-role override"]
        )
        self.assertFalse(missing, f"gate-toggle must name the exact row; missing {missing}")

    def test_gate_toggle_default_denies_raw_value_logging(self):
        # The invariant is "never echo a non-Boolean value", not any particular noun for
        # the row type — pin the invariant so a terminology fix does not turn this red.
        para = paragraph(read_text(MIGRATION_SKILL), GATE_HEAD)
        missing = missing_markers(
            para, ["resolved effective state", "never the literal value"]
        )
        self.assertFalse(missing, f"gate-toggle must default-deny raw values; missing {missing}")

    def test_gate_toggle_only_ever_toggles_a_boolean_row(self):
        # A Text/String/Lookup row may hold a secret no metadata flags as encrypted, and
        # toggling overwrites it — the held copy can be lost to context compaction.
        para = paragraph(read_text(MIGRATION_SKILL), GATE_HEAD)
        missing = missing_markers(
            para, ["Only a Boolean row is toggled", "`⚠ Partial — unexercised`"]
        )
        self.assertFalse(missing, f"gate-toggle must be Boolean-only; missing {missing}")

    def test_feature_flag_gates_get_a_procedure_not_a_refusal(self):
        # Feature toggles outnumber system-setting gates on a customized stand (156 vs 106
        # schemas, ENG-94529 census), so refusing to exercise them costs more coverage than
        # the secret-exposure risk it avoids. Same four steps, different tools.
        para = paragraph(read_text(MIGRATION_SKILL), GATE_HEAD)
        missing = missing_markers(
            para,
            [
                "getIsFeatureEnabled",
                "refresh-feature-cache",
                "restore unconditionally",
                "never a blanket refusal",
            ],
        )
        self.assertFalse(missing, f"feature gates need a real procedure; missing {missing}")

    def test_an_untoggleable_gate_of_either_kind_has_a_disposition(self):
        para = paragraph(read_text(MIGRATION_SKILL), GATE_HEAD)
        missing = missing_markers(
            para, ["if you cannot toggle it at all", "`⚠ Partial — unexercised`"]
        )
        self.assertFalse(missing, f"untoggleable gates need a disposition; missing {missing}")

    def test_gate_toggle_restores_unconditionally_against_a_held_value(self):
        # Pin the CAPTURE and the comparison together. Pinning only "the pre-toggle value
        # you held" passes on prose that compares against a value it never told you to
        # keep — a dangling back-reference reads as complete and is not.
        para = paragraph(read_text(MIGRATION_SKILL), GATE_HEAD)
        missing = missing_markers(
            para,
            [
                "Hold that row's pre-toggle value in session",
                "pre-toggle value you held",
                "toggle → test → restore → re-read",
                "restore runs unconditionally",
                "fails, errors or times out",
                "try/finally",
            ],
        )
        self.assertFalse(missing, f"restore must be unconditional; missing {missing}")

    def test_gate_toggle_escalates_an_unconfirmed_restore(self):
        para = paragraph(read_text(MIGRATION_SKILL), GATE_HEAD)
        missing = missing_markers(
            para, ["Confirm the restore, don't assume it", "blocking risk"]
        )
        self.assertFalse(missing, f"unconfirmed restore must be blocking; missing {missing}")

    def test_gate_toggle_groups_acs_behind_one_window(self):
        para = paragraph(read_text(MIGRATION_SKILL), GATE_HEAD)
        self.assertIn("toggle window", flat(para))
        self.assertIn("toggle once, run them all, restore once", flat(para))

    def test_gate_toggle_announces_the_window_before_opening_it(self):
        # A flipped gate changes behaviour for every concurrent user of a shared stand
        # while the window is open — restore-on-exit does not cover the window itself,
        # so the toggle is announced, never silent.
        para = paragraph(read_text(MIGRATION_SKILL), GATE_HEAD)
        missing = missing_markers(
            para, ["Announce the window before opening it", "every concurrent user"]
        )
        self.assertFalse(missing, f"toggle window must be announced; missing {missing}")

    # --- card contract ------------------------------------------------------------

    def test_card_contract_keeps_the_closed_set_guarantee(self):
        # Both halves: the set is exact, and nothing outside the table may be added.
        content = read_text(CARD_CONTRACT)
        missing = missing_markers(
            content, ["exactly these fields, in this order", "Do not add fields"]
        )
        self.assertFalse(missing, f"card contract must stay a closed set; missing {missing}")

    def test_card_contract_pins_the_field_content_caps(self):
        # PR rule 8 (card trimming): cards were 76% of a 244 KB report before these
        # caps. "Two sentences at most" and "omit when empty" are the two checkable
        # phrases carrying the rule; unpinned they can drift back to the baseline
        # wording ("One short paragraph", plain "supporting") without a failure.
        # bullet() scopes to the single table row, same as for a list item.
        content = read_text(CARD_CONTRACT)
        what_row = bullet(content, "| **What it is** |")
        self.assertIn("Two sentences at most", what_row)
        notes_row = bullet(content, "| **Mechanism notes** |")
        missing = missing_markers(
            notes_row, ["supporting, **omit when empty**", "leave the field out"]
        )
        self.assertFalse(missing, f"mechanism-notes cap incomplete; missing {missing}")
        self.assertNotIn("One short paragraph", flat(content))

    def test_code_snippets_redact_secret_literals(self):
        # The Code field requires verbatim customer code, and verbatim code can embed
        # credentials — the same exposure the setting-value redaction (retrieval-floor
        # class 2) closes, on the other path into customizations.md.
        content = read_text(CARD_CONTRACT)
        missing = missing_markers(
            content,
            [
                "A secret literal is redacted, never copied",
                "redacted: connection string",
                "the one edit allowed inside a member",
            ],
        )
        self.assertFalse(missing, f"code snippets must redact secrets; missing {missing}")

    # --- member ledger -------------------------------------------------------------

    def test_member_ledger_tally_uses_three_distinct_counts(self):
        # N members · M attributed · K unattributed — reusing N for the attributed slot
        # reads as attributed == total while admitting K more are unattributed.
        content = read_text(MEMBER_LEDGER)
        self.assertRegex(content, r"N\s+members\s*·\s*M\s+attributed\s*·\s*K\s+unattributed")
        self.assertIn("M + K = N", flat(content))
        self.assertNotRegex(content, r"N\s+members\s*·\s*N\s+attributed")

    def test_member_ledger_worked_example_closes_with_a_conforming_tally(self):
        # The worked example is what an agent copies, so it regressed first — lock the
        # concrete footer alongside the abstract rule.
        content = read_text(MEMBER_LEDGER)
        self.assertRegex(content, r"6\s+members\s*·\s*6\s+attributed\s*·\s*0\s+unattributed")
        self.assertNotIn("all members attributed", flat(content))

    # --- retrieval floor -----------------------------------------------------------

    def test_message_counterpart_search_is_run_once_and_widened(self):
        # Two failures to hold apart. Deferring the search left 18 of 30 threads open
        # (ENG-94529), so it must actually run; re-running it per scope is unbounded on a
        # customer stand, so it runs ONCE and the caller owns it when there is one.
        content = read_text(REFERENCE_FOLLOWING)
        missing = missing_markers(
            content,
            [
                "run the search, do not defer it",
                "Once per run, never per scope",
                "the caller owns the register",
                "state the scope you reached",
                "declaring layer's package*",
            ],
        )
        self.assertFalse(missing, f"class 3 must run once and widen; missing {missing}")
        self.assertNotIn("scan the client-schema census for the other side", flat(content))

    def test_message_register_extends_when_scope_grows(self):
        # "Once per run" without a scope-growth clause reads as "closed once built" — a
        # child page entering scope mid-run would then declare messages the register
        # never carries, reproducing the 18-of-30 open-thread failure through the side
        # door the child-page ledger rule opens.
        content = read_text(REFERENCE_FOLLOWING)
        missing = missing_markers(
            content,
            [
                "Scope growth extends the register, never rebuilds it",
                "append the new page's threads",
                "never silently absent",
            ],
        )
        self.assertFalse(missing, f"register must extend on scope growth; missing {missing}")

    def test_message_counterpart_zero_carries_its_scope_of_proof(self):
        content = read_text(REFERENCE_FOLLOWING)
        missing = missing_markers(
            content,
            ["A counted zero carries the scope that proves it", "`unresolved`, never an omitted member"],
        )
        self.assertFalse(missing, f"counted zeros need a scope of proof; missing {missing}")

    def test_setting_values_are_reported_as_state_not_literals(self):
        # Cards ship in customizations.md, the one output doc carrying verbatim customer
        # code — so this skill needs its own redaction rule, not a cross-skill pointer.
        content = read_text(REFERENCE_FOLLOWING)
        missing = missing_markers(
            content,
            [
                "resolved state per audience",
                "not the literal value, unless the row is Boolean",
                "customizations.md",
            ],
        )
        self.assertFalse(missing, f"per-audience read must redact literals; missing {missing}")


if __name__ == "__main__":
    unittest.main()
