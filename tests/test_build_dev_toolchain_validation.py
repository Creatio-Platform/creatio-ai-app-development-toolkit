"""Regression coverage for the untrusted-input validation gate in
scripts/build-dev-toolchain.bat.

This gate has already needed multiple fix rounds to close real injection
vectors (string-interpolated PowerShell ``-Command`` breakout, ``echo
%VAR%|findstr`` re-parsing cmd metacharacters in a child shell, and a
leading-hyphen ``git`` argument-injection gap). Every untrusted value now flows
through ONE shared gate -- the ``:vtoken`` subroutine, invoked as
``call :vtoken <NAME> "<regex>"`` -- and these tests pin that behaviour so a
future edit that weakens a regex, drops a variable from the gate, or
reintroduces an unsafe interpolation/pipe pattern fails CI.

The tests are host-agnostic: they read the actual regexes out of the script and
evaluate them with Python's ``re`` (PowerShell ``-match`` on an anchored
``^...$`` pattern is equivalent to a Python ``re.search`` for the single-line
values this gate handles), plus structural assertions on the script text. No
cmd.exe / PowerShell / dotnet / clio / claude execution is required, so this
runs on any CI platform.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build-dev-toolchain.bat"

# Windows PowerShell (the .NET regex engine the script actually runs). When present, a subset of the
# tests re-run the allow-list checks and the Stage C appsettings rewrite through the REAL engine, so a
# Python-re-vs-.NET-regex divergence (or a behavioural regression in the rewrite) is caught on CI.
PWSH = shutil.which("powershell") or shutil.which("pwsh")

# Payloads that MUST be rejected by every allow-list. Covers the classes that
# have bitten this script: quote/backtick/$ PowerShell breakout, cmd operators
# (& | < >), command substitution / statement separators, and a leading hyphen
# (git argument injection on a positional argument).
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
    "",  # empty is not a valid value either
]

# Legitimate values per gated variable (used to prove the allow-list isn't
# over-tight). Keyed by the env var name passed to :vtoken.
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


def _read_script():
    return SCRIPT.read_text(encoding="utf-8", errors="replace")


def _strip_comments(text):
    # Drop batch comment lines (REM ... / :: ...) so structural "must NOT appear"
    # assertions match executable code only, not explanatory prose that quotes
    # the very anti-patterns being forbidden.
    out = []
    for line in text.splitlines():
        s = line.lstrip()
        if s[:4].upper() == "REM " or s.upper() == "REM" or s.startswith("::"):
            continue
        out.append(line)
    return "\n".join(out)


def _matches(dotnet_pattern, value):
    # PowerShell -match on an anchored ^...$ pattern == Python re.search for the
    # single-line values this gate handles.
    return re.search(dotnet_pattern, value) is not None


def _ps_match(pattern, value):
    # Evaluate the gate exactly as the script does: the pattern (a script constant) is inlined into the
    # -Command, but the untrusted VALUE is passed via $env and never interpolated. Returns True on match.
    env = dict(os.environ)
    env["VTOK_VAL"] = value
    r = subprocess.run(
        [PWSH, "-NoProfile", "-Command", f"if($env:VTOK_VAL -match '{pattern}'){{exit 0}}else{{exit 1}}"],
        env=env,
        capture_output=True,
    )
    return r.returncode == 0


def _extract_appsettings_command(text):
    # Pull the Stage C appsettings rewrite out of the .bat and undo cmd's %%->% reduction so it can run
    # directly under -Command.
    line = next(l for l in text.splitlines() if "appsettings.json update failed" in l)
    pre = 'powershell -NoProfile -Command "'
    assert line.startswith(pre) and line.endswith('"'), "unexpected appsettings command shape"
    return line[len(pre):-1].replace("%%", "%")


def _run_appsettings(cmd, home, mode, *, branch="", url="https://github.com/x/clio-knowledge.git"):
    env = dict(os.environ)
    env.update(
        CLIO_HOME=home,
        KN_MODE=mode,
        KN_BRANCH=branch,
        KN_URL=url,
        KN_REL_OWNER="Advance-Technologies-Foundation",
        KN_REL_REPO="clio-knowledge",
        KN_REL_ASSET="clio-knowledge-bundle.zip",
        KN_REL_API="https://api.github.com/",
    )
    subprocess.run([PWSH, "-NoProfile", "-Command", cmd], env=env, capture_output=True, check=True)
    return json.loads((Path(home) / "appsettings.json").read_text(encoding="utf-8"))


class BuildDevToolchainValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read_script()
        cls.code = _strip_comments(cls.text)
        # Every untrusted value is gated by `call :vtoken <NAME> "<regex>"`.
        cls.gates = dict(re.findall(r'call :vtoken (\w+)\s+"([^"]*)"', cls.code))
        assert cls.gates, "no `call :vtoken NAME \"regex\"` gates found in the script"
        # KN_PICK is classified (index vs name), not abort-validated, so it has
        # its own -match and is extracted separately.
        m = re.search(r"KN_PICK -match '([^']*)'", cls.code)
        assert m, "could not locate the KN_PICK classifier regex"
        cls.pick_pat = m.group(1)

    # -- every gated variable is covered (KN_URL, KN_REL_*, KN_BRANCH) ---------
    def test_all_untrusted_config_vars_are_gated(self):
        for expected in ("KN_URL", "KN_REL_OWNER", "KN_REL_REPO", "KN_REL_ASSET", "KN_REL_API", "KN_BRANCH"):
            self.assertIn(expected, self.gates, f"{expected} must be validated via :vtoken")

    def test_every_gate_rejects_malicious(self):
        for name, pat in self.gates.items():
            for payload in MALICIOUS:
                self.assertFalse(_matches(pat, payload), f"{name} gate must reject: {payload!r}")

    def test_every_gate_accepts_its_valid_values(self):
        for name, pat in self.gates.items():
            for good in VALID.get(name, []):
                self.assertTrue(_matches(pat, good), f"{name} gate must accept: {good!r}")

    def test_every_gate_requires_alphanumeric_first_char(self):
        for name, pat in self.gates.items():
            self.assertTrue(
                pat.startswith("^[A-Za-z0-9]"),
                f"{name} gate must anchor an alphanumeric first char (blocks leading -/--), got: {pat}",
            )
            for lead in ("-x", "--upload-pack", "-"):
                self.assertFalse(_matches(pat, lead), f"{name} must reject {lead!r}")

    # -- KN_PICK index classifier ---------------------------------------------
    def test_pick_classifier_rejects_non_numeric_and_injection(self):
        for payload in MALICIOUS + ["1a", "-1", "0"]:
            self.assertFalse(_matches(self.pick_pat, payload), f"KN_PICK must not match: {payload!r}")
        for good in ["1", "2", "17"]:
            self.assertTrue(_matches(self.pick_pat, good), good)

    # -- structural guarantees in the script itself ---------------------------
    def test_validation_is_centralized_in_one_helper(self):
        self.assertIn(":vtoken", self.code, "a shared :vtoken gate must exist")
        # No ad-hoc per-variable -notmatch/-match allow-list should remain
        # outside the shared helper (KN_PICK's classifier is the only -match).
        stray = re.findall(r"KN_(?:URL|BRANCH|REL_\w+) -(?:not)?match", self.code)
        self.assertEqual(stray, [], f"untrusted vars must be gated only via :vtoken, found stray: {stray}")

    def test_git_ls_remote_uses_end_of_options_separator(self):
        self.assertRegex(
            self.code,
            r"git ls-remote --heads -- \"%KN_URL%\"",
            "git ls-remote must pass KN_URL after a `--` end-of-options marker",
        )

    def test_no_single_quote_interpolation_of_untrusted_values(self):
        for var in ("KN_BRANCH", "KN_URL", "KN_MODE", "KN_REL_OWNER", "KN_REL_API"):
            self.assertNotIn(
                f"'%{var}%'",
                self.code,
                f"{var} must not be single-quote interpolated into a PowerShell command",
            )
            self.assertIn(f"$env:{var}", self.code, f"{var} should be read via $env:")

    def test_pick_is_classified_without_echo_pipe_findstr(self):
        self.assertIn("$env:KN_PICK -match", self.code)
        self.assertNotRegex(
            self.code,
            r"echo %KN_PICK%\s*\|\s*findstr",
            "KN_PICK must not be piped through echo|findstr (child-shell re-parse)",
        )

    def test_release_mode_resets_allow_unsequenced_flag(self):
        # Branch mode enables the flag; release mode must reset it to false so a
        # later switch back to release does not leave the signed-bundle trust
        # model durably weakened.
        self.assertRegex(
            self.code,
            r"knowledge-allow-unsequenced'\s*=\s*\$true",
            "branch mode should set knowledge-allow-unsequenced = $true",
        )
        self.assertRegex(
            self.code,
            r"knowledge-allow-unsequenced'\s*=\s*\$false",
            "release mode must reset knowledge-allow-unsequenced = $false",
        )

    # -- REAL-engine checks (Windows PowerShell): parity + behaviour ----------
    @unittest.skipUnless(PWSH, "PowerShell required to exercise the real .NET regex engine")
    def test_real_powershell_match_agrees_with_python(self):
        # Guards against Python-re vs .NET-regex divergence for the exact patterns/payloads the script runs.
        for name, pat in self.gates.items():
            for payload in MALICIOUS:
                self.assertFalse(_ps_match(pat, payload), f"[real PS] {name} must reject {payload!r}")
            for good in VALID.get(name, []):
                self.assertTrue(_ps_match(pat, good), f"[real PS] {name} must accept {good!r}")
        for payload in MALICIOUS:
            self.assertFalse(_ps_match(self.pick_pat, payload), f"[real PS] KN_PICK must reject {payload!r}")
        for good in ("1", "2", "17"):
            self.assertTrue(_ps_match(self.pick_pat, good), f"[real PS] KN_PICK must accept {good!r}")

    @unittest.skipUnless(PWSH, "PowerShell required to execute the Stage C appsettings rewrite")
    def test_appsettings_rewrite_release_and_branch(self):
        # Runs the ACTUAL Stage C rewrite (extracted from the .bat) against a fixture, both modes.
        cmd = _extract_appsettings_command(self.text)
        seed = {
            "knowledge": {"sources": {"creatio-curated": {"type": "git", "location": "u", "branch": "old"}}},
            "features": {"knowledge-allow-unsequenced": True},
        }
        with tempfile.TemporaryDirectory() as home:
            (Path(home) / "appsettings.json").write_text(json.dumps(seed), encoding="utf-8")
            # release mode: source becomes github-release AND the flag is reset to false
            rel = _run_appsettings(cmd, home, "release")
            src = rel["knowledge"]["sources"]["creatio-curated"]
            self.assertEqual(src["type"], "github-release")
            self.assertEqual(src["repository-owner"], "Advance-Technologies-Foundation")
            self.assertNotIn("branch", src, "release must clear the git branch field")
            self.assertFalse(rel["features"]["knowledge-allow-unsequenced"], "release must reset the flag to false")
            # branch mode: source becomes git branch AND the flag is set true
            br = _run_appsettings(cmd, home, "branch", branch="feature/eng-1")
            src = br["knowledge"]["sources"]["creatio-curated"]
            self.assertEqual(src["type"], "git")
            self.assertEqual(src["branch"], "feature/eng-1")
            self.assertNotIn("asset-name", src, "branch must clear the release asset field")
            self.assertTrue(br["features"]["knowledge-allow-unsequenced"], "branch must set the flag true")

    def test_untrusted_values_are_validated_before_first_use(self):
        url_check = self.code.index("call :vtoken KN_URL")
        ls_remote = self.code.index("git ls-remote --heads --")
        self.assertLess(url_check, ls_remote, "KN_URL must be gated before ls-remote")

        branch_check = self.code.index("call :vtoken KN_BRANCH")
        appsettings = self.code.index("appsettings.json update failed")
        self.assertLess(branch_check, appsettings, "KN_BRANCH must be gated before the appsettings edit")


if __name__ == "__main__":
    unittest.main()
