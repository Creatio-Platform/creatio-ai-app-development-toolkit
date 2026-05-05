import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
INSTALLER_PATH = ROOT / "installer/install.py"


def load_installer():
    spec = importlib.util.spec_from_file_location("adac_installer", INSTALLER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_required_references(installer, repo_root):
    for relative_path in installer.REQUIRED_REFERENCE_PATHS:
        path = repo_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("reference\n", encoding="utf-8")


class InstallerTests(unittest.TestCase):
    def test_detect_targets_uses_mocked_home_directories(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / ".codex").mkdir()
            (home / ".claude").mkdir()
            (home / ".cursor").mkdir()

            with patch("shutil.which", return_value=None):
                targets = installer.detect_targets(home)

        self.assertEqual({target["id"] for target in targets}, {"codex", "claude", "cursor"})

    def test_detect_targets_does_not_autodetect_unsupported_copilot_install(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            with patch("shutil.which", return_value="/usr/bin/gh"):
                targets = installer.detect_targets(Path(temp))

        self.assertNotIn("copilot", {target["id"] for target in targets})

    def test_copilot_install_reports_not_supported_in_v1(self):
        installer = load_installer()
        with self.assertRaisesRegex(RuntimeError, "not supported by this v1 installer"):
            installer.install_copilot(Path("repo"))

    def test_install_cursor_merges_mcp_config_and_writes_rule(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            (repo_root / ".cursor-plugin").mkdir()
            (repo_root / ".cursor-plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0"}\n',
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )

            home = Path(temp) / "home"
            cursor_home = home / ".cursor"
            cursor_home.mkdir(parents=True)
            (cursor_home / "mcp.json").write_text(
                '{"mcpServers":{"other":{"command":"other","args":[]}}}\n',
                encoding="utf-8",
            )

            installer.install_cursor(repo_root, home)

            merged = json.loads((cursor_home / "mcp.json").read_text(encoding="utf-8"))
            self.assertIn("clio", merged["mcpServers"])
            self.assertIn("other", merged["mcpServers"])
            self.assertEqual(merged["mcpServers"]["clio"]["args"], ["mcp-server"])

            rule_path = cursor_home / "rules" / "creatio-app-orchestrator.mdc"
            self.assertTrue(rule_path.exists())
            rule_body = rule_path.read_text(encoding="utf-8")
            self.assertIn("description:", rule_body)
            self.assertIn("Creatio App Orchestrator", rule_body)
            self.assertIn(str(repo_root), rule_body)

            local_plugin_manifest = (
                cursor_home
                / "plugins"
                / "local"
                / "creatio-ai-app-development-toolkit"
                / ".cursor-plugin"
                / "plugin.json"
            )
            self.assertTrue(local_plugin_manifest.exists())

    def test_preflight_clio_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "clio was not found in PATH"):
                installer.preflight_clio()

    def test_copy_mcp_config_preserves_clio_server(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            (root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            target = Path(temp) / "target" / ".mcp.json"

            installer.copy_mcp_config(root, target)
            copied = json.loads(target.read_text(encoding="utf-8"))

        self.assertEqual(copied["mcpServers"]["clio"]["args"], ["mcp-server"])

    def test_install_codex_copies_skills_and_mcp_without_marketplace_registration(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            write_required_references(installer, repo_root)
            home = Path(temp) / "home"

            installer.install_codex(repo_root, home)

            installed_skill = (
                home
                / ".codex"
                / "skills"
                / "creatio-app-orchestrator"
                / "SKILL.md"
            )
            self.assertTrue(
                installed_skill.exists()
            )
            installed_skill_body = installed_skill.read_text(encoding="utf-8")
            self.assertIn(str(repo_root / "AGENTS.md"), installed_skill_body)
            self.assertIn(str(repo_root / "runbooks" / "02-requirements-gathering.md"), installed_skill_body)
            self.assertIn(str(repo_root / "runtime" / "scripts" / "workflow_validators.py"), installed_skill_body)
            self.assertTrue((home / ".codex" / "adac.mcp.json").exists())
            self.assertFalse((home / ".agents" / "plugins" / "marketplace.json").exists())

    def test_install_codex_rejects_checkout_without_required_references(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "missing required reference files"):
                installer.install_codex(repo_root, Path(temp) / "home")

    def test_clone_command_includes_optional_ref_checkout(self):
        installer = load_installer()
        commands = []

        def fake_run(command, **_kwargs):
            commands.append(command)

        with tempfile.TemporaryDirectory() as temp, patch.object(installer, "run_checked", side_effect=fake_run):
            installer.clone_or_update_repo(
                "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                Path(temp) / "repo",
                ref="v0.1.0",
            )

        self.assertEqual(commands[0][:2], ["git", "clone"])
        self.assertEqual(commands[-1], ["git", "checkout", "v0.1.0"])

    def test_resolve_repo_root_prefers_current_checkout_without_ref(self):
        installer = load_installer()

        with patch.object(installer, "current_checkout_root", return_value=ROOT), patch.object(
            installer,
            "clone_or_update_repo",
            side_effect=AssertionError("clone should not run for local checkout installs"),
        ):
            resolved = installer.resolve_repo_root(
                "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                None,
                None,
            )

        self.assertEqual(resolved, ROOT)

    def test_resolve_repo_root_uses_default_checkout_when_ref_is_requested(self):
        installer = load_installer()
        with patch.object(installer, "current_checkout_root", return_value=ROOT), patch.object(
            installer,
            "clone_or_update_repo",
            return_value=Path("resolved"),
        ) as clone:
            resolved = installer.resolve_repo_root(
                "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                None,
                "v0.1.0",
            )

        self.assertEqual(resolved, Path("resolved"))
        clone.assert_called_once_with(
            "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
            installer.DEFAULT_INSTALL_ROOT,
            "v0.1.0",
        )


if __name__ == "__main__":
    unittest.main()
