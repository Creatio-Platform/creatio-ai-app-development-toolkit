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


class DefaultContractDocsTests(unittest.TestCase):
    def test_docs_define_schema_and_ui_defaults(self):
        for path in DOC_PATHS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("schema default", content, str(path))
            self.assertIn("ui default", content, str(path))

    def test_docs_reject_seed_rows_as_default_closure(self):
        for path in DOC_PATHS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("Lookup seed rows alone do not satisfy", content, str(path))

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
        self.assertIn("Use tables only in section 4", agent_doc)
        self.assertIn("Do not replace the entity field tables with prose summaries", agent_doc)
        self.assertIn("entity metadata block", agent_doc)
        self.assertIn("required or optional child-side link status when applicable", agent_doc)
        self.assertIn("System value:", agent_doc)
        self.assertIn("What should feel easy in the MVP:", agent_doc)
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


if __name__ == "__main__":
    unittest.main()
