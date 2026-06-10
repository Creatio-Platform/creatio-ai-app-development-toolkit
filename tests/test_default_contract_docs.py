import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def existing(paths):
    return [path for path in paths if path.exists()]

AUTHORITY_DOCS = existing([
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "context/essentials.md",
    ROOT / "context/INDEX.md",
])

WORKFLOW_ONLY_SCHEMA_DOCS = existing([
    ROOT / "context/INDEX.md",
    ROOT / "context/essentials.md",
])

ACTIVE_CONTRACT_SURFACE_DOCS = existing([
    ROOT / "README.md",
    ROOT / "context/INDEX.md",
    ROOT / "context/essentials.md",
])

DOC_PATHS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "context/essentials.md",
]

CANONICAL_FLOW_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "context/essentials.md",
    ROOT / "context/INDEX.md",
]

FALLBACK_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "context/essentials.md",
]

CHECKLIST_SOURCE_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
    ROOT / "README.md",
]

PRE_ANALYSIS_DOCS = [
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
]

FIRST_TURN_LATENCY_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/02-requirements-gathering.md",
]

DOMAIN_EXPERTISE_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
]

STDIO_ONLY_DOCS = existing([
    ROOT / "AGENTS.md",
    ROOT / "runbooks/01-environment-setup.md",
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "README.md",
    ROOT / "skills/README.md",
])

DOT_STYLE_APPLICATION_TOOL_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "context/business-checklist.md",
    ROOT / "context/essentials.md",
]

# ENG-91276: native MCP tool-calls are preferred over the mcp_client.py stdio wrapper.
NATIVE_MCP_FIRST_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "context/INDEX.md",
    ROOT / "context/essentials.md",
    ROOT / "skills/creatio-app-orchestrator/SKILL.md",
    ROOT / "runbooks/01-environment-setup.md",
]

# ENG-91276: native MCP and the wrapper must share one clio config / environment list.
SINGLE_CLIO_CONTEXT_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/01-environment-setup.md",
]

# ENG-91276: a writable package context must be resolved before schema/page edits.
WRITABLE_PACKAGE_CONTEXT_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/01-environment-setup.md",
    ROOT / "skills/creatio-app-orchestrator/SKILL.md",
]


def read_text(path):
    return path.read_text(encoding="utf-8")


def contains_any(text, markers):
    return any(marker in text for marker in markers)


def contains_all(text, markers):
    return all(marker in text for marker in markers)


class DefaultContractDocsTests(unittest.TestCase):
    def test_authority_docs_point_to_clio_mcp_contract(self):
        for path in AUTHORITY_DOCS:
            content = read_text(path)
            self.assertIn("get-tool-contract", content, str(path))
        agents_doc = read_text(ROOT / "AGENTS.md")
        self.assertRegex(agents_doc, r"only authoritative source|single source of truth")
        self.assertRegex(agents_doc, r"must not define an independent MCP API contract|must not define an independent MCP contract")

    def test_docs_delegate_default_semantics_to_clio_guidance(self):
        for path in DOC_PATHS:
            content = read_text(path)
            self.assertTrue(
                contains_any(content, [
                    "docs://mcp/guides/app-modeling",
                    "current `clio` MCP guidance",
                    "current `clio` MCP contract",
                ]) or "default requirement" in content.lower(),
                str(path),
            )
        requirements_doc = read_text(ROOT / "runbooks/02-requirements-gathering.md")
        self.assertTrue(
            contains_all(requirements_doc, [
                "`schema default`",
                "`ui default`",
                "visible BA draft",
            ])
        )

    def test_active_docs_delegate_canonical_mcp_guidance_to_clio_resources(self):
        delegation_hits = 0
        for path in CANONICAL_FLOW_DOCS:
            content = read_text(path)
            if "docs://mcp/guides/app-modeling" in content or "docs://mcp/guides/existing-app-maintenance" in content:
                delegation_hits += 1
        self.assertGreaterEqual(delegation_hits, 3)

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
            content = read_text(path)
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_docs_require_confirmed_or_assumed_checklist_sources(self):
        for path in CHECKLIST_SOURCE_DOCS:
            content = read_text(path)
            self.assertIn("confirmed", content, str(path))
            self.assertIn("assumed", content, str(path))

    def test_docs_require_pre_analysis_before_ba_draft(self):
        for path in PRE_ANALYSIS_DOCS:
            content = read_text(path)
            self.assertIn("pre-analysis", content, str(path))

    def test_docs_define_first_turn_latency_bootstrap_rule(self):
        for path in FIRST_TURN_LATENCY_DOCS:
            content = read_text(path).lower()
            self.assertIn("first", content, str(path))
            self.assertIn("latency", content, str(path))
            self.assertIn("structured input", content, str(path))
            self.assertIn("do not read large repository files", content, str(path))

    def test_docs_require_domain_expertise_for_recognizable_app_types(self):
        for path in DOMAIN_EXPERTISE_DOCS:
            content = read_text(path).lower()
            self.assertIn("domain expertise", content, str(path))
            self.assertTrue(
                "standard baseline" in content
                or "standard business attributes" in content
                or "standard baseline attributes" in content,
                str(path),
            )

    def test_docs_define_fixed_business_plan_rendering_contract(self):
        agents_doc = read_text(ROOT / "AGENTS.md")
        self.assertTrue(contains_all(agents_doc, ["exact", "BA-style Business Plan structure"]))

        agent_doc = read_text(ROOT / "runbooks/02-requirements-gathering.md")
        self.assertIn("Document Rendering Contract", agent_doc)
        self.assertIn("Hard Fail Conditions", agent_doc)
        self.assertTrue(contains_all(agent_doc, ["Use tables only", "## 3. Object Model"]))
        self.assertTrue(contains_all(agent_doc, ["entity field tables", "prose summaries"]))
        self.assertIn("entity metadata block", agent_doc)
        self.assertTrue(contains_all(agent_doc, ["child-side link status", "when applicable"]))
        self.assertIn("## 1. Business Outcome", agent_doc)
        self.assertIn("## 2. Roles and Permissions", agent_doc)
        self.assertIn("## 3. Object Model", agent_doc)
        self.assertIn("## 6. UX Expectations", agent_doc)
        self.assertTrue(contains_all(agent_doc, ["`schema default`", "`ui default`", "visible BA draft"]))
        self.assertNotIn("## 6. Implementation-shaping decisions and assumptions", agent_doc)

        checklist_doc = read_text(ROOT / "context/business-checklist.md").lower()
        self.assertIn("business logic quality bar", checklist_doc)
        self.assertIn("markdown tables outside the object model section", checklist_doc)

    def test_docs_keep_persistence_and_internal_mechanics_out_of_ba_dialogue(self):
        agents_doc = read_text(ROOT / "AGENTS.md").lower()
        self.assertIn("do not expose internal commands", agents_doc)

        agent02_doc = read_text(ROOT / "runbooks/02-requirements-gathering.md").lower()
        self.assertIn("do not expose internal commands", agent02_doc)

    def test_docs_define_stdio_only_mcp_contract(self):
        legacy_mcp_url = "mcp" + "Url"
        legacy_frontend_label = "frontend MCP " + "URL"
        for path in STDIO_ONLY_DOCS:
            content = read_text(path)
            self.assertNotIn(legacy_mcp_url, content, str(path))
            self.assertNotIn(legacy_frontend_label, content, str(path))

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
            content = read_text(path)
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_authority_docs_do_not_present_exact_canonical_flows_as_repo_owned_mcp_truth(self):
        disallowed_flow_patterns = [
            r"create-app\s*->\s*sync-schemas\s*->\s*get-app-info",
            r"list-pages\s*->\s*get-page\s*->\s*sync-pages\s*->\s*get-page",
        ]
        for path in CANONICAL_FLOW_DOCS:
            content = read_text(path)
            for pattern in disallowed_flow_patterns:
                self.assertIsNone(re.search(pattern, content), f"{path}: {pattern}")

    def test_authority_docs_delegate_page_fallback_policy_to_clio_guidance(self):
        for path in FALLBACK_DOCS:
            content = read_text(path)
            self.assertIn("docs://mcp/guides/existing-app-maintenance", content, str(path))

    def test_repo_preserves_policy_surfaces(self):
        agents_doc = read_text(ROOT / "AGENTS.md")
        self.assertTrue("Business context" in agents_doc or "Business Outcome" in agents_doc)
        self.assertTrue(
            "Users, access and ownership" in agents_doc
            or "Roles and Permissions" in agents_doc
        )
        self.assertIn("orchestration", agents_doc.lower())
        self.assertIn("approvals", agents_doc.lower())
        self.assertIn("business invariants", agents_doc.lower())

    def test_schema_docs_delegate_entity_and_schema_semantics_to_clio(self):
        disallowed_markers = [
            "BaseLookup",
            "PrimaryDisplayColumn",
            "defaultValueSource",
            "default-value-source",
            "title-localizations",
            "reference-schema-name",
            "seed-rows",
        ]
        for path in WORKFLOW_ONLY_SCHEMA_DOCS:
            content = read_text(path)
            self.assertIn("get-tool-contract", content, str(path))
            self.assertIn("docs://mcp/guides/app-modeling", content, str(path))
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_authority_docs_do_not_restate_clio_owned_guidance_markers(self):
        disallowed_markers = [
            "canonical-main-entity-name",
            "scalar-only",
        ]
        scoped_docs = [
            ROOT / "README.md",
            ROOT / "context/INDEX.md",
            ROOT / "context/essentials.md",
        ]
        for path in scoped_docs:
            content = read_text(path)
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_docs_do_not_use_dot_style_application_tool_names(self):
        for path in DOT_STYLE_APPLICATION_TOOL_DOCS:
            content = read_text(path)
            self.assertNotIn("application.create", content, str(path))
            self.assertNotIn("application.get_list", content, str(path))
            self.assertNotIn("application.get_info", content, str(path))


    def test_docs_route_page_edits_to_web_vs_mobile(self):
        # Routing surfaces force reading essentials before a page edit (pointer, not nuance).
        for path in [ROOT / "AGENTS.md", ROOT / "skills/creatio-app-orchestrator/SKILL.md"]:
            content = read_text(path)
            self.assertIn("essentials", content, str(path))
            self.assertRegex(content, r"(?i)web.{0,20}mobile|mobile.{0,20}web", str(path))
        # The page-schema nuance lives in essentials, not in the routers.
        essentials = read_text(ROOT / "context/essentials.md")
        self.assertIn("_MobileFormPage", essentials)
        self.assertRegex(essentials, r"(?i)web vs mobile")
        self.assertRegex(essentials, r"(?i)default to web")

    def test_docs_prefer_native_mcp_over_stdio_wrapper(self):
        # ENG-91276: every transport-aware doc must prefer native MCP and treat
        # runtime/scripts/mcp_client.py as the stdio fallback, not the default.
        for path in NATIVE_MCP_FIRST_DOCS:
            content = read_text(path).lower()
            self.assertIn("native", content, str(path))
            self.assertIn("fallback", content, str(path))
            self.assertIn("mcp_client.py", content, str(path))

    def test_docs_require_single_clio_context(self):
        # ENG-91276: native MCP and the wrapper must resolve the same clio
        # (one config / one registered-environments list) — no split-brain.
        for path in SINGLE_CLIO_CONTEXT_DOCS:
            content = read_text(path).lower()
            self.assertIn("single clio context", content, str(path))
            self.assertIn("split-brain", content, str(path))

    def test_docs_require_writable_package_context_up_front(self):
        # ENG-91276: a writable package context must be resolved before the first
        # schema/page edit, not discovered as a mid-run write rejection.
        for path in WRITABLE_PACKAGE_CONTEXT_DOCS:
            content = read_text(path).lower()
            self.assertIn("writable package context", content, str(path))
            self.assertIn("up front", content, str(path))
            self.assertIn("mid-run", content, str(path))


if __name__ == "__main__":
    unittest.main()
