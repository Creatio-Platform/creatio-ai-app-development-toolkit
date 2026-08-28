"""Regression coverage for the untrusted-input validation gate in
scripts/build-dev-toolchain.bat.

This gate has already needed multiple fix rounds to close real injection
vectors (string-interpolated PowerShell ``-Command`` breakout, and
``echo %VAR%|findstr`` re-parsing cmd metacharacters in a child shell). The
tests below pin the current, hardened behaviour so a future edit that weakens a
regex or reintroduces an unsafe interpolation/pipe pattern fails CI.

The tests are intentionally host-agnostic: they read the actual regexes out of
the script and evaluate them with Python's ``re`` (PowerShell ``-match`` /
``-notmatch`` on an anchored ``^...$`` pattern is equivalent to a Python
``re.search`` for single-line values), and they assert structural properties of
the script text. No cmd.exe / PowerShell / dotnet / clio / claude execution is
required, so this runs on any CI platform.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build-dev-toolchain.bat"

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

VALID_URLS = [
    "https://github.com/Advance-Technologies-Foundation/clio-knowledge.git",
    "git@github.com:org/repo.git",
    "https://api.github.com/",
]

VALID_BRANCHES = [
    "master",
    "feature/eng-93152_fab-1.2",
    "1.13.20",
    "release-2.0",
]


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


def _extract(pattern, text, label):
    m = re.search(pattern, text)
    assert m, f"could not locate the {label} validation regex in {SCRIPT.name}"
    return m.group(1)


def _matches(dotnet_pattern, value):
    # PowerShell -match on an anchored ^...$ pattern == Python re.search for the
    # single-line values this gate handles.
    return re.search(dotnet_pattern, value) is not None


class BuildDevToolchainValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read_script()
        cls.code = _strip_comments(cls.text)
        cls.url_pat = _extract(r"KN_URL -notmatch '([^']*)'", cls.text, "KN_URL")
        cls.branch_pat = _extract(r"KN_BRANCH -match '([^']*)'", cls.text, "KN_BRANCH")
        cls.pick_pat = _extract(r"KN_PICK -match '([^']*)'", cls.text, "KN_PICK")

    # -- the allow-lists reject every known-malicious payload -----------------
    def test_url_allowlist_rejects_malicious(self):
        for payload in MALICIOUS:
            self.assertFalse(
                _matches(self.url_pat, payload),
                f"KN_URL allow-list must reject: {payload!r}",
            )

    def test_branch_allowlist_rejects_malicious(self):
        for payload in MALICIOUS:
            self.assertFalse(
                _matches(self.branch_pat, payload),
                f"KN_BRANCH allow-list must reject: {payload!r}",
            )

    def test_pick_classifier_rejects_non_numeric_and_injection(self):
        # KN_PICK is only ever treated as an index when it matches; anything
        # else (including injection payloads) falls through to a name and is
        # then re-validated by the KN_BRANCH allow-list.
        for payload in MALICIOUS + ["1a", "-1", "0"]:
            self.assertFalse(
                _matches(self.pick_pat, payload),
                f"KN_PICK index classifier must not match: {payload!r}",
            )
        for good in ["1", "2", "17"]:
            self.assertTrue(_matches(self.pick_pat, good), good)

    # -- the allow-lists still accept the legitimate values -------------------
    def test_url_allowlist_accepts_valid(self):
        for url in VALID_URLS:
            self.assertTrue(_matches(self.url_pat, url), url)

    def test_branch_allowlist_accepts_valid(self):
        for branch in VALID_BRANCHES:
            self.assertTrue(_matches(self.branch_pat, branch), branch)

    # -- leading-hyphen (git argument injection) is specifically blocked ------
    def test_allowlists_require_alphanumeric_first_char(self):
        for label, pat in (
            ("KN_URL", self.url_pat),
            ("KN_BRANCH", self.branch_pat),
        ):
            self.assertTrue(
                pat.startswith("^[A-Za-z0-9]"),
                f"{label} allow-list must anchor an alphanumeric first char, got: {pat}",
            )
            for lead in ("-x", "--upload-pack", "-"):
                self.assertFalse(_matches(pat, lead), f"{label} must reject {lead!r}")

    # -- structural guarantees in the script itself ---------------------------
    def test_git_ls_remote_uses_end_of_options_separator(self):
        self.assertRegex(
            self.text,
            r"git ls-remote --heads -- \"%KN_URL%\"",
            "git ls-remote must pass KN_URL after a `--` end-of-options marker",
        )

    def test_no_single_quote_interpolation_of_untrusted_values(self):
        # The appsettings edit must read $env:*, never concatenate '%VAR%' into
        # the PowerShell -Command string (the original breakout vector).
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

    def test_untrusted_values_are_validated_before_first_use(self):
        # KN_URL validation must precede the git ls-remote that consumes it, and
        # KN_BRANCH validation must precede the appsettings edit that reads it.
        url_check = self.text.index("KN_URL -notmatch")
        ls_remote = self.text.index("git ls-remote --heads --")
        self.assertLess(url_check, ls_remote, "KN_URL must be validated before ls-remote")

        branch_check = self.text.index("KN_BRANCH -match")
        appsettings = self.text.index("appsettings.json update failed")
        self.assertLess(branch_check, appsettings, "KN_BRANCH must be validated before the appsettings edit")


if __name__ == "__main__":
    unittest.main()
