from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


REQUIRED_EVENTS = [
    "session_started",
    "pre_plan_clarification_requested",
    "pre_plan_user_input_received",
    "business_plan_generated",
    "business_plan_generation_skipped",
    "business_plan_feedback_received",
    "business_plan_regenerated",
    "business_plan_approved",
    "implementation_started",
    "implementation_completed",
    "implementation_changes_requested",
    "implementation_changes_applied",
    "implementation_failed",
    "implementation_user_input_received",
]


class ProductTelemetryContractTests(unittest.TestCase):
    def test_agents_references_product_telemetry_contract_file(self):
        agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")

        self.assertIn("Product Telemetry", agents)
        self.assertIn("context/product-telemetry.md", agents)
        self.assertIn("source of truth for consent handling", agents)

    def test_product_telemetry_contract_documents_required_events(self):
        telemetry = (ROOT / "context" / "product-telemetry.md").read_text(encoding="utf-8")

        self.assertIn("Product Telemetry Contract", telemetry)
        self.assertIn("send-telemetry", telemetry)
        self.assertIn("get-telemetry-consent", telemetry)
        self.assertIn("read-only consent check", telemetry)
        self.assertIn("telemetry_consent=unknown", telemetry)
        self.assertIn("single-purpose interaction", telemetry)
        self.assertIn("Do not combine the consent question", telemetry)
        self.assertIn("do not claim telemetry was recorded", telemetry)
        self.assertIn("Telemetry payload", telemetry)
        self.assertIn("Use only the fields listed in the Telemetry payload section", telemetry)
        self.assertIn("`session_id`", telemetry)
        self.assertIn("`event_name`", telemetry)
        self.assertIn("`coding_agent`", telemetry)
        self.assertIn("`plugin_version`", telemetry)
        self.assertIn("shown in the visible conversation body", telemetry)
        self.assertIn("never before or during drafting", telemetry)
        self.assertIn("required runtime context is available", telemetry)
        self.assertIn("before starting the follow-up change work", telemetry)
        self.assertIn("after the follow-up change is complete", telemetry)
        self.assertIn("Telemetry emission checkpoints", telemetry)
        self.assertIn("After explicit plan approval", telemetry)
        self.assertIn("before first implementation action", telemetry)
        self.assertIn("When implementation cannot continue", telemetry)
        # Parse the event names declared in the "Required event mapping"
        # section and assert they EXACTLY match REQUIRED_EVENTS (as sets, so
        # ordering differences are ignored — the doc and REQUIRED_EVENTS orders
        # legitimately differ). A plain substring check passes even when an
        # extra, missing, or typo'd event is present; set equality catches all
        # three. Scope the parse to the mapping section so event names appearing
        # in prose elsewhere are not counted.
        section = telemetry.split("Required event mapping:", 1)[1]
        section = section.split("Telemetry emission checkpoints:", 1)[0]
        documented_events = {
            match.group(1)
            for line in section.splitlines()
            for match in [re.match(r"^- `([a-z_]+)`:", line)]
            if match
        }
        self.assertEqual(documented_events, set(REQUIRED_EVENTS))

    def test_product_telemetry_contract_documents_consent_withdrawal(self):
        telemetry = (ROOT / "context" / "product-telemetry.md").read_text(encoding="utf-8")

        # The consent prompt must disclose that consent can be withdrawn, so the
        # decision is informed and the right to withdraw is as easy as granting
        # (GDPR Art. 7(3)).
        self.assertIn("consent can be withdrawn at any time", telemetry)
        # The withdrawal flow must be documented and route to the clio MCP tool.
        self.assertIn("Consent withdrawal", telemetry)
        self.assertIn("withdraw-telemetry-consent", telemetry)
        self.assertIn("withdraw telemetry consent at any time", telemetry)
        # Withdrawal is forward-looking, not retroactive: already-uploaded events
        # are not deleted (that is server-side erasure, out of this contract).
        self.assertIn("does not delete events already uploaded to Creatio", telemetry)

    def test_consent_prompt_discloses_pseudonymous_identifier(self):
        telemetry = (ROOT / "context" / "product-telemetry.md").read_text(encoding="utf-8")

        # The threat analysis classifies the dataset as pseudonymous personal data
        # (a random installation id, GDPR Recital 30), so the consent prompt must
        # disclose that identifier and must not claim "no personal data". It states
        # only that no DIRECTLY IDENTIFYING personal data is collected.
        self.assertIn("pseudonymous installation identifier", telemetry)
        self.assertIn("directly identifying personal data", telemetry)
        self.assertNotIn("credentials, or personal data)", telemetry)

    def test_skill_entrypoint_references_product_telemetry_contract_file(self):
        skill = (ROOT / "skills" / "creatio-app-orchestrator" / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("context/product-telemetry.md", skill)
        self.assertIn("Analytics Context values", skill)
        self.assertIn("## Analytics Context", skill)
        self.assertIn("`coding_agent`", skill)
        self.assertIn("`plugin_version`", skill)

    def test_cursor_rule_references_product_telemetry_contract_file(self):
        # The committed .mdc ships verbatim via the marketplace and is the
        # artifact Cursor-marketplace users receive, so it gets the same
        # contract coverage as SKILL.md (these surfaces are maintained in
        # parallel and have drifted before).
        rule = (ROOT / "rules" / "creatio-app-orchestrator.mdc").read_text(encoding="utf-8")

        self.assertIn("context/product-telemetry.md", rule)
        self.assertIn("Analytics Context values", rule)
        self.assertIn("## Analytics Context", rule)
        self.assertIn("`coding_agent`", rule)
        self.assertIn("`plugin_version`", rule)


if __name__ == "__main__":
    unittest.main()
