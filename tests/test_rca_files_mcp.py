"""The attachment reader, modules/rca/scripts/rca-files-mcp.mjs, run as an MCP host runs it: node, JSON-RPC on stdin.

Most cases need no Creatio site: CREATIO_BASE_URL points at a closed local port, so a request that went out would fail
with a network error (-32603), and a case that answers otherwise shows the answer was decided in the script. The cases
that talk to the site use a small stand-in on 127.0.0.1 that answers the login and RcaAgentMcp's MCP route.
"""

import json
import os
import shutil
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def _root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "modules" / "rca" / "scripts" / "rca-files-mcp.mjs").is_file():
            return parent
    raise RuntimeError("no folder above this test holds modules/rca/scripts/rca-files-mcp.mjs")


SCRIPT = _root() / "modules" / "rca" / "scripts" / "rca-files-mcp.mjs"
NODE = shutil.which("node")
CLOSED_PORT_URL = "http://127.0.0.1:9"
LOGIN_PATH = "/ServiceModel/AuthService.svc/Login"
MCP_PATH = "/0/rest/ToolServiceMcp/RcaAgentMcp/v1/mcp"
FILE_TOOL = "get_text_file_content"


def _run(lines, **env_overrides):
    env = {k: v for k, v in os.environ.items() if not k.startswith("CREATIO_")}
    env.update({"CREATIO_BASE_URL": CLOSED_PORT_URL, "CREATIO_LOGIN": "reader", "CREATIO_PASSWORD": "secret"})
    env.update(env_overrides)
    env = {k: v for k, v in env.items() if v is not None}
    stdin = "".join((x if isinstance(x, str) else json.dumps(x)) + "\n" for x in lines)
    run = subprocess.run([NODE, str(SCRIPT)], input=stdin, capture_output=True, text=True, timeout=60, env=env)
    answers = [json.loads(line) for line in run.stdout.splitlines() if line.strip()]
    return run, {a.get("id"): a for a in answers}


def _call(id_, name=FILE_TOOL):
    return {"jsonrpc": "2.0", "id": id_, "method": "tools/call", "params": {"name": name, "arguments": {}}}


def _list(id_):
    return {"jsonrpc": "2.0", "id": id_, "method": "tools/list"}


class _Site:
    """A stand-in for a Creatio site: the login, and RcaAgentMcp offering one tool more than the reader passes on."""

    def __init__(self, refuse_login=False):
        self.refuse_login = refuse_login
        self.logins = 0
        site = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _answer(self, status, body=None, headers=()):
                data = b"" if body is None else json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                for name, value in headers:
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                if self.path == LOGIN_PATH:
                    site.logins += 1
                    if site.refuse_login:
                        self._answer(200, {"Code": 1, "Message": "Invalid username or password"})
                    else:
                        self._answer(200, {"Code": 0}, [("Set-Cookie", "BPMCSRF=token; path=/"),
                                                        ("Set-Cookie", ".ASPXAUTH=session; path=/")])
                elif self.path != MCP_PATH:
                    self._answer(404)
                elif request.get("method") == "initialize":
                    self._answer(200, {"jsonrpc": "2.0", "id": request["id"], "result": {"capabilities": {}}},
                                 [("Mcp-Session-Id", "s1")])
                elif "id" not in request:
                    self._answer(202)
                elif request["method"] == "tools/list":
                    tools = [{"name": FILE_TOOL, "inputSchema": {}}, {"name": "execute_sql", "inputSchema": {}}]
                    self._answer(200, {"jsonrpc": "2.0", "id": request["id"], "result": {"tools": tools}})
                else:
                    self._answer(200, {"jsonrpc": "2.0", "id": request["id"], "result": {"content": []}})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def __enter__(self):
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


@unittest.skipUnless(NODE, "node is not on PATH")
class RcaFilesMcpTests(unittest.TestCase):
    def test_without_the_login_it_runs_with_no_tools(self):
        run, answers = _run([_list(1), _call(2)], CREATIO_LOGIN=None)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(answers[1]["result"]["tools"], [])
        self.assertEqual(answers[2]["error"]["code"], -32002)
        self.assertIn("CREATIO_LOGIN", answers[2]["error"]["message"])

    def test_a_site_that_is_not_https_gets_no_password(self):
        run, answers = _run([_list(1), _call(2)], CREATIO_BASE_URL="http://your-site.creatio.com")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(answers[1]["result"]["tools"], [])
        self.assertIn("https://", answers[2]["error"]["message"])

    def test_initialize_answers_without_the_site(self):
        _, answers = _run([{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}])
        self.assertEqual(answers[1]["result"]["serverInfo"]["name"], "rca-files")

    def test_a_tool_other_than_get_text_file_content_is_refused_before_any_request(self):
        _, answers = _run([_call(7, "creatio_create_record")])
        self.assertEqual(answers[7]["error"]["code"], -32602)
        self.assertIn("creatio_create_record", answers[7]["error"]["message"])

    def test_a_line_that_is_not_json_gets_a_parse_error(self):
        _, answers = _run(["this is not json", {"jsonrpc": "2.0", "id": 2, "method": "ping"}])
        self.assertEqual(answers[None]["error"]["code"], -32700)
        self.assertEqual(answers[2], {"jsonrpc": "2.0", "id": 2, "result": {}})

    def test_only_get_text_file_content_is_listed(self):
        with _Site() as site:
            run, answers = _run([_list(1)], CREATIO_BASE_URL=site.url)
        self.assertEqual([tool["name"] for tool in answers[1]["result"]["tools"]], [FILE_TOOL], run.stderr)

    def test_a_refused_login_is_sent_once(self):
        with _Site(refuse_login=True) as site:
            _, answers = _run([_call(1), _call(2)], CREATIO_BASE_URL=site.url)
        self.assertEqual(site.logins, 1)
        for id_ in (1, 2):
            self.assertIn("CREATIO_PASSWORD", answers[id_]["error"]["message"])


if __name__ == "__main__":
    unittest.main()
