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


if __name__ == "__main__":
    unittest.main()
