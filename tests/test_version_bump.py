import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class VersionBumpTests(unittest.TestCase):
    def test_version_bump_config_covers_release_version_fields(self):
        config = json.loads((ROOT / ".version-bump.json").read_text(encoding="utf-8"))
        configured = {(entry["path"], entry["field"]) for entry in config["files"]}

        self.assertEqual(
            configured,
            {
                ("plugin.json", "version"),
                (".codex-plugin/plugin.json", "version"),
                (".cursor-plugin/plugin.json", "version"),
                (".claude-plugin/plugin.json", "version"),
                (".agents/plugins/marketplace.json", "plugins.0.version"),
                (".claude-plugin/marketplace.json", "plugins.0.version"),
            },
        )

    def test_repo_versions_are_in_sync(self):
        result = subprocess.run(
            ["node", "scripts/bump-version.js", "--check"],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_check_detects_version_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_root = Path(temp)
            shutil.copytree(ROOT / "scripts", temp_root / "scripts")
            (temp_root / ".version-bump.json").write_text(
                json.dumps({
                    "files": [
                        {"path": "a.json", "field": "version"},
                        {"path": "nested.json", "field": "plugins.0.version"},
                    ]
                }),
                encoding="utf-8",
            )
            (temp_root / "a.json").write_text('{"version":"1.0.0"}\n', encoding="utf-8")
            (temp_root / "nested.json").write_text('{"plugins":[{"version":"1.0.1"}]}\n', encoding="utf-8")

            result = subprocess.run(
                ["node", "scripts/bump-version.js", "--check"],
                cwd=temp_root,
                text=True,
                capture_output=True,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Version drift", result.stderr + result.stdout)

    def test_bump_updates_nested_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_root = Path(temp)
            shutil.copytree(ROOT / "scripts", temp_root / "scripts")
            (temp_root / ".version-bump.json").write_text(
                json.dumps({
                    "files": [
                        {"path": "a.json", "field": "version"},
                        {"path": "nested.json", "field": "plugins.0.version"},
                    ]
                }),
                encoding="utf-8",
            )
            (temp_root / "a.json").write_text('{"version":"1.0.0"}\n', encoding="utf-8")
            (temp_root / "nested.json").write_text('{"plugins":[{"version":"1.0.0"}]}\n', encoding="utf-8")

            result = subprocess.run(
                ["node", "scripts/bump-version.js", "2.3.4"],
                cwd=temp_root,
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

            a = json.loads((temp_root / "a.json").read_text(encoding="utf-8"))
            nested = json.loads((temp_root / "nested.json").read_text(encoding="utf-8"))

        self.assertEqual(a["version"], "2.3.4")
        self.assertEqual(nested["plugins"][0]["version"], "2.3.4")


if __name__ == "__main__":
    unittest.main()
