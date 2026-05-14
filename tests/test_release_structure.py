import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_json(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


class ReleaseStructureTests(unittest.TestCase):
    def test_root_plugin_manifests_exist_and_share_identity(self):
        manifests = [
            read_json(".claude-plugin/plugin.json"),
            read_json(".codex-plugin/plugin.json"),
            read_json(".cursor-plugin/plugin.json"),
            read_json(".github/plugin/plugin.json"),
        ]

        for manifest in manifests:
            self.assertEqual(manifest["name"], "creatio-ai-app-development-toolkit")
            self.assertRegex(manifest["version"], r"^\d+\.\d+\.\d+$")
            self.assertIn("Creatio", manifest["description"])

        self.assertEqual(read_json(".codex-plugin/plugin.json")["skills"], "./skills/")

        cursor = read_json(".cursor-plugin/plugin.json")
        self.assertEqual(cursor["displayName"], "Creatio AI App Development Toolkit")
        self.assertEqual(cursor["skills"], "./skills/")
        self.assertEqual(cursor["rules"], "./rules/")
        self.assertEqual(cursor["mcpServers"], "./.mcp.json")

    def test_public_trigger_text_uses_general_creatio_app_wording(self):
        public_text_paths = [
            ".claude-plugin/plugin.json",
            ".codex-plugin/plugin.json",
            ".cursor-plugin/plugin.json",
            ".github/plugin/plugin.json",
            ".claude-plugin/marketplace.json",
            ".github/plugin/marketplace.json",
            "skills/creatio-app-orchestrator/SKILL.md",
            "rules/creatio-app-orchestrator.mdc",
        ]

        for relative_path in public_text_paths:
            content = (ROOT / relative_path).read_text(encoding="utf-8").lower()
            self.assertIn("creatio app", content, relative_path)
            self.assertNotIn("composable app", content, relative_path)
            self.assertNotIn("composable application", content, relative_path)

    def test_mcp_config_runs_global_clio_mcp_server(self):
        config = read_json(".mcp.json")
        clio = config["mcpServers"]["clio"]
        self.assertEqual(clio["command"], "clio")
        self.assertEqual(clio["args"], ["mcp-server"])

    def test_cursor_plugin_rule_is_valid(self):
        self.assertFalse((ROOT / ".cursor").exists())
        rule = (ROOT / "rules/creatio-app-orchestrator.mdc").read_text(encoding="utf-8")
        self.assertTrue(rule.startswith("---\n"))
        self.assertIn("description:", rule)
        self.assertIn("alwaysApply: false", rule)
        self.assertIn("Creatio App Orchestrator", rule)
        self.assertIn("runbooks/02-requirements-gathering.md", rule)

    def test_marketplace_catalogs_point_to_plugin(self):
        claude = read_json(".claude-plugin/marketplace.json")
        codex = read_json(".agents/plugins/marketplace.json")
        copilot = read_json(".github/plugin/marketplace.json")
        canonical_version = read_json(".claude-plugin/plugin.json")["version"]
        cursor_version = read_json(".cursor-plugin/plugin.json")["version"]
        self.assertEqual(cursor_version, canonical_version)

        self.assertEqual(claude["plugins"][0]["name"], "creatio-ai-app-development-toolkit")
        self.assertEqual(claude["plugins"][0]["source"], "./")
        self.assertEqual(claude["plugins"][0]["version"], canonical_version)

        plugin = codex["plugins"][0]
        self.assertEqual(plugin["name"], "creatio-ai-app-development-toolkit")
        self.assertEqual(plugin["version"], canonical_version)
        self.assertEqual(plugin["source"]["path"], "./")

        self.assertEqual(copilot["plugins"][0]["name"], "creatio-ai-app-development-toolkit")
        self.assertEqual(copilot["plugins"][0]["source"], "./")
        self.assertEqual(copilot["plugins"][0]["version"], canonical_version)

    def test_main_skill_frontmatter_and_references_are_valid(self):
        skill = ROOT / "skills/creatio-app-orchestrator/SKILL.md"
        content = skill.read_text(encoding="utf-8")

        self.assertTrue(content.startswith("---\n"))
        self.assertIn("name: creatio-app-orchestrator", content)
        self.assertIn("description:", content)

        references = re.findall(r"`([^`]+)`", content)
        required_paths = [
            ref for ref in references
            if ref.startswith(("runbooks/", "context/", "runtime/scripts/"))
        ]
        self.assertGreater(required_paths, [])
        for relative_path in required_paths:
            self.assertTrue((ROOT / relative_path).exists(), relative_path)

    def test_no_mcp_registry_or_custom_mcp_package_in_v1(self):
        self.assertFalse((ROOT / "server.json").exists())
        self.assertFalse((ROOT / "packages/adac-mcp").exists())

    def test_docs_and_runbooks_do_not_reference_deleted_runtime_helper_paths(self):
        docs = [
            *Path(ROOT / "docs").glob("*.md"),
            *Path(ROOT / "runbooks").glob("*.md"),
            *Path(ROOT / "runtime" / "scripts").glob("find_python.*"),
            ROOT / "README.md",
        ]
        stale_paths = [
            r"(?<!runtime/)scripts/mcp_client\.py",
            r"(?<!runtime\\)scripts\\mcp_client\.py",
            r"(?<!runtime/)scripts/workflow_validators\.py",
            r"(?<!runtime\\)scripts\\workflow_validators\.py",
            r"(?<!runtime/)scripts/find_python\.ps1",
            r"(?<!runtime\\)scripts\\find_python\.ps1",
            r"(?<!runtime/)scripts/find_python\.sh",
            r"(?<!runtime\\)scripts\\find_python\.sh",
            r"sys\.path\.insert\(0, ['\"]scripts['\"]\)",
            r"from workflow_validators import",
        ]
        for path in docs:
            content = path.read_text(encoding="utf-8")
            for stale_path in stale_paths:
                self.assertIsNone(re.search(stale_path, content), f"{path}: {stale_path}")

    def test_install_docs_lead_with_no_flag_installer_command(self):
        install_doc = (ROOT / "docs/install.md").read_text(encoding="utf-8")

        self.assertIn("curl -fsSL <hosted-adac-install-url>/install.py | python3", install_doc)
        self.assertIn("python installer/install.py", install_doc)
        self.assertIn("Advanced users", install_doc)
        self.assertLess(
            install_doc.index("python installer/install.py"),
            install_doc.index("Advanced users"),
        )


if __name__ == "__main__":
    unittest.main()
