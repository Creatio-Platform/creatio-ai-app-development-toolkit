import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PlatformSafetyTests(unittest.TestCase):
    def test_scripts_avoid_gnu_only_grep_p(self):
        for path in sorted((ROOT / "scripts").glob("*.sh")) + sorted((ROOT / "scripts").glob("*.py")):
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("grep -P", content, str(path))

    def test_repo_declares_cross_platform_line_endings(self):
        gitattributes = (ROOT / ".gitattributes").read_text(encoding="utf-8")
        self.assertIn("*.sh text eol=lf", gitattributes)
        self.assertIn("*.ps1 text eol=crlf", gitattributes)
        self.assertIn("*.py text eol=lf", gitattributes)
        self.assertIn("*.md text eol=lf", gitattributes)
        self.assertIn("*.json text eol=lf", gitattributes)

    def test_repo_declares_editorconfig_defaults(self):
        editorconfig = (ROOT / ".editorconfig").read_text(encoding="utf-8")
        self.assertIn("root = true", editorconfig)
        self.assertIn("charset = utf-8", editorconfig)
        self.assertIn("insert_final_newline = true", editorconfig)
        self.assertIn("[*.ps1]", editorconfig)
        self.assertIn("end_of_line = crlf", editorconfig)


if __name__ == "__main__":
    unittest.main()
