"""Contract tests for the navigation placement and audience requirement (ENG-88474).

A Creatio section that exists is not a section a user can reach. `create-app` places the new
section in the `My applications` workplace, which is granted to `System administrators` only, and a
home page becomes reachable only once a workplace's `HomePageUId` points at it. Before this
requirement existed, the toolkit had no notion of a workplace or a home page at all: discovery never
asked where the app belonged, the implementation runbook had no navigation step, and its completion
criteria were satisfied by `list-app-sections` — which proves a section exists and says nothing about
which workplace it is in. The result was an app that looked complete and only administrators could
open.

These tests pin the four surfaces that together make the decision unavoidable: the discovery
checklist that must secure it, the plan section that must carry it, the implementation runbook that
must apply and verify it, and the orchestrator rule that makes it mandatory rather than advisory.
They deliberately assert the load-bearing wording, not whole paragraphs, so the guidance can be
reworded without breaking the build while still failing if a requirement is dropped.
"""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

AGENTS = ROOT / "AGENTS.md"
CHECKLIST = ROOT / "context/business-checklist.md"
ESSENTIALS = ROOT / "context/essentials.md"
REQUIREMENTS_RUNBOOK = ROOT / "runbooks/02-requirements-gathering.md"
IMPLEMENTATION_RUNBOOK = ROOT / "runbooks/03-app-implementation.md"
ORCHESTRATOR_SKILL = ROOT / "skills/creatio-app-orchestrator/SKILL.md"

# The three tables a workplace spans. The toolkit must name them so an agent knows the model exists,
# while clio stays the owner of the recipes.
WORKPLACE_TABLES = [
    "SysWorkplace",
    "SysModuleInWorkplace",
    "SysAdminUnitInWorkplace",
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class FirstTurnDiscoveryContractTests(unittest.TestCase):
    """The first discovery batch is composed BEFORE any reference file is read.

    `AGENTS.md` forbids reading large repository files until the first clarification turn is done, so
    a requirement that lives only in `context/business-checklist.md` cannot reach the opening question
    set. A live behavioural run confirmed it: asked to build a Todo app, the agent opened with metric
    scope, description, list editing, and platform — and never asked where the app belonged, because
    the business-discovery priority list did not mention it. These tests pin the requirement onto the
    only surfaces that are in context during that first turn.
    """

    def test_discovery_priorities_include_navigation_placement(self):
        content = read_text(AGENTS)
        self.assertIn("navigation placement and its audience", content)

    def test_placement_is_declared_critical_not_a_minor_implementation_question(self):
        # "ask only the minimum critical questions" is the pressure that drops it; the rule has to
        # win that argument explicitly.
        content = read_text(AGENTS)
        self.assertIn('never a "minor implementation question"', content)

    def test_placement_is_required_in_the_first_batch(self):
        content = read_text(AGENTS)
        self.assertIn("Keep it in the FIRST batch", content)

    def test_agents_states_why_the_checklist_cannot_carry_it(self):
        # Guards against a future edit that "tidies up" by moving this back into the checklist.
        content = read_text(AGENTS)
        self.assertIn("not read until after that batch", content)

    def test_orchestrator_requires_placement_in_the_first_batch(self):
        content = read_text(ORCHESTRATOR_SKILL)
        self.assertIn("in the FIRST discovery batch", content)


class NavigationPlacementContractTests(unittest.TestCase):
    def test_essentials_documents_the_workplace_model_and_home_page(self):
        content = read_text(ESSENTIALS)
        for table in WORKPLACE_TABLES:
            self.assertIn(table, content, f"{table} must be named in the navigation model")
        self.assertIn("HomePageUId", content)
        self.assertIn("get-guidance name=workplaces", content)

    def test_essentials_states_the_default_workplace_is_administrators_only(self):
        # This is the fact that turns "we forgot to place it" into a user-visible defect.
        content = read_text(ESSENTIALS)
        self.assertIn("My applications", content)
        self.assertIn("System administrators", content)

    def test_checklist_requires_placement_and_audience(self):
        content = read_text(CHECKLIST)
        self.assertIn("navigation placement and audience", content)
        self.assertIn("who should see that workplace", content)

    def test_checklist_placement_is_not_closed_by_the_no_restrictions_default(self):
        # "No specific access restrictions are required by default." answers record-level access only.
        # If it also closed placement, the requirement would be dead on arrival for most apps.
        content = read_text(CHECKLIST)
        self.assertIn("NOT covered by the sentence above", content)
        self.assertIn("separate questions from record-level access", content)

    def test_checklist_pre_analysis_rejects_a_missing_placement(self):
        content = read_text(CHECKLIST)
        self.assertIn("workplace placement or workplace audience that no answer or assumption covers", content)

    def test_checklist_pre_analysis_rejects_duplicated_state_carriers(self):
        # A request that specifies a boolean AND a multi-value status for the same concept must be
        # resolved to one carrier; creating both leaves every metric and filter on a different source.
        content = read_text(CHECKLIST)
        self.assertIn("SAME concept specified twice", content)
        self.assertIn("never satisfy both", content)

    def test_plan_roles_section_must_carry_the_placement(self):
        content = read_text(REQUIREMENTS_RUNBOOK)
        self.assertIn("navigation placement and its audience", content)

    def test_implementation_runbook_has_a_navigation_step(self):
        content = read_text(IMPLEMENTATION_RUNBOOK)
        self.assertIn("Place the app in the navigation", content)
        self.assertIn("get-guidance name=workplaces", content)

    def test_implementation_runbook_routes_home_page_binding_to_clio(self):
        content = read_text(IMPLEMENTATION_RUNBOOK)
        self.assertIn("get-guidance name=home-page", content)

    def test_implementation_runbook_treats_a_missing_placement_as_a_gate_defect(self):
        # The implementer must not quietly decide placement that Gate R failed to capture.
        content = read_text(IMPLEMENTATION_RUNBOOK)
        self.assertIn("Gate R defect", content)

    def test_implementation_completion_criteria_verify_the_workplace_not_just_the_section(self):
        content = read_text(IMPLEMENTATION_RUNBOOK)
        self.assertIn("says nothing about which workplace it is in", content)
        self.assertIn("survives a", content)

    def test_implementation_runbook_requires_telling_the_developer_about_re_login(self):
        content = read_text(IMPLEMENTATION_RUNBOOK)
        self.assertIn("re-login", content)

    def test_orchestrator_makes_placement_mandatory_in_the_established_phrasing(self):
        # The toolkit signals non-negotiable rules with this exact construction; a softer reference
        # would read as advisory next to the UI-guidelines and schema-naming rules beside it.
        content = read_text(ORCHESTRATOR_SKILL)
        self.assertIn("Navigation placement and audience are mandatory, not optional.", content)
        self.assertIn("get-guidance name=workplaces", content)

    def test_orchestrator_forbids_choosing_the_placement_silently(self):
        content = read_text(ORCHESTRATOR_SKILL)
        self.assertIn("do not silently choose the placement yourself", content)


if __name__ == "__main__":
    unittest.main()
