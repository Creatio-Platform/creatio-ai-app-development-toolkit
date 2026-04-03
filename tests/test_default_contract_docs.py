import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

AUTHORITY_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "context/essentials.md",
    ROOT / "context/INDEX.md",
    ROOT / "context/data-bindings-reference.md",
    ROOT / "agents/03-implementation-plan.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "docs/mcp-testing-guide.md",
    ROOT / "skills/README.md",
    ROOT / "skills/entity-creation/SKILL.md",
    ROOT / "skills/data-bindings-creation/SKILL.md",
    ROOT / "skills/page-schema-editing/SKILL.md",
    ROOT / ".github/copilot-instructions.md",
]

WORKFLOW_ONLY_SCHEMA_DOCS = [
    ROOT / "context/INDEX.md",
    ROOT / "context/essentials.md",
    ROOT / "context/schema-reference.md",
    ROOT / "agents/03-implementation-plan.md",
    ROOT / "skills/entity-creation/SKILL.md",
    ROOT / ".github/copilot-instructions.md",
]

ACTIVE_CONTRACT_SURFACE_DOCS = [
    ROOT / "README.md",
    ROOT / "context/INDEX.md",
    ROOT / "context/essentials.md",
    ROOT / "context/data-bindings-reference.md",
    ROOT / "agents/03-implementation-plan.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "docs/mcp-testing-guide.md",
    ROOT / "skills/entity-creation/SKILL.md",
    ROOT / "skills/data-bindings-creation/SKILL.md",
    ROOT / "skills/page-schema-editing/SKILL.md",
    ROOT / ".github/copilot-instructions.md",
]

HISTORICAL_OPTIMIZATION_DOCS = sorted((ROOT / "docs/optimization").glob("*.md"))

DOC_PATHS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "agents/03-implementation-plan.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "context/essentials.md",
    ROOT / "context/mcp-application-tools-reference.md",
]

CANONICAL_FLOW_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "context/essentials.md",
    ROOT / "context/INDEX.md",
    ROOT / "agents/03-implementation-plan.md",
    ROOT / "agents/04-implementation.md",
]

FALLBACK_DOCS = [
    ROOT / "context/essentials.md",
    ROOT / "README.md",
    ROOT / "agents/04-implementation.md",
]

CHECKLIST_SOURCE_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
    ROOT / "README.md",
]

EVIDENCE_STATUS_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "README.md",
]

PAGE_SYNC_PLAN_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/03-implementation-plan.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "README.md",
]

PRE_ANALYSIS_DOCS = [
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
]

FIRST_TURN_LATENCY_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/02-requirements-gathering.md",
]

DOMAIN_EXPERTISE_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
]

STDIO_ONLY_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/01-environment-setup.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "context/mcp-application-tools-reference.md",
    ROOT / ".github/copilot-instructions.md",
    ROOT / "README.md",
    ROOT / "skills/README.md",
]

DOT_STYLE_APPLICATION_TOOL_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "context/business-checklist.md",
    ROOT / "context/essentials.md",
    ROOT / "context/mcp-application-tools-reference.md",
    ROOT / "context/data-bindings-reference.md",
    ROOT / "skills/README.md",
    ROOT / "skills/entity-creation/SKILL.md",
]


class DefaultContractDocsTests(unittest.TestCase):
    def test_authority_docs_point_to_clio_mcp_contract(self):
        for path in AUTHORITY_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("tool-contract-get", content, str(path))
        agents_doc = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("only authoritative source", agents_doc)
        self.assertIn("must not define an independent MCP API contract", agents_doc)
        reference_doc = (ROOT / "context/mcp-application-tools-reference.md").read_text(encoding="utf-8")
        self.assertIn("It is not the executable MCP specification.", reference_doc)

    def test_docs_delegate_default_semantics_to_clio_guidance(self):
        for path in DOC_PATHS:
            content = path.read_text(encoding="utf-8")
            self.assertTrue(
                "docs://mcp/guides/app-modeling" in content
                or "current `clio` MCP guidance" in content
                or "current `clio` MCP contract" in content
                or "default requirement" in content.lower(),
                str(path),
            )
        requirements_doc = (ROOT / "agents/02-requirements-gathering.md").read_text(encoding="utf-8")
        self.assertIn("Do not use implementation labels such as `schema default` or `ui default` in the visible BA draft.", requirements_doc)

    def test_active_docs_delegate_canonical_mcp_guidance_to_clio_resources(self):
        delegation_hits = 0
        for path in CANONICAL_FLOW_DOCS:
            content = path.read_text(encoding="utf-8")
            if "docs://mcp/guides/app-modeling" in content or "docs://mcp/guides/existing-app-maintenance" in content:
                delegation_hits += 1
        self.assertGreaterEqual(delegation_hits, 5)

    def test_docs_keep_seed_data_separate_from_default_rules(self):
        plan_doc = (ROOT / "agents/03-implementation-plan.md").read_text(encoding="utf-8")
        self.assertIn("Seed data alone does not satisfy a default requirement.", plan_doc)
        self.assertIn("A requirement such as `UsrStatus defaults to New` is incomplete", plan_doc)

    def test_active_docs_do_not_restate_clio_owned_field_level_contract_details(self):
        disallowed_markers = [
            "title-localizations",
            "description-localizations",
            "reference-schema-name",
            "update-operations",
            "seed-rows",
            "`default-value`",
            "`default-value-source`",
        ]
        for path in ACTIVE_CONTRACT_SURFACE_DOCS:
            content = path.read_text(encoding="utf-8")
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_docs_require_confirmed_or_assumed_checklist_sources(self):
        for path in CHECKLIST_SOURCE_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("confirmed", content, str(path))
            self.assertIn("assumed", content, str(path))

    def test_docs_define_evidence_status_buckets(self):
        for path in EVIDENCE_STATUS_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("machineChecked", content, str(path))
            self.assertIn("manualCheckPending", content, str(path))

    def test_docs_define_machine_readable_page_sync_contract(self):
        for path in PAGE_SYNC_PLAN_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("page-sync-plan.json", content, str(path))
            self.assertIn("PAGE_SYNC_PLAN_JSON_START", content, str(path))

    def test_docs_require_pre_analysis_before_ba_draft(self):
        for path in PRE_ANALYSIS_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("pre-analysis", content, str(path))

    def test_docs_define_first_turn_latency_bootstrap_rule(self):
        for path in FIRST_TURN_LATENCY_DOCS:
            content = path.read_text(encoding="utf-8").lower()
            self.assertIn("first", content, str(path))
            self.assertIn("latency", content, str(path))
            self.assertIn("structured input", content, str(path))
            self.assertIn("do not read large repository files or run orchestration scripts", content, str(path))

    def test_docs_require_domain_expertise_for_recognizable_app_types(self):
        for path in DOMAIN_EXPERTISE_DOCS:
            content = path.read_text(encoding="utf-8").lower()
            self.assertIn("domain expertise", content, str(path))
            self.assertTrue(
                "standard baseline" in content
                or "standard business attributes" in content
                or "standard baseline attributes" in content,
                str(path),
            )

    def test_docs_define_fixed_business_plan_rendering_contract(self):
        agents_doc = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("exact BA-style Business Plan structure", agents_doc)

        agent_doc = (ROOT / "agents/02-requirements-gathering.md").read_text(encoding="utf-8")
        self.assertIn("Document Rendering Contract", agent_doc)
        self.assertIn("Hard Fail Conditions", agent_doc)
        self.assertIn("Use tables only in `## 4. Domain Model`", agent_doc)
        self.assertIn("Do not replace the entity field tables with prose summaries", agent_doc)
        self.assertIn("entity metadata block", agent_doc)
        self.assertIn("required or optional child-side link status when applicable", agent_doc)
        self.assertIn("## 1. Business Outcome", agent_doc)
        self.assertIn("## 7. UX Expectations", agent_doc)
        self.assertIn("Do not use implementation labels such as `schema default` or `ui default` in the visible BA draft.", agent_doc)
        self.assertNotIn("## 6. Implementation-shaping decisions and assumptions", agent_doc)

        checklist_doc = (ROOT / "context/business-checklist.md").read_text(encoding="utf-8").lower()
        self.assertIn("business logic quality bar", checklist_doc)
        self.assertIn("markdown tables outside the data model section", checklist_doc)

    def test_docs_keep_persistence_and_internal_mechanics_out_of_ba_dialogue(self):
        agents_doc = (ROOT / "AGENTS.md").read_text(encoding="utf-8").lower()
        self.assertIn("do not expose internal commands", agents_doc)

        agent02_doc = (ROOT / "agents/02-requirements-gathering.md").read_text(encoding="utf-8").lower()
        self.assertIn("do not expose internal commands", agent02_doc)

    def test_docs_define_stdio_only_mcp_contract(self):
        legacy_mcp_url = "mcp" + "Url"
        legacy_frontend_label = "frontend MCP " + "URL"
        for path in STDIO_ONLY_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertNotIn(legacy_mcp_url, content, str(path))
            self.assertNotIn(legacy_frontend_label, content, str(path))
        reference_doc = (ROOT / "context/mcp-application-tools-reference.md").read_text(encoding="utf-8")
        self.assertIn("clio stdio transport", reference_doc)
        self.assertIn("Do not use curl as an MCP execution pattern.", reference_doc)

    def test_active_policy_docs_do_not_embed_hand_written_contract_tables(self):
        disallowed_markers = [
            "Parameter | Type | Required",
            "Parameters (all kebab-case)",
            "Request Shapes",
            "Expected Response",
            "Tool name:",
            "All parameters are strings",
        ]
        for path in AUTHORITY_DOCS:
            content = path.read_text(encoding="utf-8")
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_historical_optimization_docs_do_not_embed_executable_contract_sections(self):
        disallowed_markers = [
            "Input shape:",
            "Response shape:",
            "```json",
            "prompts/get",
            "resources/read",
        ]
        for path in HISTORICAL_OPTIMIZATION_DOCS:
            content = path.read_text(encoding="utf-8")
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_authority_docs_do_not_present_exact_canonical_flows_as_repo_owned_mcp_truth(self):
        disallowed_flow_markers = [
            "application-create -> schema-sync -> application-get-info",
            "page-list -> page-get -> page-sync -> page-get",
        ]
        for path in CANONICAL_FLOW_DOCS:
            content = path.read_text(encoding="utf-8")
            for marker in disallowed_flow_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_authority_docs_delegate_page_fallback_policy_to_clio_guidance(self):
        for path in FALLBACK_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("docs://mcp/guides/existing-app-maintenance", content, str(path))

    def test_repo_preserves_policy_surfaces(self):
        agents_doc = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.assertTrue("Business context" in agents_doc or "Business Outcome" in agents_doc)
        self.assertTrue("Users, access and ownership" in agents_doc or "Access / Personas" in agents_doc)
        self.assertIn("orchestration", agents_doc.lower())
        self.assertIn("approvals", agents_doc.lower())
        self.assertIn("business invariants", agents_doc.lower())
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("machineChecked", readme)
        self.assertIn("manualCheckPending", readme)
        ui_reference = (ROOT / "context/ui-reference.md").read_text(encoding="utf-8").lower()
        self.assertIn("page sync", ui_reference)
        viewconfig_reference = (ROOT / "context/viewconfig-reference.md").read_text(encoding="utf-8").lower()
        self.assertIn("page-sync", viewconfig_reference)

    def test_schema_docs_delegate_entity_and_schema_semantics_to_clio(self):
        disallowed_markers = [
            "BaseLookup",
            "PrimaryDisplayColumn",
            "defaultValueSource",
            "default-value-source",
            "PhoneNumber",
            "WebLink",
            "Email",
            "UsrName",
            "UsrTitle",
            "UsrCaption",
            "duplicate title",
        ]
        for path in WORKFLOW_ONLY_SCHEMA_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("tool-contract-get", content, str(path))
            self.assertIn("docs://mcp/guides/app-modeling", content, str(path))
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_authority_docs_do_not_restate_clio_owned_guidance_markers(self):
        disallowed_markers = [
            "canonical-main-entity-name",
            "scalar-only",
            "component-info",
        ]
        scoped_docs = [
            ROOT / "README.md",
            ROOT / "context/INDEX.md",
            ROOT / "context/essentials.md",
            ROOT / "agents/03-implementation-plan.md",
            ROOT / "agents/04-implementation.md",
        ]
        for path in scoped_docs:
            content = path.read_text(encoding="utf-8")
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_docs_do_not_use_dot_style_application_tool_names(self):
        for path in DOT_STYLE_APPLICATION_TOOL_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("application.create", content, str(path))
            self.assertNotIn("application.get_list", content, str(path))
            self.assertNotIn("application.get_info", content, str(path))


if __name__ == "__main__":
    unittest.main()
