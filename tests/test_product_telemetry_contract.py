from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


# The canonical, flow-agnostic stage vocabulary. WHICH flow a run belongs to
# travels in the `workflow` field. The alternative — a name per flow per stage
# (migration_plan_approved, branding_approved, ...) — encodes a dimension into
# the enum: names multiply by flows, every new skill needs a clio release, and
# comparing one funnel step across flows becomes a UNION over a hand-kept list.
STAGE_EVENTS = [
    "workflow_started",
    "clarification_requested",
    "user_input_received",
    "plan_presented",
    "plan_skipped",
    "plan_blocked",
    "plan_changes_requested",
    "plan_approved",
    "build_started",
    "work_item_completed",
    "workflow_completed",
    "workflow_failed",
    "changes_requested",
    "changes_applied",
]


# One `workflow` value per flow that can reach a Creatio environment.
WORKFLOW_VALUES = [
    "app-creation",
    "classic-to-freedom-migration",
    "mobile-page-conversion",
    "branding",
    "app-maintenance",
]


# Per-flow event names that must never come back: each duplicates a stage that
# already exists, and clio's allow-list rejects them.
BANNED_PER_FLOW_NAMES = [
    "migration_plan_approved",
    "branding_approved",
    "mobile_conversion_completed",
    "maintenance_change_completed",
]


# Each skill must map the shared stages onto its OWN gates and name its own
# workflow value. Telemetry previously lived only in the app orchestrator, which
# is why every other flow reported nothing.
SKILL_WORKFLOWS = {
    "classic-to-freedom-migration": "classic-to-freedom-migration",
    "creatio-mobile-page-conversion": "mobile-page-conversion",
    "creatio-branding-orchestrator": "branding",
}


def read(*parts: str) -> str:
    return (ROOT.joinpath(*parts)).read_text(encoding="utf-8")


def section(text: str, heading: str) -> str:
    """Return the body of a markdown section, up to the next top-level heading."""
    assert heading in text, f"missing section: {heading}"
    return text.split(heading, 1)[1].split("\n## ", 1)[0]


def section_of(source: str, definition: str) -> str:
    """Return one top-level Python definition's body, up to the next top-level def."""
    assert definition in source, f"missing definition: {definition}"
    body = source.split(definition, 1)[1]
    return body.split("\ndef ", 1)[0]


def table_events(body: str) -> set:
    """Collect the leading `code` cells from a markdown table."""
    return {
        match.group(1)
        for line in body.splitlines()
        for match in [re.match(r"^\|\s*`([a-z_]+)`\s*\|", line)]
        if match
    }


class ProductTelemetryContractTests(unittest.TestCase):
    def test_agents_references_product_telemetry_contract_file(self):
        agents = read("AGENTS.md")

        self.assertIn("Product Telemetry", agents)
        self.assertIn("context/product-telemetry.md", agents)
        self.assertIn("source of truth for consent handling", agents)

    def test_agents_states_the_rule_outside_the_gate_flow(self):
        agents = read("AGENTS.md")

        # The defect was structural, not a wording problem: the app-creation
        # checkpoints hang off Gate P/R and AGENTS.md exempts migration, mobile
        # conversion and branding from those gates. The rule must say explicitly
        # that a gate exemption is not a telemetry exemption.
        self.assertIn("no skill is exempt", agents)
        self.assertIn("does **not** mean being exempt from telemetry", agents)
        # And the flow must be a field, not a name.
        self.assertIn("`workflow`", agents)
        for value in WORKFLOW_VALUES:
            self.assertIn(value, agents)

    def test_contract_delegates_the_vocabulary_and_consent_to_clio(self):
        telemetry = read("context", "product-telemetry.md")

        # The vocabulary, the consent flow and the payload rules are owned by
        # clio's `product-telemetry` guidance article, because clio owns the
        # allow-list that validates them. Restating them here would create a
        # second source of truth that drifts on every clio release — and the
        # knowledge repository forbids duplicating a rule across owners.
        self.assertIn("get-guidance name=product-telemetry", telemetry)
        self.assertIn("get-tool-contract", telemetry)
        self.assertIn("owned by clio", telemetry)
        self.assertIn("Read the guidance article before your first emission", telemetry)
        # Delegation is worthless if the reader can still guess: the file must say
        # so, since a stage spelled from memory is rejected at runtime.
        self.assertIn("Do not infer the vocabulary from this", telemetry)
        # `coding_agent` / `plugin_version` are the only payload values this
        # repository supplies, so they stay named here.
        self.assertIn("`coding_agent`", telemetry)
        self.assertIn("`plugin_version`", telemetry)

    def test_contract_does_not_restate_the_delegated_rules(self):
        telemetry = read("context", "product-telemetry.md")

        # Guards the delegation itself. These phrases belong to the guidance
        # article now; if they reappear here, the two owners have started to
        # diverge and the older copy will silently win for some agent.
        for delegated in (
            "read-only consent check",
            "telemetry_consent=unknown",
            "Consent withdrawal",
            "pseudonymous installation identifier",
            "Telemetry must never include sensitive data",
        ):
            self.assertNotIn(delegated, telemetry)
        # The full stage list is delegated too: only the stages this file maps
        # onto gates may appear, never the vocabulary as an enumeration.
        for stage in ("clarification_requested", "changes_applied", "workflow_failed"):
            self.assertNotIn(stage, telemetry)

    def test_agents_md_does_not_instruct_the_deprecated_event_names(self):
        """AGENTS.md must not name the app-creation events the vocabulary replaced.

        It used to enumerate them as mandatory emission points in the UX Contract and the
        Orchestration Checklist while the Product Telemetry section two headings above said
        stages are delegated and must not be spelled from memory. An agent reading the file
        top to bottom got both instructions, and a measured run reported its ENTIRE funnel
        under those names — invisible to every funnel built on the stages.
        """
        agents = read("AGENTS.md")

        for deprecated in (
            "session_started",
            "pre_plan_clarification_requested",
            "pre_plan_user_input_received",
            "business_plan_generated",
            "business_plan_regenerated",
            "business_plan_generation_skipped",
            "business_plan_feedback_received",
            "business_plan_approved",
            "implementation_started",
            "implementation_completed",
            "implementation_failed",
        ):
            self.assertNotIn(deprecated, agents)

        # And it delegates rather than re-listing the replacements.
        self.assertIn("get-guidance name=product-telemetry", agents)
        for stage in ("clarification_requested", "plan_approved", "work_item_completed"):
            self.assertNotIn(f"`{stage}`", agents)

    def test_contract_does_not_reintroduce_per_flow_event_names(self):
        telemetry = read("context", "product-telemetry.md")

        for banned in BANNED_PER_FLOW_NAMES:
            self.assertNotIn(f"`{banned}`", telemetry.replace(
                "`migration_plan_approved`, `branding_approved`", ""))

    def test_contract_names_every_workflow_value(self):
        telemetry = read("context", "product-telemetry.md")

        # The `workflow` values ARE this file's business: each one names a CAADT
        # flow, and picking the value is the decision this contract owns.
        self.assertIn("`workflow` identifies the flow", telemetry)
        for value in WORKFLOW_VALUES:
            self.assertIn(f"`{value}`", telemetry)
        # The structural point that the whole change exists to fix.
        self.assertIn("not being exempt from telemetry", telemetry)

    def test_contract_maps_stages_onto_each_flows_gates(self):
        telemetry = read("context", "product-telemetry.md")

        # Generic stage names are only usable if the contract says WHERE each one
        # lands per flow — otherwise "plan_approved" is ambiguous.
        mapping = section(telemetry, "## Where each flow's stages land")
        for value in WORKFLOW_VALUES:
            self.assertIn(value, mapping)
        self.assertIn("Gate M", mapping)
        self.assertIn("plan.md", mapping)

    def test_every_environment_changing_skill_maps_the_stages_to_its_gates(self):
        for skill_name, workflow in SKILL_WORKFLOWS.items():
            with self.subTest(skill=skill_name):
                skill = read("skills", skill_name, "SKILL.md")
                self.assertIn("context/product-telemetry.md", skill)
                self.assertIn("send-telemetry", skill)
                # Its own workflow value, and the shared stages — not per-flow names.
                self.assertIn(f'`workflow: "{workflow}"`', skill)
                self.assertIn("workflow_started", skill)
                self.assertIn("clio rejects them", skill)

    def test_orchestrator_surfaces_stage_model_and_targeted_changes(self):
        for path in (
            ROOT / "skills" / "creatio-app-orchestrator" / "SKILL.md",
            ROOT / "rules" / "creatio-app-orchestrator.mdc",
        ):
            with self.subTest(surface=path.name):
                text = path.read_text(encoding="utf-8")
                self.assertIn("context/product-telemetry.md", text)
                self.assertIn("Analytics Context", text)
                self.assertIn("`coding_agent`", text)
                self.assertIn("`plugin_version`", text)
                # A targeted change skips Gate P/R and so has no approval stage —
                # it still must report something.
                self.assertIn("app-maintenance", text)
                self.assertIn("plan_skipped", text)
                # Delegated runs must not have their events emitted twice.
                self.assertIn("do not emit on its behalf", text)

    def test_every_stage_is_documented_at_a_point_of_use(self):
        # A stage that exists in the vocabulary but is named in no skill is a stage
        # no agent will ever emit — it looks like "that never happens" in the data
        # when really nothing asked for it. This caught `changes_applied` and the
        # post-completion `changes_requested` being defined but never routed.
        surfaces = {
            name: read("skills", name, "SKILL.md")
            for name in ("creatio-app-orchestrator", *SKILL_WORKFLOWS)
        }
        surfaces["cursor-rule"] = read("rules", "creatio-app-orchestrator.mdc")

        for stage in STAGE_EVENTS:
            with self.subTest(stage=stage):
                # Match the table cell, so `plan_changes_requested` cannot stand in
                # for the post-completion `changes_requested`.
                cell = f"`{stage}`"
                users = [name for name, text in surfaces.items() if cell in text]
                self.assertTrue(
                    users,
                    f"stage {stage} is in the vocabulary but no skill says when to emit it",
                )

    def test_orchestrator_emits_build_started_for_targeted_edits_too(self):
        # Uniformity is the point of a flow-agnostic vocabulary: if a targeted edit
        # skipped build_started, "how many runs reached the writing phase" would
        # need a per-flow special case — the thing this design removes.
        for path in (
            ROOT / "skills" / "creatio-app-orchestrator" / "SKILL.md",
            ROOT / "rules" / "creatio-app-orchestrator.mdc",
        ):
            with self.subTest(surface=path.name):
                text = path.read_text(encoding="utf-8")
                self.assertIn("emitted in **both** flows", text)

    def test_overlay_skills_do_not_open_their_own_session(self):
        # Naming/design skills are invoked BY a flow. A second session from them
        # would double-count; but run standalone they must not be silent either.
        for name in ("creatio-ui-guidelines", "creatio-schema-naming"):
            with self.subTest(skill=name):
                skill = read("skills", name, "SKILL.md")
                self.assertIn("no workflow of its own", skill)
                self.assertIn("would double-count", skill)
                self.assertIn("app-maintenance", skill)

    def test_cursor_gets_an_always_applied_telemetry_rule(self):
        # Cursor has no PreToolUse hook, so without an always-applied rule a
        # Cursor session that never loads a CAADT skill has nothing but clio's
        # server instructions — the original defect. The installer must write it.
        installer = read("installer", "install.py")

        self.assertIn("render_cursor_telemetry_rule", installer)
        self.assertIn("TELEMETRY_RULE_NAME", installer)
        self.assertIn("alwaysApply: true", installer)
        # It must carry the routing — that telemetry applies at all, and which flow this run
        # is — without restating the vocabulary. A rendered rule is written to disk once at
        # install time, so a stage list inside it goes stale on the next clio release with
        # nothing to correct it.
        self.assertIn("classic-to-freedom-migration", installer)
        self.assertIn("get-guidance name=product-telemetry", installer)
        rule = section_of(installer, "def render_cursor_telemetry_rule")
        # The per-flow counter-example stays; it is what stops the invented name.
        self.assertIn("migration_plan_approved", rule)
        rule = rule.replace("migration_plan_approved", "")
        for stage in ("workflow_started", "plan_approved", "changes_applied"):
            self.assertNotIn(stage, rule)


if __name__ == "__main__":
    unittest.main()
