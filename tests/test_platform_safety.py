import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PlatformSafetyTests(unittest.TestCase):
    def test_scripts_avoid_gnu_only_grep_p(self):
        for path in sorted((ROOT / "scripts").glob("*.sh")) + sorted((ROOT / "scripts").glob("*.py")):
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("grep -P", content, str(path))


if __name__ == "__main__":
    unittest.main()
