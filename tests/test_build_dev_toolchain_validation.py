"""Unit coverage for the cross-platform build-dev-toolchain driver (scripts/build_dev_toolchain.py).

The driver runs every external command via subprocess with a LIST of args (never a shell string, and never
`cmd /c` / `sh -c`), so the command-injection class a batch/shell port must defend against does not exist
here. These tests import the driver and exercise its real functions -- allow-lists, config resolution,
platform helpers, the appsettings rewrite, and the no-shell/arg-forwarding guarantees -- with the same
regex engine the driver runs at runtime.
"""

import importlib.util
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
DRIVER_PATH = ROOT / "scripts" / "build_dev_toolchain.py"

_spec = importlib.util.spec_from_file_location("build_dev_toolchain", DRIVER_PATH)
bdt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bdt)

MALICIOUS = [
    "a'; Start-Process calc; '", "a`ncalc", "a$(whoami)", "a;calc", "a&calc", "a|b", "a>b", "a<b",
    'a"b', "`whoami`", "-upload-pack", "--upload-pack=/tmp/x", "-x", "",
]
VALID = {
    "KN_URL": ["https://github.com/Advance-Technologies-Foundation/clio-knowledge.git", "git@github.com:o/r.git"],
    "KN_REL_OWNER": ["Advance-Technologies-Foundation"],
    "KN_REL_REPO": ["clio-knowledge"],
    "KN_REL_ASSET": ["clio-knowledge-bundle.zip"],
    "KN_REL_API": ["https://api.github.com/"],
    "KN_BRANCH": ["master", "feature/eng-93152_fab-1.2", "1.13.20", "release-2.0"],
    "CONFIG": ["Release", "Debug"],
    "MARKETPLACE_NAME": ["creatio"],
}


class AllowListTests(unittest.TestCase):
    def test_all_untrusted_vars_have_an_allowlist(self):
        for name in ("KN_URL", "KN_REL_OWNER", "KN_REL_REPO", "KN_REL_ASSET", "KN_REL_API", "KN_BRANCH",
                     "CONFIG", "MARKETPLACE_NAME"):
            self.assertIn(name, bdt.ALLOWLISTS)

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
            for lead in ("-x", "--upload-pack", "-", ".."):
                self.assertFalse(bdt.token_ok(name, lead), f"{name} must reject {lead!r}")

    def test_pick_index_classifier(self):
        for good in ("1", "2", "17"):
            self.assertTrue(bdt.is_index(good), good)
        for bad in MALICIOUS + ["1a", "-1", "0", "name"]:
            self.assertFalse(bdt.is_index(bad), f"index classifier must reject {bad!r}")


class ConfigTests(unittest.TestCase):
    def test_load_config_parses_ignores_comments_and_bom(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c"
            p.write_text("\ufeff# comment\n\nCLIO_SRC=C:\\a=b\n  KEY = val \nCONFIG=Debug\n", encoding="utf-8")
            cfg = bdt.load_config(p)
        self.assertEqual(cfg["CLIO_SRC"], "C:\\a=b")
        self.assertEqual(cfg["KEY"], "val")
        self.assertEqual(cfg["CONFIG"], "Debug")

    def test_setting_precedence_config_beats_env_beats_default(self):
        with mock.patch.dict(os.environ, {"CONFIG": "FromEnv"}):
            self.assertEqual(bdt.setting({"CONFIG": "FromCfg"}, "CONFIG", "Def"), "FromCfg")
            self.assertEqual(bdt.setting({}, "CONFIG", "Def"), "FromEnv")
            self.assertEqual(bdt.setting({"CONFIG": ""}, "CONFIG", "Def"), "FromEnv")  # empty falls through
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("CONFIG", None)
            self.assertEqual(bdt.setting({}, "CONFIG", "Def"), "Def")

    def test_resolve_config_empty_value_falls_back_to_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            for k in ("CONFIG", "MARKETPLACE_NAME", "KN_MODE"):
                os.environ.pop(k, None)
            out = bdt.resolve_config({"CLIO_SRC": "x", "CONFIG": ""})
        self.assertEqual(out["CONFIG"], "Release", "an empty CONFIG must not stick (would widen an rmtree)")
        self.assertEqual(out["MARKETPLACE_NAME"], "creatio")

    def test_resolve_config_honours_env_when_config_absent(self):
        with mock.patch.dict(os.environ, {"KN_MODE": "branch"}):
            out = bdt.resolve_config({"CLIO_SRC": "x"})
        self.assertEqual(out["KN_MODE"], "branch")


class ClioHomeTests(unittest.TestCase):
    def test_override_argument_wins(self):
        self.assertEqual(bdt.clio_home(os.path.join("o", "ride")), Path(os.path.join("o", "ride")))

    def test_whitespace_override_is_ignored(self):
        with mock.patch.object(bdt, "IS_WIN", False), mock.patch.dict(os.environ, {"HOME": "/home/x"}):
            self.assertEqual(bdt.clio_home("   "), Path("/home/x") / "creatio" / "clio")

    def test_posix_default_is_home_creatio_clio(self):
        with mock.patch.object(bdt, "IS_WIN", False), mock.patch.dict(os.environ, {"HOME": "/home/x"}):
            os.environ.pop("CLIO_HOME", None)
            self.assertEqual(bdt.clio_home(), Path("/home/x") / "creatio" / "clio")

    def test_windows_default_is_localappdata_creatio_clio(self):
        with mock.patch.object(bdt, "IS_WIN", True), \
                mock.patch.dict(os.environ, {"LOCALAPPDATA": r"C:\Users\x\AppData\Local"}):
            os.environ.pop("CLIO_HOME", None)
            self.assertEqual(bdt.clio_home(), Path(r"C:\Users\x\AppData\Local") / "creatio" / "clio")


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
        data, changed = self._rewrite(self._seed({"type": "git", "branch": "dev"}), "release")
        self.assertTrue(changed)
        src = data["knowledge"]["sources"]["creatio-curated"]
        self.assertEqual(src["type"], "github-release")
        self.assertNotIn("branch", src)
        self.assertFalse(data["features"]["knowledge-allow-unsequenced"])

    def test_branch_sets_git_and_flag_true(self):
        data = self._seed({"type": "github-release", "asset-name": "x"})
        data.pop("features")
        data, changed = self._rewrite(data, "branch", ref="feature/eng-1")
        src = data["knowledge"]["sources"]["creatio-curated"]
        self.assertEqual(src["type"], "git")
        self.assertEqual(src["branch"], "feature/eng-1")
        self.assertNotIn("asset-name", src)
        self.assertTrue(data["features"]["knowledge-allow-unsequenced"])

    def test_version_like_ref_is_a_tag(self):
        data, _ = self._rewrite(self._seed({"type": "git"}), "branch", ref="1.13.20")
        self.assertEqual(data["knowledge"]["sources"]["creatio-curated"].get("tag"), "1.13.20")

    def test_missing_source_reports_unchanged(self):
        data, changed = self._rewrite({"knowledge": {"sources": {}}}, "release")
        self.assertFalse(changed)

    def test_defensive_against_null_and_non_dict_shapes(self):
        # These are valid JSON but the wrong shape (a clio schema change / a hand edit). Must NOT raise.
        for shape in ({"knowledge": None}, {"knowledge": {"sources": None}}, [], "str", 5):
            data, changed = self._rewrite(shape, "release")
            self.assertFalse(changed)


class SelectKnowledgeSourceTests(unittest.TestCase):
    def _cfg(self, **extra):
        base = bdt.resolve_config({"CLIO_SRC": "x"})
        base.update(extra)
        return base

    def _select(self, arg_ref, cfg=None):
        with mock.patch.object(bdt.sys.stdin, "isatty", return_value=False):
            return bdt.select_knowledge_source(cfg or self._cfg(), arg_ref)

    def test_release_argument(self):
        self.assertEqual(self._select("release"), ("release", ""))

    def test_branch_name_argument(self):
        self.assertEqual(self._select("feature/eng-1"), ("branch", "feature/eng-1"))

    def test_kn_mode_is_case_insensitive_and_from_config(self):
        # 'Branch' (mixed case, from config) must select branch, not silently fall back to release.
        self.assertEqual(self._select(None, self._cfg(KN_MODE="Branch", KN_BRANCH="feature/x")),
                         ("branch", "feature/x"))

    def test_no_input_defaults_to_release(self):
        self.assertEqual(self._select(None), ("release", ""))

    def test_injection_branch_is_rejected(self):
        with self.assertRaises(SystemExit):
            self._select('x"&calc&"')


class FilesystemHelperTests(unittest.TestCase):
    def test_make_and_remove_dir_link_roundtrip_without_a_shell(self):
        # make/remove_dir_link must not spawn any subprocess (no cmd /c). Patch subprocess.run to blow up.
        with mock.patch.object(bdt.subprocess, "run", side_effect=AssertionError("no subprocess allowed")):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                target = root / "target"
                target.mkdir()
                (target / "marker.txt").write_text("hi", encoding="utf-8")
                link = root / "link"
                if not bdt.make_dir_link(link, target):
                    self.skipTest("no symlink/junction privilege on this host")
                self.assertTrue((link / "marker.txt").exists())
                bdt.remove_dir_link(link)
                self.assertFalse(os.path.lexists(link))
                self.assertTrue((target / "marker.txt").exists(), "target content untouched")

    def test_lock_is_held_false_for_free_file(self):
        with tempfile.TemporaryDirectory() as d:
            lock = Path(d) / "x.lock"
            lock.write_text("", encoding="utf-8")
            self.assertFalse(bdt.lock_is_held(lock))

    def test_cleanup_locks_removes_free_markers(self):
        with tempfile.TemporaryDirectory() as d:
            locks = Path(d) / "knowledge" / "sources" / ".locks"
            locks.mkdir(parents=True)
            (locks / "a.lock").write_text("", encoding="utf-8")
            bdt.cleanup_locks(Path(d))
            self.assertFalse((locks / "a.lock").exists())

    def test_cleanup_locks_no_directory_is_harmless(self):
        with tempfile.TemporaryDirectory() as d:
            bdt.cleanup_locks(Path(d))  # must not raise


class NoShellTests(unittest.TestCase):
    def test_run_passes_a_list_and_never_a_shell(self):
        recorded = {}

        def fake_run(cmd, **kwargs):
            recorded["cmd"] = cmd
            recorded["kwargs"] = kwargs
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with mock.patch.object(bdt.subprocess, "run", side_effect=fake_run):
            bdt.run(["git", "ls-remote", "--heads", "--", "https://x/y.git"], quiet=True)
        self.assertIsInstance(recorded["cmd"], list, "run() must pass a list, not a shell string")
        self.assertFalse(recorded["kwargs"].get("shell", False), "run() must never pass shell=True")

    def test_missing_executable_degrades_to_127(self):
        with mock.patch.object(bdt.subprocess, "run", side_effect=FileNotFoundError("nope")):
            cp = bdt.run(["definitely-not-a-real-binary"], quiet=True)
        self.assertEqual(cp.returncode, 127, "a missing executable must degrade to rc 127, not a traceback")

    def test_driver_source_spawns_no_shell(self):
        src = DRIVER_PATH.read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"shell\s*=\s*True", src), "no shell=True")
        self.assertNotIn("os.system", src)
        self.assertNotIn('"cmd"', src, "no `cmd /c` re-entry")
        self.assertNotIn("'/c'", src)

    def test_git_ls_remote_uses_end_of_options_marker(self):
        src = DRIVER_PATH.read_text(encoding="utf-8")
        self.assertIn('"ls-remote", "--heads", "--"', src)


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.bat = (ROOT / "scripts" / "build-dev-toolchain.bat").read_text(encoding="utf-8")
        self.sh = (ROOT / "scripts" / "build-dev-toolchain.sh").read_text(encoding="utf-8")

    def test_launchers_delegate_to_driver(self):
        self.assertIn("build_dev_toolchain.py", self.bat)
        self.assertIn("build_dev_toolchain.py", self.sh)
        self.assertTrue(self.sh.startswith("#!"))

    def test_launchers_reference_the_repo_python_resolvers(self):
        self.assertIn("find_python.ps1", self.bat)
        self.assertIn("find_python.sh", self.sh)

    def test_launchers_forward_their_arguments(self):
        self.assertIn("%*", self.bat, "the .bat launcher must forward its arguments")
        self.assertIn('"$@"', self.sh, "the .sh launcher must forward its arguments")

    def test_sh_launcher_execs_the_driver_with_args(self):
        self.assertRegex(self.sh, r'exec\s+"\$PYTHON_CMD"\s+"\$DRIVER"\s+"\$@"')

    def test_sh_launcher_is_executable_in_git(self):
        # The POSIX exec bit is stored in git's index (100755), not necessarily on a Windows working copy,
        # so assert the committed mode -- that is what a macOS/Linux checkout gets.
        import shutil as _sh
        if not _sh.which("git"):
            self.skipTest("git not available")
        out = subprocess.run(["git", "ls-files", "-s", "scripts/build-dev-toolchain.sh"],
                             cwd=str(ROOT), text=True, capture_output=True)
        if out.returncode != 0 or not out.stdout.strip():
            self.skipTest("launcher not tracked yet")
        mode = out.stdout.split()[0]
        self.assertEqual(mode, "100755", "the .sh launcher must be committed with the executable bit")

    def test_sh_probes_before_sourcing_the_resolver(self):
        # The side-effect-free local probe must come BEFORE `source ...find_python.sh` (which can install
        # packages / prompt for sudo).
        self.assertLess(self.sh.index("command -v"), self.sh.index("source"),
                        "the local probe must run before the resolver is sourced")


class OrchestrationTests(unittest.TestCase):
    def test_prepare_marketplace_refuses_and_preserves_existing_fallback(self):
        # When the link can't be made and a hand-maintained parent marketplace.json exists, _prepare_marketplace
        # must refuse and leave that file untouched (regression: an earlier version overwrote + deleted it).
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            repo = root / "repo"
            repo.mkdir()
            parent_plugin = root / bdt.CLAUDE_PLUGIN_DIR
            parent_plugin.mkdir()
            existing = parent_plugin / "marketplace.json"
            existing.write_text("KEEP-ME", encoding="utf-8")
            run_tmp = root / "run"
            run_tmp.mkdir()
            with mock.patch.object(bdt, "REPO_ROOT", repo), \
                    mock.patch.object(bdt, "make_dir_link", return_value=False):
                result = bdt._prepare_marketplace("creatio", "plugin", run_tmp)
            self.assertEqual(result, "failed")
            self.assertEqual(existing.read_text(encoding="utf-8"), "KEEP-ME", "existing file must be untouched")

    def test_build_and_pack_runs_dotnet_with_cwd_clio_src(self):
        calls = []

        def rec(cmd, **kw):
            calls.append((cmd, kw))
            if cmd[:2] == ["dotnet", "pack"]:  # create the nupkg so the existence check passes
                out = Path(kw["cwd"]) / "artifacts" / "local-tool"
                out.mkdir(parents=True, exist_ok=True)
                (out / "clio.9.9.9.9.nupkg").write_text("", encoding="utf-8")
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as d:
            clio_src = Path(d)
            with mock.patch.object(bdt, "run", side_effect=rec):
                bdt._build_and_pack(clio_src, "Release", "9.9.9.9")
        dotnet = [(c, kw) for (c, kw) in calls if c and c[0] == "dotnet"]
        self.assertTrue(dotnet, "dotnet build/pack must run")
        for c, kw in dotnet:
            self.assertEqual(kw.get("cwd"), clio_src, f"{c[:2]} must run with cwd=clio_src")

    def test_main_order_and_cleanup_runs_when_stage_b_fails(self):
        order = []
        with tempfile.TemporaryDirectory() as d:
            clio_src = Path(d) / "clio"
            clio_src.mkdir()
            cfg = Path(d) / "build-dev-toolchain.config"
            cfg.write_text(f"CLIO_SRC={clio_src}\n", encoding="utf-8")
            with mock.patch.object(bdt, "CONFIG_FILE", cfg), \
                    mock.patch.object(bdt, "resolve_plugin_name", return_value="p"), \
                    mock.patch.object(bdt, "clio_home", return_value=Path(d) / "home"), \
                    mock.patch.object(bdt, "stage_a_build", side_effect=lambda *a: (order.append("A") or ("1.0", True))), \
                    mock.patch.object(bdt, "stage_c_knowledge", side_effect=lambda *a: order.append("C")), \
                    mock.patch.object(bdt, "stage_b_plugin", side_effect=lambda *a: (order.append("B") or "failed")), \
                    mock.patch.object(bdt, "cleanup_locks", side_effect=lambda *a: order.append("cleanup")), \
                    mock.patch.object(bdt.sys.stdin, "isatty", return_value=False):
                with self.assertRaises(SystemExit) as ctx:
                    bdt.main([])
            self.assertEqual(ctx.exception.code, 1, "a Stage B failure exits 1")
            self.assertEqual(order, ["A", "C", "B", "cleanup"], "cleanup must run even when Stage B fails")


@unittest.skipIf(bdt.IS_WIN, "POSIX flock semantics")
class PosixLockTests(unittest.TestCase):
    def test_lock_is_held_true_while_flocked(self):
        import fcntl
        with tempfile.TemporaryDirectory() as d:
            lock = Path(d) / "x.lock"
            lock.write_text("", encoding="utf-8")
            fd = os.open(str(lock), os.O_RDWR)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertTrue(bdt.lock_is_held(lock), "held while another fd holds an exclusive flock")
            finally:
                fcntl.flock(fd, fcntl.LOCK_UN)
                os.close(fd)
            self.assertFalse(bdt.lock_is_held(lock), "free after release")

    def test_cleanup_locks_keeps_a_held_marker(self):
        import fcntl
        with tempfile.TemporaryDirectory() as d:
            locks = Path(d) / "knowledge" / "sources" / ".locks"
            locks.mkdir(parents=True)
            held = locks / "held.lock"
            held.write_text("", encoding="utf-8")
            free = locks / "free.lock"
            free.write_text("", encoding="utf-8")
            fd = os.open(str(held), os.O_RDWR)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                bdt.cleanup_locks(Path(d))
                self.assertTrue(held.exists(), "a held marker must be kept")
                self.assertFalse(free.exists(), "a free marker must be swept")
            finally:
                fcntl.flock(fd, fcntl.LOCK_UN)
                os.close(fd)


class LauncherExecutionTests(unittest.TestCase):
    """Execute the launchers as real child processes against a stub driver -- proves the hand-off, argument
    forwarding, and exit-code propagation actually work (a source-text assertion cannot)."""

    _STUB = ('import sys\n'
             'sys.stdout.write("ARGV:" + "|".join(sys.argv[1:]))\n'
             'sys.exit(42 if "boom" in sys.argv else 0)\n')

    def _stage(self, d, name):
        import shutil as _sh
        d = Path(d)
        _sh.copy2(ROOT / "scripts" / name, d / name)
        (d / "build_dev_toolchain.py").write_text(self._STUB, encoding="utf-8")
        return d / name

    @unittest.skipUnless(bdt.IS_WIN, "cmd.exe required for the .bat launcher")
    def test_bat_forwards_args_and_exit_code(self):
        with tempfile.TemporaryDirectory() as d:
            bat = self._stage(d, "build-dev-toolchain.bat")
            r = subprocess.run(["cmd", "/c", str(bat), "boom"], text=True, capture_output=True)
            self.assertIn("ARGV:boom", r.stdout)
            self.assertEqual(r.returncode, 42, "the .bat must propagate the driver's exit code")

    @unittest.skipIf(bdt.IS_WIN, "POSIX launcher")
    def test_sh_forwards_args_and_exit_code(self):
        import shutil as _sh
        bash = _sh.which("bash")
        if not bash:
            self.skipTest("bash required")
        with tempfile.TemporaryDirectory() as d:
            sh = self._stage(d, "build-dev-toolchain.sh")
            r = subprocess.run([bash, str(sh), "boom"], text=True, capture_output=True)
            self.assertIn("ARGV:boom", r.stdout)
            self.assertEqual(r.returncode, 42, "the .sh must propagate the driver's exit code")


if __name__ == "__main__":
    unittest.main()
