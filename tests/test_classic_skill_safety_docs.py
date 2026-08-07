import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MIGRATION_SKILL = ROOT / "skills/classic-to-freedom-migration/SKILL.md"
CARD_CONTRACT = ROOT / "skills/classic-ui-expert/references/08-card-contract.md"
MEMBER_LEDGER = ROOT / "skills/classic-ui-expert/references/03-member-ledger.md"


def read_text(path):
    return path.read_text(encoding="utf-8")


def contains_all(text, markers):
    return [marker for marker in markers if marker not in text]


class ClassicSkillSafetyDocTests(unittest.TestCase):
    """Pin the normative phrases of prose-only safety guarantees.

    Each guarantee below regressed once already during ENG-94529 review (the raw-value
    logging in bf31563, the toggle fail-safe in 7944948, the card contract's closed set
    in 65266ce), so the wording is locked here rather than left to prose review.
    """

    def test_gate_toggle_procedure_names_the_row_it_touches(self):
        content = read_text(MIGRATION_SKILL)
        self.assertIn("Gate-toggle safety (shared stand)", content)
        missing = contains_all(
            content,
            ["SysSettingsValue", "culture/user/role", "per-role override"],
        )
        self.assertFalse(
            missing,
            f"gate-toggle procedure must name the exact row it touches; missing {missing}",
        )

    def test_gate_toggle_procedure_default_denies_raw_value_logging(self):
        # A Text/String/Lookup gate may hold a secret no metadata flags as encrypted,
        # so the worklog records the resolved state, not the literal value.
        content = read_text(MIGRATION_SKILL)
        missing = contains_all(
            content,
            [
                "resolved effective state",
                "never the literal value by default",
                "Boolean feature gate",
                "Text/String/Lookup",
            ],
        )
        self.assertFalse(
            missing,
            f"gate-toggle procedure must default-deny raw value logging; missing {missing}",
        )

    def test_gate_toggle_procedure_restores_unconditionally(self):
        # A failed or interrupted test does not leave the shared stand mutated.
        content = read_text(MIGRATION_SKILL)
        missing = contains_all(
            content,
            [
                "restore runs unconditionally",
                "fails, errors or times out",
                "try/finally",
            ],
        )
        self.assertFalse(
            missing,
            f"gate-toggle procedure must restore on any test outcome; missing {missing}",
        )

    def test_gate_toggle_procedure_escalates_an_unconfirmed_restore(self):
        content = read_text(MIGRATION_SKILL)
        missing = contains_all(
            content,
            ["Confirm the restore, don't assume it", "blocking risk"],
        )
        self.assertFalse(
            missing,
            f"an unconfirmed restore must be surfaced as blocking; missing {missing}",
        )

    def test_card_contract_keeps_the_closed_set_guarantee(self):
        # Both halves: the set is exact, and nothing outside the table may be added.
        content = read_text(CARD_CONTRACT)
        missing = contains_all(
            content,
            ["exactly these fields, in this order", "Do not add fields"],
        )
        self.assertFalse(
            missing,
            f"card contract must stay a closed set; missing {missing}",
        )

    def test_member_ledger_tally_uses_three_distinct_counts(self):
        # N members · M attributed · K unattributed — reusing N for the attributed slot
        # reads as attributed == total while admitting K more are unattributed.
        content = read_text(MEMBER_LEDGER)
        self.assertIn("N members · M attributed · K unattributed", content)
        self.assertIn("M + K = N", content)
        self.assertNotIn("N members · N attributed", content)


if __name__ == "__main__":
    unittest.main()
