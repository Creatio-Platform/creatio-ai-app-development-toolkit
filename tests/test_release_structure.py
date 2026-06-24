import json
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_json(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


def _git_tracked_skill_md():
    """SKILL.md paths git tracks under skills/, or None if git is unavailable.

    Used to scope the structural tests to SHIPPED skills only — an untracked
    work-in-progress skill directory in the working tree is not part of any
    release and must not turn the suite red.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", "skills"],
            capture_output=True, text=True, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return {line for line in out.splitlines() if line.endswith("/SKILL.md")}


def skill_dirs():
    """Every shipped (git-tracked) skill directory (each holds a SKILL.md).

    Falls back to all on-disk skills when git is unavailable (e.g. a released
    tarball), which contains no untracked WIP dirs anyway.
    """
    dirs = sorted(p.parent for p in (ROOT / "skills").glob("*/SKILL.md"))
    tracked = _git_tracked_skill_md()
    if tracked is None:
        return dirs
    return [d for d in dirs if f"skills/{d.name}/SKILL.md" in tracked]


def parse_fenced_flat_mapping(text):
    """Parse a ``---``-fenced flat ``key: "value"`` mapping without PyYAML.

    The skill openai.yaml manifests are a fixed, self-authored shape — a few flat
    string keys between ``---`` fences — so a small line parser is enough and
    keeps the test suite dependency-free (CI installs only pytest). Only
    TOP-LEVEL (non-indented) keys are collected, so a divergent nested shape
    (e.g. keys under an ``interface:`` wrapper) is NOT silently flattened — it
    surfaces as a missing required key.
    """
    lines = text.splitlines()
    if lines and lines[0].strip() == "---":
        lines = lines[1:]
    mapping = {}
    for line in lines:
        if line.strip() == "---":
            break
        if not line or line[0].isspace() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        mapping[key.strip()] = value.strip().strip('"').strip("'").strip()
    return mapping


def looks_like_path(token):
    """True if a backtick token looks like a file path: a directory separator
    plus a final ``name.ext`` segment with an alphanumeric extension.

    Plain string logic (no regex) so it cannot trip a ReDoS hotspot (Sonar
    python:S5852); equivalent to the former ``.+/.+\\.[A-Za-z0-9]+$`` pattern.
    """
    head, sep, tail = token.rpartition("/")
    if not sep or not head:
        return False
    name, dot, ext = tail.rpartition(".")
    return bool(name) and bool(dot) and ext.isalnum()


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
        rule_path = ROOT / "rules/creatio-app-orchestrator.mdc"
        rule = rule_path.read_text(encoding="utf-8")
        self.assertTrue(rule.startswith("---\n"))
        self.assertIn("description:", rule)
        self.assertIn("alwaysApply: false", rule)
        self.assertIn("Creatio App Orchestrator", rule)
        self.assertIn("runbooks/02-requirements-gathering.md", rule)
        # The rule sits one level below the toolkit root, so every referenced
        # path must be anchored with `../` and resolve to a real file when
        # joined to the rule's own directory (how a host resolves it at
        # runtime), not when joined to the repo root.
        self._assert_anchored_paths_resolve(rule_path, "../")

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
                "url": "https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git",
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
                "url": "https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git",
                "ref": "release",
            },
        )

        self.assertEqual(copilot["plugins"][0]["name"], "creatio-ai-app-development-toolkit")
        self.assertEqual(copilot["plugins"][0]["version"], canonical_version)
        self.assertEqual(
            copilot["plugins"][0]["source"],
            {
                "source": "url",
                "url": "https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git",
                "ref": "release",
            },
        )

    def _assert_anchored_paths_resolve(self, entry_path, anchor_prefix):
        """Every backticked path reference in an entry file must be anchored
        with ``anchor_prefix`` and resolve to a real file when joined to the
        entry file's own directory.

        Resolving against ``entry_path.parent`` (not ``ROOT``) mirrors how a
        coding agent resolves the path at runtime: the skill/rule loads from
        its installed directory, which is below the toolkit root that holds
        ``AGENTS.md``. Resolving against ``ROOT`` would let a broken bare path
        ship green — the files exist at ROOT, but never at the skill-relative
        location the agent actually reads.
        """
        content = entry_path.read_text(encoding="utf-8")
        references = re.findall(r"`([^`]+)`", content)
        # Decide which backtick tokens are *read-paths* that must be anchored:
        #   - any token with a directory component (e.g. context/INDEX.md),
        #     excluding bare directory mentions like `skills/` / `rules/`;
        #   - the toolkit-root files that are read by bare name (AGENTS.md,
        #     .mcp.json) — a bare `AGENTS.md` is the defect this guards against.
        # This deliberately ignores *referential* bare filenames such as
        # `mcp_client.py` (already anchored where it is actually read, in the
        # Load Order) and non-path tokens like `get-tool-contract`.
        root_read_files = {"AGENTS.md", ".mcp.json"}

        def is_read_path(ref):
            if ref.endswith("/"):
                return False
            if ref in root_read_files:
                return True
            return "/" in ref

        path_refs = [ref for ref in references if is_read_path(ref)]
        self.assertGreater(
            len(path_refs), 0, f"{entry_path.name}: no toolkit file references found"
        )
        for ref in path_refs:
            # Every toolkit file reference must be anchored to the toolkit root.
            # A BARE path (e.g. `AGENTS.md`) resolves against the skill's own
            # directory at runtime, where the file does not exist. Reject it
            # here even though it would "resolve" against the repo root.
            self.assertTrue(
                ref.startswith(anchor_prefix),
                f"{entry_path.name}: `{ref}` is not anchored with `{anchor_prefix}` "
                f"(bare paths resolve to the wrong directory at runtime)",
            )
            resolved = (entry_path.parent / ref).resolve()
            self.assertTrue(resolved.exists(), f"{entry_path.name}: `{ref}` -> {resolved}")

    def test_main_skill_frontmatter_and_references_are_valid(self):
        skill = ROOT / "skills/creatio-app-orchestrator/SKILL.md"
        content = skill.read_text(encoding="utf-8")

        self.assertTrue(content.startswith("---\n"))
        self.assertIn("name: creatio-app-orchestrator", content)
        self.assertIn("description:", content)

        # The skill sits two levels below the toolkit root, so paths anchor
        # with `../../` and must resolve from the skill's own directory.
        self._assert_anchored_paths_resolve(skill, "../../")

    def test_orchestrator_entry_files_carry_root_anchor_and_fail_loud(self):
        """Both entry files must tell the agent where the toolkit root is and
        stop loudly (rather than silently planning from memory) when the
        contract files are unreachable, instead of degrading to a free-form
        plan when the skill loads from outside the repo.
        """
        entry_files = [
            ROOT / "skills/creatio-app-orchestrator/SKILL.md",
            ROOT / "rules/creatio-app-orchestrator.mdc",
        ]
        # Match on the load-bearing concepts (root anchor + a fail-loud
        # directive that forbids fabricating a plan), not an exact sentence, so
        # benign rewording does not break the guard.
        for entry in entry_files:
            content = entry.read_text(encoding="utf-8")
            self.assertIn("toolkit root", content, entry.name)
            self.assertIn("STOP", content, entry.name)
            self.assertIn("from memory", content, entry.name)

    def test_every_skill_frontmatter_is_valid(self):
        """All shipped skills — not just the orchestrator — must start with a
        YAML front-matter block whose `name:` matches the directory and that
        carries a non-empty `description:`. The orchestrator handoff now makes
        creatio-ui-guidelines load-bearing, so a malformed block in any skill
        breaks discovery with no other signal.
        """
        dirs = skill_dirs()
        self.assertGreaterEqual(len(dirs), 3, "expected at least the three shipped skills")
        for skill_dir in dirs:
            skill = skill_dir / "SKILL.md"
            content = skill.read_text(encoding="utf-8")
            self.assertTrue(content.startswith("---\n"), f"{skill_dir.name}: missing front-matter")
            self.assertIn(f"name: {skill_dir.name}", content, skill_dir.name)
            description = re.search(r"^description:\s*(\S.*)$", content, re.MULTILINE)
            self.assertIsNotNone(description, f"{skill_dir.name}: missing description:")
            self.assertTrue(description.group(1).strip(), f"{skill_dir.name}: empty description:")

    # Skills the orchestrator MUST hand off to mid-workflow. These are the
    # orchestrator-driven skills only — standalone skills the user invokes
    # directly (e.g. a migration skill) are deliberately NOT listed and are not
    # expected to be wired into the orchestrator.
    ORCHESTRATOR_HANDOFF_SKILLS = ("creatio-ui-guidelines", "creatio-schema-naming")

    def test_orchestrator_wires_its_handoff_skills(self):
        """Each orchestrator-driven skill must exist and be referenced by name in
        the orchestrator SKILL.md. There is no generic skill registry, so the
        handoff is hand-written prose — this test is what enforces that a
        load-bearing handoff skill was actually wired (and keeps being wired).

        This intentionally does NOT require every shipped skill to be wired:
        standalone skills are invoked directly and have no orchestrator handoff.
        """
        orchestrator = (ROOT / "skills/creatio-app-orchestrator/SKILL.md").read_text(encoding="utf-8")
        for name in self.ORCHESTRATOR_HANDOFF_SKILLS:
            self.assertTrue(
                (ROOT / "skills" / name / "SKILL.md").exists(),
                f"{name}/SKILL.md is required by the orchestrator handoff",
            )
            self.assertIn(
                name, orchestrator,
                f"orchestrator SKILL.md must hand off to `{name}` by name "
                f"(no generic skill registry enforces this otherwise)",
            )

    def test_every_skill_openai_manifest_has_consistent_shape(self):
        """Every skills/*/agents/openai.yaml must be a single flat YAML document
        with the same keys the launcher reads (display_name, short_description,
        default_prompt) — and must NOT nest them under an `interface:` wrapper.
        A divergent shape makes the skill present/launch inconsistently with its
        siblings.
        """
        for skill_dir in skill_dirs():
            manifest_path = skill_dir / "agents" / "openai.yaml"
            self.assertTrue(manifest_path.exists(), f"{skill_dir.name}: missing agents/openai.yaml")
            # The manifest is a `---`-fenced flat mapping; parse top-level keys
            # only so a nested `interface:` shape surfaces as missing keys rather
            # than being silently flattened.
            data = parse_fenced_flat_mapping(manifest_path.read_text(encoding="utf-8"))
            self.assertNotIn(
                "interface", data,
                f"{skill_dir.name}: openai.yaml must not nest keys under `interface:`",
            )
            for key in ("display_name", "short_description", "default_prompt"):
                self.assertIn(key, data, f"{skill_dir.name}: openai.yaml missing `{key}`")
                self.assertTrue(data[key].strip(), f"{skill_dir.name}: `{key}` is empty")

    def test_skill_relative_references_are_anchored_and_resolve(self):
        """Every link inside a skill's SKILL.md that points to a file the skill
        ships (any folder, not just `references/`) must use an explicit `./`
        anchor and resolve against the skill's own directory at runtime.

        Links that go UP to the toolkit root (`../…`, e.g. the orchestrator's
        `../../context/…`) are a different contract verified by
        ``_assert_anchored_paths_resolve`` and are skipped here. Detection keys
        on the path shape (a slash + a file extension), NOT on a folder name, so
        a future `./guides/x.md` or `./helpers/x.md` is covered too and a bare
        `guides/x.md` is rejected.
        """
        for skill_dir in skill_dirs():
            content = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
            # A backtick token that looks like a path to a file (dir separator +
            # name.ext); plain string check, no regex (see looks_like_path).
            refs = [r for r in re.findall(r"`([^`]+)`", content) if looks_like_path(r)]
            for ref in refs:
                if ref.startswith("../"):
                    # toolkit-root link — covered by _assert_anchored_paths_resolve
                    continue
                self.assertTrue(
                    ref.startswith("./"),
                    f"{skill_dir.name}: `{ref}` must be anchored with `./` "
                    f"(explicit skill-relative path) or `../` (toolkit-root path)",
                )
                resolved = (skill_dir / ref).resolve()
                self.assertTrue(resolved.exists(), f"{skill_dir.name}: `{ref}` -> {resolved}")

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

    def test_gh_steps_set_gh_host_for_custom_hosts(self):
        """Regression: gh CLI on non-github.com hosts refuses commands when it
        cannot identify the API host. `GH_TOKEN` alone is not enough — gh only
        auto-detects github.com from git remotes; custom hostnames require
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
