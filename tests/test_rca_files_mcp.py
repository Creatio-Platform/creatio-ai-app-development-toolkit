"""The attachment reader, modules/rca/scripts/rca-files-mcp.mjs, run as an MCP host runs it: node, JSON-RPC on stdin.

These cases need no Creatio site. CREATIO_BASE_URL points at a closed local port, so a request that went out would
fail with a network error (-32603); a case that answers otherwise shows the answer was decided in the script.
"""

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path


def _root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "modules" / "rca" / "scripts" / "rca-files-mcp.mjs").is_file():
            return parent
    raise RuntimeError("no folder above this test holds modules/rca/scripts/rca-files-mcp.mjs")


SCRIPT = _root() / "modules" / "rca" / "scripts" / "rca-files-mcp.mjs"
NODE = shutil.which("node")
CLOSED_PORT_URL = "http://127.0.0.1:9"


def _run(lines, **env_overrides):
    env = {k: v for k, v in os.environ.items() if not k.startswith("CREATIO_")}
    env.update({"CREATIO_BASE_URL": CLOSED_PORT_URL, "CREATIO_LOGIN": "reader", "CREATIO_PASSWORD": "secret"})
    env.update(env_overrides)
    env = {k: v for k, v in env.items() if v is not None}
    stdin ="".join((x if isinstance(x, str) else json.dumps(x)) + "\n" for x in lines)
    run = subprocess.run([NODE, str(SCRIPT)], input=stdin, capture_output=True, text=True, timeout=30, env=env)
    answers = [json.loads(line) for line in run.stdout.splitlines() if line.strip()]
    return run, answers


@unittest.skipUnless(NODE, "node is not on PATH")
class RcaFilesMcpTests(unittest.TestCase):
    def test_exits_when_the_login_is_not_set(self):
        run, answers = _run([], CREATIO_LOGIN=None)
        self.assertEqual(run.returncode, 1)
        self.assertEqual(answers, [])
        self.assertIn("CREATIO_LOGIN", run.stderr)

    def test_exits_when_the_site_is_not_https(self):
        run, answers = _run([], CREATIO_BASE_URL="http://your-site.creatio.com")
        self.assertEqual(run.returncode, 1)
        self.assertEqual(answers, [])
        self.assertIn("https://", run.stderr)

    def test_initialize_answers_without_the_site(self):
        _, answers = _run([{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}])
        self.assertEqual(answers[0]["id"], 1)
        self.assertEqual(answers[0]["result"]["serverInfo"]["name"], "rca-files")

    def test_a_tool_other_than_get_text_file_content_is_refused_before_any_request(self):
        _, answers = _run([{"jsonrpc": "2.0", "id": 7, "method": "tools/call",
                            "params": {"name": "creatio_create_record", "arguments": {}}}])
        self.assertEqual(answers[0]["id"], 7)
        self.assertEqual(answers[0]["error"]["code"], -32602)
        self.assertIn("creatio_create_record", answers[0]["error"]["message"])

    def test_a_line_that_is_not_json_gets_a_parse_error(self):
        _, answers = _run(["this is not json", {"jsonrpc": "2.0", "id": 2, "method": "ping"}])
        self.assertEqual(answers[0]["error"]["code"], -32700)
        self.assertEqual(answers[1], {"jsonrpc": "2.0", "id": 2, "result": {}})


if __name__ == "__main__":
    unittest.main()
