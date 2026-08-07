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

    def test_first_turn_scope_covers_a_new_section_not_only_a_new_app(self):
        # The entrypoint trigger explicitly covers "add an Orders section", so scoping the first-batch
        # requirement to a NEW app would let exactly the late/missed question this rule exists to prevent
        # back in through the section path.
        content = read_text(AGENTS)
        self.assertNotIn("for a NEW app, navigation placement", content)
        self.assertNotIn("for a NEW app — navigation placement", content)
        self.assertIn("for a NEW app or a new section", content)

    def test_option_order_depends_on_whether_the_app_already_exists(self):
        # Broadening the rule to sections without reordering the options produced a real defect: a
        # measured add-section run recommended creating a second workplace named after an app that
        # already had one, which is the SysWorkplace.Name collision the clio guide warns about.
        # The first batch can only carry the half that needs no read; the runbook owns the other half.
        agents = read_text(AGENTS)
        self.assertIn("recommending the new named workplace when the request is to scaffold a NEW app",
                      agents)
        runbook = read_text(REQUIREMENTS_RUNBOOK)
        self.assertIn("recommend the workplace its sections already live in", runbook)
        self.assertIn("is not unique", runbook)

    def test_first_batch_does_not_require_an_environment_read(self):
        # The placement question belongs in the first batch, but resolving where an existing app's
        # sections already live needs a live SysModuleInWorkplace read — and the first-turn latency
        # rule in this same file forbids blocking that turn on environment inspection. Asking for the
        # read here would have made AGENTS.md contradict itself.
        content = read_text(AGENTS)
        self.assertIn("Ask it from the PROMPT ALONE", content)
        self.assertNotIn("READ where that app's sections already live", content)
        self.assertIn("runbooks/02-requirements-gathering.md", content)

    def test_existing_app_read_back_never_recommends_my_applications(self):
        # Every app this toolkit built before the placement question existed sits in My applications.
        # "Recommend the workplace the app's sections already live in" would therefore hand the
        # admin-only default back to the developer for that whole population — reinstating the defect
        # the rule exists to prevent, and doing it silently because the read-back looks authoritative.
        for path in (CHECKLIST, REQUIREMENTS_RUNBOOK):
            content = read_text(path)
            self.assertIn("My applications", content)
            self.assertIn("must not be recommended", content)
            self.assertIn("administrators-only", content)

    def test_multi_workplace_read_back_has_a_stated_tie_break(self):
        # context/essentials.md documents SysModuleInWorkplace as one row per placement, so an app's
        # sections can legitimately span several workplaces. Without a stated order the agent picks
        # arbitrarily from a set the developer never saw.
        for path in (CHECKLIST, REQUIREMENTS_RUNBOOK):
            content = read_text(path)
            self.assertIn("most of them", content)
            # NOT "tie": that substring already occurs inside `responsibilities`, `entities`,
            # `ambiguities` and `capabilities` in both files, so it passes even when the rule is
            # deleted. Pin the clause instead.
            self.assertIn("ask rather than choose when it is a tie", content)

    def test_first_turn_reason_names_the_section_path_too(self):
        content = read_text(AGENTS)
        self.assertIn("create-app-section", content)
        self.assertIn("the entrypoint trigger covers both", content)

    def test_agents_states_why_the_checklist_cannot_carry_it(self):
        # Guards against a future edit that "tidies up" by moving this back into the checklist.
        content = read_text(AGENTS)
        self.assertIn("not read until after that batch", content)

    def test_orchestrator_requires_placement_in_the_first_batch(self):
        content = read_text(ORCHESTRATOR_SKILL)
        self.assertIn("in the FIRST discovery batch", content)


class OrchestratorTriggerContractTests(unittest.TestCase):
    """The entrypoint skill must be selectable from a plain user request.

    Its description previously named only the toolkit's own artifacts — "Business Plans", "technical
    implementation handoffs", "the approved plan". A live run on "Create Verrify1 app. It should
    have..." never selected the skill (transcript: zero Skill invocations, no toolkit file read) and
    fell straight through to clio MCP, so every gate in this toolkit was inert. Every sibling skill is
    phrased through user intent or carries "Apply proactively"; the one that must fire first was the
    only one that could not match a natural request.
    """

    ORCHESTRATOR_SKILL_MD = ROOT / "skills/creatio-app-orchestrator/SKILL.md"
    ORCHESTRATOR_RULE_MDC = ROOT / "rules/creatio-app-orchestrator.mdc"

    @staticmethod
    def _description(path: Path) -> str:
        for line in read_text(path).splitlines():
            if line.startswith("description:"):
                return line[len("description:"):].strip()
        raise AssertionError(f"{path} has no description: line")

    def test_description_names_the_user_intent_not_only_toolkit_artifacts(self):
        for path in (self.ORCHESTRATOR_SKILL_MD, self.ORCHESTRATOR_RULE_MDC):
            desc = self._description(path).lower()
            self.assertIn("create", desc, str(path))
            self.assertIn("creatio app", desc, str(path))
            self.assertIn("apply proactively", desc, str(path))

    def test_openai_manifest_carries_the_user_intent_trigger(self):
        # test_release_structure pins this manifest's SHAPE (keys present, not nested under
        # `interface:`) and never its wording, so the trigger fix reached SKILL.md and the .mdc while
        # OpenAI-format hosts kept selecting on artifact names alone — the exact non-selection this
        # whole fix exists to remove.
        manifest = read_text(ROOT / "skills/creatio-app-orchestrator/agents/openai.yaml").lower()
        for verb in ("create", "add", "scaffold"):
            self.assertIn(verb, manifest, f"openai.yaml must match a plain '{verb}' request")
        self.assertIn("section", manifest,
                      "openai.yaml must match a new-section request, not only a new-app one")

    def test_skill_and_cursor_rule_descriptions_stay_in_sync(self):
        # Both are public trigger surfaces (test_release_structure pins them together); a fix applied
        # to one and not the other silently leaves Cursor on the old, unmatchable trigger.
        skill = self._description(self.ORCHESTRATOR_SKILL_MD)
        rule = self._description(self.ORCHESTRATOR_RULE_MDC)
        normalize = lambda d: d.replace("this rule", "this skill")
        self.assertEqual(normalize(skill), normalize(rule),
                         "orchestrator SKILL.md and rules/*.mdc descriptions must carry the same triggers")


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

    def test_missing_guidance_topic_has_a_documented_stop(self):
        # get-guidance name=workplaces is delivered by clio's knowledge library, not by this repo, so
        # an older clio or an inactive library answers unknown-topic. Without a stated degrade the
        # agent falls back to improvising the writes from tool contracts — the precise failure the
        # guidance exists to prevent, and one that ships a broken binding to the next environment.
        for path in (ESSENTIALS, IMPLEMENTATION_RUNBOOK):
            content = read_text(path)
            self.assertIn("unknown-topic", content)
            self.assertIn("STOP", content)
            # Naming the version is what makes the stop actionable: without it the developer learns
            # an upgrade is needed but not to what, and cannot tell an old library from an inactive
            # one. 1.13.0 is the first clio-knowledge release whose bundle carries the article;
            # 1.12.0 does not.
            self.assertIn("1.13.0", content)

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


class PlacementRuleConsistencyTests(unittest.TestCase):
    """The rule is deliberately written twice, and each file's own test pins only its own wording.

    `AGENTS.md` carries it into the first discovery batch; `context/business-checklist.md` carries the
    reference version that is read afterwards. Nothing previously compared the two, so they could drift
    apart while both files' individual substring assertions still passed — and they had already drifted on
    trigger scope before this test existed.
    """

    ESSENTIAL_FACTS = [
        "My applications",
        "System administrators",
    ]

    def test_both_copies_state_the_same_essential_facts(self):
        agents = read_text(AGENTS)
        checklist = read_text(CHECKLIST)
        for fact in self.ESSENTIAL_FACTS:
            self.assertIn(fact, agents, f"AGENTS.md must state {fact!r}")
            self.assertIn(fact, checklist, f"business-checklist.md must state {fact!r}")

    def test_neither_copy_scopes_the_rule_more_narrowly_than_the_trigger(self):
        # The trigger covers new apps AND new sections; neither copy may restrict the rule to apps only.
        for path in (AGENTS, CHECKLIST):
            content = read_text(path)
            self.assertNotIn("for a NEW app,", content, f"{path} scopes the rule to a new app only")
            self.assertNotIn("for a NEW app —", content, f"{path} scopes the rule to a new app only")

    def test_both_copies_require_the_audience_not_only_the_placement(self):
        for path in (AGENTS, CHECKLIST):
            content = read_text(path).lower()
            self.assertIn("audience", content, f"{path} must require the audience decision too")


class GuidanceTopicNameTests(unittest.TestCase):
    """The runbook and the skill hard-require clio guidance topics by name.

    A typo or a rename on either side surfaces only at runtime, because this repository cannot resolve
    clio's guidance catalog. Pinning the exact names here at least makes a local typo a CI failure, and
    documents which cross-repo names this toolkit depends on.
    """

    REQUIRED_TOPICS = ["get-guidance name=workplaces", "get-guidance name=home-page"]

    def test_implementation_runbook_names_the_topics_exactly(self):
        content = read_text(IMPLEMENTATION_RUNBOOK)
        for topic in self.REQUIRED_TOPICS:
            self.assertIn(topic, content, f"runbook must name {topic!r} exactly")

    def test_orchestrator_names_the_workplaces_topic_exactly(self):
        self.assertIn("get-guidance name=workplaces", read_text(ORCHESTRATOR_SKILL))


if __name__ == "__main__":
    unittest.main()
