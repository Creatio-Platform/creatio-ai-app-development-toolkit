import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATHS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "agents/03-implementation-plan.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "context/essentials.md",
    ROOT / "context/mcp-application-tools-reference.md"
]
CHECKLIST_SOURCE_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
    ROOT / "README.md"
]
EVIDENCE_STATUS_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "README.md"
]
PAGE_SYNC_PLAN_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/03-implementation-plan.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "README.md"
]
PRE_ANALYSIS_DOCS = [
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md"
]
FIRST_TURN_LATENCY_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/02-requirements-gathering.md"
]
DOMAIN_EXPERTISE_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md"
]
STDIO_ONLY_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/01-environment-setup.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "context/mcp-application-tools-reference.md",
    ROOT / ".github/copilot-instructions.md",
    ROOT / "README.md",
    ROOT / "skills/README.md"
]
MISSING_HELPER_REFERENCE_DOCS = [
    ROOT / "README.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "agents/04-implementation.md"
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
    ROOT / "skills/page-creation/SKILL.md",
]
BINDING_GET_COLUMNS_DOCS = [
    ROOT / "context/essentials.md",
    ROOT / "context/INDEX.md",
]
AGENT_FIVE_DOCS = [
    ROOT / "skills/page-creation/SKILL.md",
]
POWERSHELL_RUNTIME_DOCS = [
    ROOT / "README.md",
    ROOT / "docs/mcp-testing-guide.md",
    ROOT / "context/mcp-application-tools-reference.md",
]
ARGS_FILE_DOCS = [
    ROOT / "README.md",
    ROOT / "docs/mcp-testing-guide.md",
    ROOT / "context/mcp-application-tools-reference.md",
]
PAGE_SYNC_PREFERRED_DOCS = [
    ROOT / "agents/04-implementation.md",
    ROOT / "context/mcp-application-tools-reference.md",
]


class DefaultContractDocsTests(unittest.TestCase):
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

    def test_docs_keep_seed_data_separate_from_default_rules(self):
        plan_doc = (ROOT / "agents/03-implementation-plan.md").read_text(encoding="utf-8")
        self.assertIn("Seed data alone does not satisfy a default requirement.", plan_doc)
        self.assertIn("A requirement such as `UsrStatus defaults to New` is incomplete", plan_doc)

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
            content = path.read_text(encoding="utf-8")
            self.assertIn("first", content.lower(), str(path))
            self.assertIn("latency", content.lower(), str(path))
            self.assertIn("structured input", content.lower(), str(path))
            self.assertIn("do not read large repository files or run orchestration scripts", content.lower(), str(path))

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
        self.assertNotIn("context/app-documentation-contract.md", agents_doc)

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
        self.assertNotIn("context/app-documentation-contract.md", agent_doc)

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

    def test_docs_do_not_reference_missing_app_docs_helper(self):
        for path in MISSING_HELPER_REFERENCE_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("scripts/app_docs.py", content, str(path))

    def test_docs_do_not_use_dot_style_application_tool_names(self):
        for path in DOT_STYLE_APPLICATION_TOOL_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("application.create", content, str(path))
            self.assertNotIn("application.get_list", content, str(path))
            self.assertNotIn("application.get_info", content, str(path))

    def test_docs_do_not_reference_binding_get_columns(self):
        for path in BINDING_GET_COLUMNS_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("binding-get-columns", content, str(path))

    def test_docs_do_not_mention_agent_five(self):
        for path in AGENT_FIVE_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("Agent 5", content, str(path))

    def test_runtime_docs_include_powershell_parity(self):
        for path in POWERSHELL_RUNTIME_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("PowerShell", content, str(path))

    def test_runtime_docs_document_args_file_execution(self):
        for path in ARGS_FILE_DOCS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("--args-file", content, str(path))

    def test_page_sync_docs_prefer_fast_path_with_fallback(self):
        agent_doc = (ROOT / "agents/04-implementation.md").read_text(encoding="utf-8")
        self.assertNotIn("MANDATORY for new apps", agent_doc)
        self.assertIn("preferred", agent_doc.lower())
        self.assertIn("fallback", agent_doc.lower())

        reference_doc = (ROOT / "context/mcp-application-tools-reference.md").read_text(encoding="utf-8")
        self.assertIn("preferred", reference_doc.lower())
        self.assertIn("fallback", reference_doc.lower())


if __name__ == "__main__":
    unittest.main()
