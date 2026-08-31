"""Unit coverage for the cross-platform build-dev-toolchain driver (scripts/build_dev_toolchain.py).

The driver runs every external command via subprocess with a LIST of args (never a shell string), so the
command-injection class a batch/shell port must defend against does not exist here. What remains worth
pinning is the allow-list validation (defence in depth + rejecting bad git refs early) and the pure logic
of the appsettings rewrite / marketplace generation / config parsing. These import the driver and test its
functions directly with the SAME regex engine the driver runs at runtime, so there is no Python-re-vs-other
divergence to worry about.
"""

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DRIVER_PATH = ROOT / "scripts" / "build_dev_toolchain.py"

_spec = importlib.util.spec_from_file_location("build_dev_toolchain", DRIVER_PATH)
bdt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bdt)

# Payloads that MUST be rejected by every allow-list: quote/backtick/$ breakout, cmd/shell operators
# (& | < >), command substitution / statement separators, and a leading hyphen (git argument injection).
MALICIOUS = [
    "a'; Start-Process calc; '",
    "a`ncalc",
    "a$(whoami)",
    "a;calc",
    "a&calc",
    "a|b",
    "a>b",
    "a<b",
    'a"b',
    "`whoami`",
    "-upload-pack",
    "--upload-pack=/tmp/x",
    "-x",
    "",  # empty is never valid
]

VALID = {
    "KN_URL": [
        "https://github.com/Advance-Technologies-Foundation/clio-knowledge.git",
        "git@github.com:org/repo.git",
    ],
    "KN_REL_OWNER": ["Advance-Technologies-Foundation"],
    "KN_REL_REPO": ["clio-knowledge"],
    "KN_REL_ASSET": ["clio-knowledge-bundle.zip"],
    "KN_REL_API": ["https://api.github.com/"],
    "KN_BRANCH": ["master", "feature/eng-93152_fab-1.2", "1.13.20", "release-2.0"],
}


class AllowListTests(unittest.TestCase):
    def test_all_untrusted_vars_have_an_allowlist(self):
        for name in ("KN_URL", "KN_REL_OWNER", "KN_REL_REPO", "KN_REL_ASSET", "KN_REL_API", "KN_BRANCH"):
            self.assertIn(name, bdt.ALLOWLISTS, f"{name} must have an allow-list")

    def test_every_allowlist_rejects_malicious(self):
        for name in bdt.ALLOWLISTS:
            for payload in MALICIOUS:
                self.assertFalse(bdt.token_ok(name, payload), f"{name} must reject {payload!r}")

    def test_every_allowlist_accepts_valid(self):
        for name, values in VALID.items():
            for good in values:
                self.assertTrue(bdt.token_ok(name, good), f"{name} must accept {good!r}")

    def test_leading_hyphen_always_rejected(self):
        for name in bdt.ALLOWLISTS:
            for lead in ("-x", "--upload-pack", "-"):
                self.assertFalse(bdt.token_ok(name, lead), f"{name} must reject {lead!r}")

    def test_pick_index_classifier(self):
        for good in ("1", "2", "17"):
            self.assertTrue(bdt.is_index(good), good)
        for bad in MALICIOUS + ["1a", "-1", "0", "name"]:
            self.assertFalse(bdt.is_index(bad), f"index classifier must reject {bad!r}")


class AppsettingsRewriteTests(unittest.TestCase):
    def _seed(self, source):
        return {"knowledge": {"sources": {"creatio-curated": dict(source)}},
                "features": {"knowledge-allow-unsequenced": True}}

    def _rewrite(self, data, mode, ref=""):
        return bdt.rewrite_appsettings(
            data, mode, git_url="https://github.com/x/clio-knowledge.git", ref=ref,
            rel_owner="Advance-Technologies-Foundation", rel_repo="clio-knowledge",
            rel_asset="clio-knowledge-bundle.zip", rel_api="https://api.github.com/")

    def test_release_sets_github_release_and_resets_flag(self):
        data = self._seed({"type": "git", "location": "u", "branch": "dev"})
        data, changed = self._rewrite(data, "release")
        self.assertTrue(changed)
        src = data["knowledge"]["sources"]["creatio-curated"]
        self.assertEqual(src["type"], "github-release")
        self.assertEqual(src["repository-owner"], "Advance-Technologies-Foundation")
        self.assertEqual(src["asset-name"], "clio-knowledge-bundle.zip")
        self.assertNotIn("branch", src, "release must clear the git branch field")
        self.assertFalse(data["features"]["knowledge-allow-unsequenced"], "release must reset the flag")

    def test_branch_sets_git_and_flag_true(self):
        data = self._seed({"type": "github-release", "location": "api", "asset-name": "x"})
        data.pop("features")  # start with no features node
        data, changed = self._rewrite(data, "branch", ref="feature/eng-1")
        self.assertTrue(changed)
        src = data["knowledge"]["sources"]["creatio-curated"]
        self.assertEqual(src["type"], "git")
        self.assertEqual(src["branch"], "feature/eng-1")
        self.assertNotIn("asset-name", src, "branch must clear the release asset field")
        self.assertTrue(data["features"]["knowledge-allow-unsequenced"], "branch must set the flag true")

    def test_branch_ref_that_looks_like_version_is_a_tag(self):
        data = self._seed({"type": "git"})
        data, _ = self._rewrite(data, "branch", ref="1.13.20")
        src = data["knowledge"]["sources"]["creatio-curated"]
        self.assertEqual(src.get("tag"), "1.13.20")
        self.assertNotIn("branch", src)

    def test_missing_source_reports_unchanged(self):
        data = {"knowledge": {"sources": {}}, "features": {}}
        data, changed = self._rewrite(data, "release")
        self.assertFalse(changed)

    def test_release_does_not_create_features_just_to_reset(self):
        data = {"knowledge": {"sources": {"creatio-curated": {"type": "git"}}}}
        data, _ = self._rewrite(data, "release")
        self.assertNotIn("features", data, "release must not fabricate a features node when none exists")


class OtherLogicTests(unittest.TestCase):
    def test_build_marketplace_shape(self):
        mp = bdt.build_marketplace("creatio", "creatio-ai-app-development-toolkit", "myrepo")
        self.assertEqual(mp["name"], "creatio")
        plugin = mp["plugins"][0]
        self.assertEqual(plugin["name"], "creatio-ai-app-development-toolkit")
        self.assertEqual(plugin["source"], "./myrepo", "plugin source must descend into the link leaf")

    def test_load_config_parses_and_ignores_comments(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c"
            p.write_text("# comment\n\nCLIO_SRC=C:\\a=b\n  KEY = val \nCONFIG=Debug\n", encoding="utf-8")
            cfg = bdt.load_config(p)
        self.assertEqual(cfg["CLIO_SRC"], "C:\\a=b", "value keeps everything after the first '='")
        self.assertEqual(cfg["KEY"], "val", "key/value are trimmed")
        self.assertEqual(cfg["CONFIG"], "Debug")
        self.assertNotIn("# comment", cfg)

    def test_apply_defaults_fills_optional_keys(self):
        cfg = bdt.apply_defaults({"CLIO_SRC": "x"})
        self.assertEqual(cfg["MARKETPLACE_NAME"], "creatio")
        self.assertEqual(cfg["KN_REL_OWNER"], "Advance-Technologies-Foundation")
        self.assertTrue(cfg["KN_URL"].endswith("clio-knowledge.git"))

    def test_clio_home_respects_override(self):
        import os
        old = os.environ.get("CLIO_HOME")
        os.environ["CLIO_HOME"] = os.path.join("tmp", "clh")
        try:
            self.assertEqual(bdt.clio_home(), Path(os.path.join("tmp", "clh")))
        finally:
            if old is None:
                os.environ.pop("CLIO_HOME", None)
            else:
                os.environ["CLIO_HOME"] = old


class LauncherTests(unittest.TestCase):
    def test_launchers_exist_and_delegate_to_driver(self):
        bat = (ROOT / "scripts" / "build-dev-toolchain.bat").read_text(encoding="utf-8")
        sh = (ROOT / "scripts" / "build-dev-toolchain.sh").read_text(encoding="utf-8")
        self.assertIn("build_dev_toolchain.py", bat, "the .bat launcher must delegate to the Python driver")
        self.assertIn("build_dev_toolchain.py", sh, "the .sh launcher must delegate to the Python driver")
        self.assertTrue(sh.startswith("#!"), "the .sh launcher must have a shebang")

    def test_driver_never_uses_a_shell(self):
        # subprocess with shell=True would reopen the injection class the list-args design closes.
        driver = DRIVER_PATH.read_text(encoding="utf-8")
        self.assertNotIn("shell=True", driver)

    def test_git_ls_remote_uses_end_of_options_marker(self):
        driver = DRIVER_PATH.read_text(encoding="utf-8")
        self.assertIn('"ls-remote", "--heads", "--"', driver,
                      "git ls-remote must pass the URL after a `--` end-of-options marker")


if __name__ == "__main__":
    unittest.main()
