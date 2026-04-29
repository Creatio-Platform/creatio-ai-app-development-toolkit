import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASH = shutil.which("bash")


class UnixWrapperSmokeTests(unittest.TestCase):
    def test_find_python_sh_exports_python_cmd(self):
        if not BASH:
            raise unittest.SkipTest("bash is required")
        result = subprocess.run(
            [BASH, "-lc", f"source '{ROOT / 'scripts' / 'find_python.sh'}' >/dev/null && test -n \"$PYTHON_CMD\" && \"$PYTHON_CMD\" --version"],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
