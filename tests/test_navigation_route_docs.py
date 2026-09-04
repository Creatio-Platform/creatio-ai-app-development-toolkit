"""ENG-96147 — nothing recorded a built section's navigation route, so whatever needed to open it
composed a `#Section/<guess>` URL and hoped.

On the ST_2 run an agent opened `#Section/UsrApplicants` — composed from the section's code, missing
the real page's `_ListPage` suffix — got `Script error`, and reported a working page as a real
defect. The recovery ran a database flush and a `compile-creatio` against a SHARED stand, for a page
that was never broken; the same wrong diagnosis then repeated as a "dependency-ordering block" across
the run's remaining rounds (defect D10, the most expensive single defect of that run).

The fix has a code half (`standWrites.sectionRoute`, recorded from a tool response never guessed —
locked by `run-infra.mjs` and `helpers.test.mjs`) and a prose half: the docs must say (1) the record
exists and where it lives, (2) a reader uses it and never composes a route, (3) a navigation failure
with no record is reported as an UNRESOLVED ROUTE, distinct from a page defect (AC3) and from a
dependency-ordering theory (AC5), and (4) a `Script error` from an unconfirmed route never authorises
a database flush or a compile (AC4). This module doc-pins that prose with one dedicated marker set per
acceptance criterion, mirroring `test_verification_surface_preflight_docs.py`'s structure, so no two
criteria can collapse into one vacuous assertion.

This proves the prose is present and non-vacuous. It does NOT prove an agent reads the recorded route
instead of guessing, correctly classifies a navigation failure, or refrains from a stand-wide recovery
action at runtime — no executable harness in this repo can prove that (the ENG-95855 doc-pin's own
docstring states the identical limitation for its structurally identical ticket). That gap is closed
only by a human-operator dry run through a real migration section.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

BUILD_SKILL = ROOT / "skills/freedom-build-executor/SKILL.md"
QUEUE_DOCS = ROOT / "skills/freedom-build-executor/references/02-queue-and-built-files.md"
FAILURE_POLICY = ROOT / "skills/freedom-build-executor/references/03-failure-and-park-policy.md"
BUILD_RECIPE = ROOT / "skills/freedom-build-executor/references/04-per-page-build-recipe.md"
MIGRATION_SKILL = ROOT / "skills/classic-to-freedom-migration/SKILL.md"
MIGRATION_DOCS = ROOT / "skills/classic-to-freedom-migration/references/migration-documentation.md"

ALL_DOCS = (BUILD_SKILL, QUEUE_DOCS, FAILURE_POLICY, BUILD_RECIPE, MIGRATION_SKILL, MIGRATION_DOCS)


def read_text(path):
    return path.read_text(encoding="utf-8").replace("’", "'")


def flat(text):
    """Collapse whitespace runs so a pin survives a Markdown re-wrap."""
    return re.sub(r"\s+", " ", text)


def missing_markers(text, markers):
    flattened = flat(text)
    return [marker for marker in markers if flat(marker) not in flattened]


class NavigationRouteDocTests(unittest.TestCase):
    def test_pinned_docs_are_present_and_non_empty(self):
        for path in ALL_DOCS:
            self.assertTrue(read_text(path).strip(), f"{path} is empty")

    # --- AC1 — the record and where it lives -----------------------------------------------

    def test_queue_docs_name_the_new_standwrites_member(self):
        content = flat(read_text(QUEUE_DOCS))
        missing = missing_markers(
            content,
            [
                '"sectionRoute": { "route": "#Section/UsrApplicants_ListPage"',
                "where the section this run built actually opens",
                "copied VERBATIM out of `create-app-section`'s",
                "never retyped, never reconstructed with a guessed `_ListPage` suffix",
            ],
        )
        self.assertFalse(missing, f"standWrites.sectionRoute must be documented; missing {missing}")

    def test_queue_docs_state_no_staleness_concern(self):
        # Alex's own correction (2026-09-02): a section's identity IS its list-page schema — there is
        # no Creatio operation that re-points a section at a different one while keeping the same URL.
        # Locked so a later edit cannot reintroduce a "re-bind staleness" mechanism this record does
        # not need.
        content = flat(read_text(QUEUE_DOCS))
        self.assertIn("It does not go stale.", content)
        self.assertIn("once observed, the record is good for the life of the section", content)

    def test_build_skill_contract_rule_names_three_facts_not_one(self):
        content = flat(read_text(BUILD_SKILL))
        self.assertNotIn("Today it carries one fact", content)
        missing = missing_markers(
            content,
            [
                "It carries three facts:",
                "standWrites.orphanedPages",
                "standWrites.sectionRoute = { route, schemaName, sectionHost, planVersion }",
            ],
        )
        self.assertFalse(missing, f"contract rule 7 must name all three standWrites facts; missing {missing}")

    # --- AC2 — a reader uses the record, never composes one --------------------------------

    def test_build_recipe_render_check_reads_the_record_not_a_guess(self):
        content = flat(read_text(BUILD_RECIPE))
        missing = missing_markers(
            content,
            [
                "use the recorded route, never a composed one (ENG-96147)",
                "Read `standWrites.sectionRoute.route` from `build-queue.json`",
                "Do NOT retype the section's",
                "code or schema name into a `#Section/<guess>` URL",
            ],
        )
        self.assertFalse(missing, f"the render check must read, never compose, the route; missing {missing}")

    def test_reach_unit_prompt_forbids_composing_the_prefix(self):
        content = flat(read_text(BUILD_SKILL))
        # The prompt text itself lives in core.mjs and is generated into freedom-build-executor.workflow.js;
        # this module only pins the doc-facing description of the contract, verified separately by
        # run-infra.mjs against the generated script text.
        missing = missing_markers(
            content,
            ["so nothing that needs to open it has to compose one"],
        )
        self.assertFalse(missing, f"the contract must say readers never compose a route; missing {missing}")

    def test_migration_skill_validate_step_navigates_by_the_recorded_route(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "navigating to it by the RECORDED route (`standWrites.sectionRoute`)",
                "never a URL composed from the schema/entity name",
            ],
        )
        self.assertFalse(missing, f"step 8 must navigate by the recorded route; missing {missing}")

    def test_migration_docs_dod_requires_the_recorded_fact(self):
        content = flat(read_text(MIGRATION_DOCS))
        missing = missing_markers(
            content,
            [
                "the Freedom section's navigation route is the RECORDED fact (`standWrites.sectionRoute`), "
                "not re-derived or guessed",
            ],
        )
        self.assertFalse(missing, f"the Definition of Done must require the recorded fact; missing {missing}")
        self.assertIn("section navigation route", flat(read_text(MIGRATION_DOCS)))

    # --- AC3 — an unresolved route is reported distinctly from a page defect ---------------

    def test_failure_policy_table_carries_the_unresolved_route_row(self):
        content = flat(read_text(FAILURE_POLICY))
        missing = missing_markers(
            content,
            [
                "opening the built section fails and no recorded route was used",
                "report `blocked[]` as an **UNRESOLVED ROUTE**",
                "never a page defect, never a dependency-ordering theory",
            ],
        )
        self.assertFalse(missing, f"the classification table must carry the unresolved-route row; missing {missing}")

    def test_failure_policy_has_its_own_unresolved_route_section(self):
        content = flat(read_text(FAILURE_POLICY))
        missing = missing_markers(
            content,
            [
                "An unresolved navigation route is not a page defect, and never authorises a "
                "stand-wide recovery",
                "check whether the route came from `standWrites.sectionRoute`",
                'reported as `blocked[]`, `what: "unresolved route"',
            ],
        )
        self.assertFalse(missing, f"the dedicated unresolved-route section is required; missing {missing}")

    def test_build_recipe_render_check_reports_unresolved_route_on_absence(self):
        content = flat(read_text(BUILD_RECIPE))
        missing = missing_markers(
            content,
            [
                "If no `standWrites.sectionRoute` record exists yet",
                "report it in `blocked[]` as an **unresolved route**",
            ],
        )
        self.assertFalse(missing, f"the render check must report absence as unresolved route; missing {missing}")

    def test_migration_skill_relay_step_carries_unresolved_route_entries(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "A `blocked[]` entry naming an unresolved navigation route (ENG-96147) relays the same way",
                "is never restated as a page defect",
            ],
        )
        self.assertFalse(missing, f"step 7 item 7 must relay unresolved-route entries; missing {missing}")

    def test_migration_skill_known_traps_entry_present(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "A guessed navigation URL mistaken for a page defect.",
                "`Script error` is ambiguous by construction",
                "Navigate by the RECORDED route (`standWrites.sectionRoute.route`) only",
            ],
        )
        self.assertFalse(missing, f"the Known Traps bullet must be present; missing {missing}")

    # --- AC4 — no stand-wide recovery action on an unconfirmed route -----------------------

    def test_build_recipe_compile_caveat_extended_to_flush(self):
        content = flat(read_text(BUILD_RECIPE))
        missing = missing_markers(
            content,
            [
                "A compile is not a way to make a page load.",
                "**Nor is a database flush.**",
                "Neither is authorised by a `Script error` alone when the route that produced it was "
                "not read out of `standWrites.sectionRoute`",
            ],
        )
        self.assertFalse(missing, f"the compile caveat must be extended to the database flush; missing {missing}")

    def test_failure_policy_names_the_recovery_prohibition(self):
        content = flat(read_text(FAILURE_POLICY))
        missing = missing_markers(
            content,
            [
                "grounds for a stand-wide recovery action",
                "A database flush or a `compile-creatio` is never authorised by",
                "a `Script error` alone",
            ],
        )
        self.assertFalse(missing, f"the recovery prohibition must be stated; missing {missing}")

    # --- AC5 — no dependency-ordering / build-gap theory attached ---------------------------

    def test_failure_policy_forbids_the_causal_theory_as_its_own_sentence(self):
        # Kept as its OWN marker, separate from the AC3 marker above: AC5 came from a later reviewer
        # extension of the ticket's Done criterion 3, and folding it into the AC3 assertion would let
        # either half go missing without failing a test.
        content = flat(read_text(FAILURE_POLICY))
        missing = missing_markers(
            content,
            [
                "reported as a dependency-ordering or build-gap theory",
                "attaching a causal story to it is exactly the second misdiagnosis the ST_2 run made, "
                "repeated across all six of its rounds",
            ],
        )
        self.assertFalse(missing, f"the no-causal-theory rule needs its own sentence; missing {missing}")


if __name__ == "__main__":
    unittest.main()
