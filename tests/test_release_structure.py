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
        self.assertEqual(claude["plugins"][0]["version"], canonical_version)
        # Claude and Copilot marketplaces pin the plugin payload to the moving
        # `release` branch so installs always fetch the latest published release
        # rather than whatever sits on main. The release workflow force-updates
        # `release` to the released SHA after `gh release create`. See
        # docs/install.md → "Release-pinned plugin source".
        self.assertEqual(
            claude["plugins"][0]["source"],
            {
                "source": "url",
                "url": "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                "ref": "release",
            },
        )

        plugin = codex["plugins"][0]
        self.assertEqual(plugin["name"], "creatio-ai-app-development-toolkit")
        self.assertEqual(plugin["version"], canonical_version)
        # Codex marketplace pins the plugin payload to the moving `release`
        # branch via `source.url + ref`, matching Claude/Copilot exactly. The
        # plugin payload is fetched separately at the `release` SHA into
        # Codex CLI's plugin cache; the marketplace clone itself tracks `main`
        # (where this marketplace.json lives).
        self.assertEqual(
            plugin["source"],
            {
                "source": "url",
                "url": "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                "ref": "release",
            },
        )

        self.assertEqual(copilot["plugins"][0]["name"], "creatio-ai-app-development-toolkit")
        self.assertEqual(copilot["plugins"][0]["version"], canonical_version)
        self.assertEqual(
            copilot["plugins"][0]["source"],
            {
                "source": "url",
                "url": "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                "ref": "release",
            },
        )

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
        self.assertFalse((ROOT / "packages/caadt-mcp").exists())

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

    def test_install_docs_lead_with_local_install_command(self):
        install_doc = (ROOT / "docs/install.md").read_text(encoding="utf-8")

        self.assertIn("python installer/install.py", install_doc)
        self.assertIn("Advanced users", install_doc)
        self.assertLess(
            install_doc.index("python installer/install.py"),
            install_doc.index("Advanced users"),
        )

    def test_release_workflow_uses_canonical_manifest_and_safe_input_variable(self):
        workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")

        self.assertIn("RELEASE_VERSION: ${{ inputs.version }}", workflow)
        direct_input_lines = [
            line
            for line in workflow.splitlines()
            if "${{ inputs.version }}" in line
            and "RELEASE_VERSION:" not in line
            and "description:" not in line
        ]
        self.assertEqual(direct_input_lines, [])
        self.assertIn("PJ_VERSION=$(jq -r .version .claude-plugin/plugin.json)", workflow)
        self.assertNotIn("jq -r .version plugin.json", workflow)
        self.assertEqual(re.findall(r"- name: Gate (\d+) ", workflow), ["1", "2", "3", "4", "5", "6"])
        # Gate 6 protects against pointing `release` at a SHA whose plugin.json
        # version equals the current release branch's plugin.json version —
        # client cache is keyed by plugin.json:version, so a same-version
        # re-point would be invisible to installed plugins.
        self.assertIn("Gate 6 — new version differs from current `release` branch version", workflow)
        # Release branch must be force-pushed AFTER `gh release create` succeeds
        # so a failed asset upload doesn't strand the pointer ahead of a
        # missing release.
        # Explicit --force-with-lease=<ref>:<expect> is required — bare
        # --force-with-lease degrades to plain --force when pushing a raw
        # SHA:refspec without a tracked local branch.
        self.assertIn(
            'git push origin "$GITHUB_SHA:refs/heads/release" --force-with-lease="refs/heads/release:${EXPECTED}"',
            workflow,
        )
        self.assertIn("Verify `release` branch now points to released SHA", workflow)
        self.assertNotIn('node scripts/bump-version.js "$RELEASE_VERSION"', workflow)
        self.assertNotIn("git commit", workflow)
        self.assertNotIn("git push origin main", workflow)
        self.assertIn('git push origin "refs/tags/$RELEASE_VERSION"', workflow)

    def test_release_notes_do_not_reference_removed_copilot_manifest_path(self):
        release_notes = (ROOT / "RELEASE-NOTES.md").read_text(encoding="utf-8")

        self.assertNotIn(".copilot-plugin/plugin.json", release_notes)
        self.assertIn(".github/plugin/plugin.json", release_notes)

    def test_release_manifest_has_required_sections(self):
        manifest = read_json(".release-manifest.json")
        self.assertIn("plugin_runtime", manifest)
        self.assertIn("release_extras", manifest)
        self.assertIsInstance(manifest["plugin_runtime"], list)
        self.assertIsInstance(manifest["release_extras"], list)
        self.assertGreater(len(manifest["plugin_runtime"]), 0)
        self.assertGreater(len(manifest["release_extras"]), 0)

    def test_release_manifest_paths_exist(self):
        manifest = read_json(".release-manifest.json")
        for relative_path in [*manifest["plugin_runtime"], *manifest["release_extras"]]:
            self.assertTrue(
                (ROOT / relative_path).exists(),
                f"{relative_path} listed in .release-manifest.json but does not exist",
            )

    def test_release_manifest_no_duplicates(self):
        manifest = read_json(".release-manifest.json")
        combined = [*manifest["plugin_runtime"], *manifest["release_extras"]]
        self.assertEqual(len(combined), len(set(combined)),
                         "Duplicate path between plugin_runtime and release_extras")
        self.assertEqual(len(manifest["plugin_runtime"]), len(set(manifest["plugin_runtime"])))
        self.assertEqual(len(manifest["release_extras"]), len(set(manifest["release_extras"])))

    def test_plugin_runtime_excludes_dev_artifacts(self):
        manifest = read_json(".release-manifest.json")
        forbidden_prefixes = (
            "tests",
            "docs",
            "tmp",
            "installer",
            ".github/workflows",
            ".pytest_cache",
            ".git",
            "node_modules",
        )
        for relative_path in manifest["plugin_runtime"]:
            for prefix in forbidden_prefixes:
                self.assertFalse(
                    relative_path == prefix or relative_path.startswith(prefix + "/"),
                    f"plugin_runtime must not include dev artifact: {relative_path}",
                )

    def test_release_manifest_covers_installer_and_excludes_release_notes(self):
        manifest = read_json(".release-manifest.json")
        self.assertIn("installer", manifest["release_extras"])
        self.assertNotIn("RELEASE-NOTES.md", manifest["release_extras"])

    def test_release_workflow_builds_and_uploads_curated_asset(self):
        workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        self.assertIn(".release-manifest.json", workflow)
        self.assertIn("creatio-ai-app-development-toolkit-${RELEASE_VERSION}.zip", workflow)
        # Asset is attached via `gh release create` (draft → upload → publish in
        # one call) so a transient upload failure leaves a draft instead of a
        # published release whose asset 404s. A separate `gh release upload`
        # step must NOT exist — it would re-introduce the partial-state window.
        self.assertNotIn("gh release upload", workflow)
        self.assertRegex(
            workflow,
            r'gh release create "\$RELEASE_VERSION"[^\n]*(?:\n[ \t]+[^\n]+)*\n[ \t]+"/tmp/creatio-ai-app-development-toolkit-\$\{RELEASE_VERSION\}\.zip"',
        )

    def test_gh_steps_set_gh_host_for_ghe(self):
        """Regression: gh CLI on GHE refuses commands when it cannot identify
        the API host. `GH_TOKEN` alone is not enough — gh only auto-detects
        github.com from git remotes; custom hostnames (creatio.ghe.com) require
        GH_HOST to be set explicitly. Derive it from GITHUB_SERVER_URL so the
        workflow remains host-agnostic."""
        workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        release_step = re.search(
            r"- name: Create GitHub Release with asset\n"
            r"(?P<body>(?:[ \t]+.*\n)+?)(?=\n[ \t]{6}- name:|\Z)",
            workflow,
        )
        self.assertIsNotNone(release_step, "release workflow must create the GitHub Release")
        step_body = release_step.group("body")
        self.assertIn('gh release create "$RELEASE_VERSION"', step_body)
        self.assertIn('export GH_HOST="${GITHUB_SERVER_URL#http://}"', step_body)
        self.assertIn('export GH_HOST="${GH_HOST#https://}"', step_body)
        self.assertIn('export GH_HOST="${GH_HOST%/}"', step_body)


if __name__ == "__main__":
    unittest.main()
