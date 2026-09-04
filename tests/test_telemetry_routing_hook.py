import concurrent.futures
import glob
import json
import re
import os
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "hooks" / "telemetry-routing.mjs"
NODE = shutil.which("node")
# The floor event carries `workflow`, which only a clio that ships the stage vocabulary
# accepts — an older release rejects it as unsupported-fields. So the end-to-end check runs
# against an explicitly nominated binary rather than whatever `clio` happens to be on PATH,
# and stays skipped until that clio is the installed one.
CLIO = os.environ.get("CAADT_TEST_CLIO")

_TMP = tempfile.mkdtemp(prefix="caadt-hook-tests-")


NEWLINE = chr(10)
STUB_CAPTURE_SOURCE = NEWLINE.join([
    "const fs = require('fs');",
    # Capturing is optional: a test that only cares about the ANSWER passes no capture path,
    # and a stub that threw on the missing variable would die before answering - which then
    # looks exactly like a clio that never ran.
    "const capture = process.env.CAADT_STUB_CAPTURE;",
    "if (capture) { fs.appendFileSync(capture, fs.readFileSync(0, 'utf8')); }",
]) + NEWLINE
# `emitEvent` looks for the substring "recorded" in RAW stdout, so the status has to appear
# unescaped. Nesting it inside a JSON-encoded text block yields (backslash-quote)recorded and
# would make the stub look like a rejection - which it silently did until this was checked.
RECORDED_REPLY = "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:2,result:{structuredContent:{success:true,status:'recorded'}}}));"
# What clio answers when it refuses: an answer, just not one containing "recorded". A stub that
# printed nothing instead would be indistinguishable from a clio that never ran, which the hook
# resolves by the age of the answer rather than by its content.
REJECTED_REPLY = ("process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:2,result:{structuredContent:"
                  "{success:false,status:'rejected',error:{code:'invalid-token'}}}}));")
# A clio that hangs: the point of the promptness test, since the hook must not wait for it.
HANGING_REPLY = "setTimeout(() => {}, 30000);"
# An answer that exists, parses, and states nothing this parser reads: no structured status, no error.
# The point is that it must NOT be read as a refusal — a stored event retried up to the attempt limit
# is a corrupted denominator, and the substring fallback cannot save it because inside a JSON-encoded
# text block the bytes are an escaped "recorded".
OPAQUE_REPLY = ("process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:2,result:"
                "{content:[{type:'text',text:'the event was handled'}]}}));")
# The other shape clio may answer with: the status inside a JSON text block rather than in
# structuredContent. If this is what it really sends, every `recorded` assertion in CI would
# otherwise be exercising a shape that never occurs in production.
TEXT_RECORDED_REPLY = ("process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:2,result:{content:"
                       "[{type:'text',text:JSON.stringify({success:true,status:'recorded'})}]}}));")
# A refusal whose payload names a `recorded` field, so the raw bytes contain the quoted word
# while the response is plainly an error. Read as a substring this is indistinguishable from
# success; read as JSON-RPC it is a refusal.
ECHOES_RECORDED_REPLY = (
    "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:2,error:{code:-32602,"
    "data:{recorded:false},message:'event already stored for this session'}}));"
)
# What a clio that predates the flow-agnostic vocabulary answers to `workflow_started`: a refusal
# whose code is the one that means the pairing itself is wrong, not the one send.
UNKNOWN_EVENT_REPLY = ("process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:2,result:{structuredContent:"
                       "{success:false,status:'rejected',error:{code:'unknown-event-name',"
                       "message:'Unknown telemetry event name.'}}}}));")

def _base_env() -> dict:
    return {
        k: v
        for k, v in os.environ.items()
        if k
        not in {
            "TMPDIR",
            "TMP",
            "TEMP",
            "CLIO_TELEMETRY_HOME",
            "CLIO_HOME",
            # A developer's leftover override must not decide what these tests observe: the
            # identity fields are resolved from the installed manifest, and an inherited
            # CAADT_TELEMETRY_PLUGIN_VERSION would hide that resolution behind its own value.
            "CAADT_TELEMETRY_PLUGIN_VERSION",
            "CAADT_TELEMETRY_AGENT",
        }
    }


def run_hook(
    payload: dict,
    *,
    telemetry_home: str,
    clio: str = "caadt-no-such-clio",
    host: str | None = None,
    capture: "Path | None" = None,
    capture_dir: str | None = None,
    home: str | None = None,
):
    """Invoke the hook exactly as Claude Code does: JSON on stdin, JSON on stdout.

    `telemetry_home` redirects clio's telemetry storage, so a test controls the consent
    state and can never read or write the developer's real telemetry. `clio` defaults to a
    name that does not exist, which exercises the floor-emit failure path without spawning
    anything; the integration test below points it at the real binary. `home` redirects
    Node's `os.homedir()` (both `HOME` and `USERPROFILE`, since the hook runs on Windows too),
    so a test can exercise the transcript-path fallback without ever touching the developer's
    real `~/.claude/projects`.
    """
    return subprocess.run(
        [NODE, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=60,
        # A fresh TMPDIR per suite isolates the once-per-session marker files, so tests
        # cannot leak state into each other or into a developer's machine.
        # The stub resolves `mcp-server` relative to the process working directory, so the hook
        # runs from the stub's own directory when one is in use.
        cwd=capture_dir,
        env={
            **_base_env(),
            "TMPDIR": _TMP,
            "TMP": _TMP,
            "TEMP": _TMP,
            "CLIO_TELEMETRY_HOME": telemetry_home,
            "CAADT_TELEMETRY_CLIO": clio,
            **({"CAADT_TELEMETRY_HOOK_HOST": host} if host else {}),
            **({"CAADT_STUB_CAPTURE": str(capture)} if capture else {}),
            **({"HOME": home, "USERPROFILE": home} if home else {}),
        },
    )


def stub_clio(*, answers: str = "recorded") -> "tuple[str, Path]":
    """A stand-in for the clio binary that captures what the hook actually sends.

    The suite could assert only that the hook survives a MISSING clio: the default
    `caadt-no-such-clio` exercises the emit path solely as a failure, so the payload — the thing
    that decides whether an event is accepted at all — was asserted nowhere, and three defects
    reached a live stand through a green suite (`plugin_version=unknown`, one host's name reported
    for every host, and a `<synthetic>` model that made clio reject the whole floor event).

    The hook spawns `<clio> mcp-server`, so a file literally named `mcp-server` beside a `node`
    executable is a stub on every platform, with no shell and no real binary: `CAADT_TELEMETRY_CLIO`
    becomes `node`, and node runs an extension-less file as CommonJS.

    `answers` picks what clio says back: `recorded` (stored), `rejected` (refused, e.g. an invalid
    field), `unknown-event` (refused because this clio predates the vocabulary), `hangs` (never
    answers, still running) or `silent` (exits without answering, which is what a missing or broken
    clio looks like from here).
    """
    directory = Path(tempfile.mkdtemp(prefix="caadt-stub-clio-", dir=_TMP))
    capture = directory / "captured.jsonl"
    # `emitEvent` counts a send as delivered when stdout contains `"recorded"`, which is what clio
    # answers; a stub that prints nothing reproduces a rejection without restating clio's error shape.
    reply = {"recorded": RECORDED_REPLY, "rejected": REJECTED_REPLY,
             "hangs": HANGING_REPLY, "silent": "",
             "opaque": OPAQUE_REPLY, "text-recorded": TEXT_RECORDED_REPLY,
             "echoes-recorded": ECHOES_RECORDED_REPLY,
             "unknown-event": UNKNOWN_EVENT_REPLY}[answers]
    (directory / "mcp-server").write_text(
        STUB_CAPTURE_SOURCE + reply + NEWLINE, encoding="utf-8"
    )
    return str(directory), capture


def await_payloads(capture: "Path", count: int, timeout: float = 20.0,
                   event_name: "str | None" = None) -> "list[dict]":
    """Wait for the detached emit to land, then return the payloads.

    The emit is deliberately fire-and-forget — the hook returns before clio answers, so that a tool
    call never waits on telemetry — which means a test that reads the capture the moment the hook
    exits is racing the child it is asserting about.
    """
    # `event_name` narrows what is being waited FOR. Waiting on a raw total would be satisfied by
    # the floor event plus one reading and return before the reading under test has landed.
    def matching():
        payloads = sent_payloads(capture)
        return [p for p in payloads if event_name is None or p["event_name"] == event_name]

    deadline = time.monotonic() + timeout
    while len(matching()) < count and time.monotonic() < deadline:
        time.sleep(0.05)
    return matching()


def settled_payloads(capture: "Path", count: int, event_name: "str | None" = None,
                     settle: float = 1.5) -> "list[dict]":
    """Wait for `count` payloads, then keep watching to see whether more arrive.

    `await_payloads` returns the moment the lower bound is met, so `assertEqual(len(...), 1)` could
    not fail on a duplicate that landed 50 ms later — which is exactly what the tests about NOT
    re-sending are for. This one is the assertion those tests need.
    """
    payloads = await_payloads(capture, count, event_name=event_name)
    deadline = time.monotonic() + settle
    while time.monotonic() < deadline:
        time.sleep(0.1)
        payloads = [p for p in sent_payloads(capture)
                    if event_name is None or p["event_name"] == event_name]
    return payloads


def outcome_files(session: str, kind: str) -> "list[Path]":
    """Every answer file for this session and kind.

    One file per DISPATCH, not per kind: a second dispatch used to truncate the file a still-running
    child was writing to, so the files now carry a nonce and the tests have to look them all up.
    """
    state = Path(_TMP, "caadt-telemetry-routing")
    if not state.exists():
        return []
    return sorted(state.glob(f"{session}.{kind}-*-outcome"))


def await_outcome(session: str, kind: str, timeout: float = 20.0) -> str:
    """Wait until clio's answer for the most recent dispatch has been written, and return it."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for answer in outcome_files(session, kind):
            text = answer.read_text(encoding="utf-8")
            if text.strip():
                return text
        time.sleep(0.05)
    return ""


def age_out_outcome(session: str, kind: str) -> None:
    """Backdate an unanswered dispatch past the hook's grace period.

    An empty answer is ambiguous — a child still starting looks exactly like a clio that never ran —
    so the hook resolves it by age. Backdating makes that deterministic instead of a sleep.
    """
    state = Path(_TMP, "caadt-telemetry-routing")
    state.mkdir(parents=True, exist_ok=True)
    answers = outcome_files(session, kind)
    if not answers:
        # No dispatch has created one: stand in for the first attempt so the age check has a file.
        nonce = "a0" if kind == "floor" else "u0"
        answers = [state / f"{session}.{kind}-{nonce}-outcome"]
        answers[0].write_text("", encoding="utf-8")
    old = time.time() - 60
    for answer in answers:
        os.utime(answer, (old, old))
    # The claim file's own age is what makes an unanswered dispatch retryable, so it ages too.
    for claim in Path(_TMP, "caadt-telemetry-routing").glob(f"{session}.claimed*"):
        os.utime(claim, (old, old))


def sent_payloads(capture: "Path") -> "list[dict]":
    """Every `send-telemetry` argument object the hook handed to clio, in order."""
    if not capture.exists():
        return []
    payloads = []
    for line in capture.read_text(encoding="utf-8").splitlines():
        if not line.startswith("{"):
            continue
        message = json.loads(line)
        if message.get("method") != "tools/call":
            continue
        arguments = message["params"]["arguments"]["args"]
        if arguments.get("command") == "send-telemetry":
            payloads.append(arguments["args"])
    return payloads


PREFIX_SAMPLE_BYTES = 4096


def write_large_transcript(turns: int = 4, pad_bytes: int = 6000) -> "tuple[Path, int]":
    """A transcript whose head exceeds the hook's fingerprint sample, plus its expected output total.

    The resume path is only taken when the hashed prefix stops changing, i.e. once the file is larger
    than PREFIX_SAMPLE_BYTES. Every other fixture here is a few hundred bytes, so the offset was never
    reused and the incremental reader had no coverage at all — the equivalence test compared one full
    parse against another.
    """
    path = Path(tempfile.mkdtemp(prefix="caadt-large-transcript-", dir=_TMP), "session.jsonl")
    # A padded first line, so the hashed head is stable while later lines are appended.
    lines = [json.dumps({"type": "summary", "note": "x" * pad_bytes})]
    total = 0
    for turn in range(turns):
        total += 3
        lines.append(json.dumps({"message": {"model": "claude-opus-5", "usage": {
            "input_tokens": 10 + turn, "output_tokens": 3,
            "cache_read_input_tokens": 100, "cache_creation_input_tokens": 0}}}))
    path.write_text(chr(10).join(lines) + chr(10), encoding="utf-8")
    assert path.stat().st_size > PREFIX_SAMPLE_BYTES, "fixture must exceed the fingerprint sample"
    return path, total


def append_turn(path: "Path", output_tokens: int, input_tokens: int = 20) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"message": {"model": "claude-opus-5", "usage": {
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "cache_read_input_tokens": 200, "cache_creation_input_tokens": 0}}}) + chr(10))


def scan_marker(session: str) -> dict:
    return json.loads(
        Path(_TMP, "caadt-telemetry-routing", f"{session}.scan").read_text(encoding="utf-8"))


def write_transcript() -> str:
    """A minimal stand-in for the host's session transcript.

    Two assistant turns, so the test proves the counters are SUMMED across the session and
    the model is taken from the latest turn rather than the first. A trailing partial line
    mimics a live session mid-flush, which the hook must skip instead of failing on.
    """
    lines = [
        json.dumps({"message": {"model": "claude-opus-5", "usage": {
            "input_tokens": 10, "output_tokens": 3,
            "cache_read_input_tokens": 500, "cache_creation_input_tokens": 100}}}),
        json.dumps({"type": "user", "message": {"content": "no usage on user turns"}}),
        json.dumps({"message": {"model": "claude-opus-5", "usage": {
            "input_tokens": 20, "output_tokens": 4,
            "cache_read_input_tokens": 600, "cache_creation_input_tokens": 0}}}),
        '{"message": {"model": "claude-opus-5", "usage": {"input_tok',
    ]
    path = Path(tempfile.mkdtemp(prefix="caadt-hook-transcript-", dir=_TMP), "session.jsonl")
    path.write_text("\n".join(lines), encoding="utf-8")
    return str(path)


def telemetry_home(consent: str | None) -> str:
    """A throwaway clio telemetry home, optionally with a stored consent decision."""
    home = tempfile.mkdtemp(prefix="caadt-hook-home-", dir=_TMP)
    if consent is not None:
        Path(home, "consent.json").write_text(
            json.dumps({"telemetry_consent": consent}), encoding="utf-8"
        )
    return home


class TelemetryRoutingHookWiringTests(unittest.TestCase):
    """The hook must be shipped and registered, or it silently does nothing."""

    def test_hook_is_registered_in_the_claude_plugin_manifest(self):
        manifest = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))

        # PostToolUse, not PreToolUse: the floor event should mean the clio call actually
        # happened, and a hook that spawns a process must not sit in front of the tool it
        # is observing.
        entries = manifest["hooks"]["PostToolUse"]
        commands = [hook["command"] for entry in entries for hook in entry["hooks"]]
        self.assertTrue(
            any("telemetry-routing.mjs" in command for command in commands),
            "the telemetry-routing hook must be wired into PostToolUse",
        )
        # Matching clio's MCP tools specifically: a broader matcher would emit a floor event
        # in sessions that never touch Creatio. Applied as a regex against real tool names rather
        # than checked for the substring "clio": a matcher can contain that substring and still
        # match nothing, which would silently disable the floor on the primary host.
        matchers = [re.compile(entry["matcher"]) for entry in entries]
        for tool in (
            "mcp__plugin_creatio-ai-app-development-toolkit_clio__clio-run",
            "mcp__plugin_creatio-ai-app-development-toolkit_clio__list-apps",
            "mcp__clio__create-app",
            # Named in review as the representative case, so it is pinned by name rather than
            # covered by implication.
            "mcp__clio__execute-query",
        ):
            self.assertTrue(
                any(matcher.match(tool) for matcher in matchers),
                f"the matcher must select {tool}",
            )
        for unrelated in ("mcp__atlassian__getJiraIssue", "Bash", "Read"):
            self.assertFalse(
                any(matcher.match(unrelated) for matcher in matchers),
                f"the matcher must not select {unrelated}",
            )
        # Referenced through the plugin root, so the command resolves wherever the plugin is
        # installed rather than relative to whatever directory the host happened to start in.
        for command in commands:
            if "telemetry-routing.mjs" in command:
                self.assertIn("${CLAUDE_PLUGIN_ROOT}", command)

        # Also on UserPromptSubmit, which is how one session's several runs each get routed: a
        # new request reopens the per-turn claim. It takes NO matcher — the event carries no
        # tool name — and the hook only clears state there, never speaks.
        prompt_entries = manifest["hooks"]["UserPromptSubmit"]
        prompt_commands = [hook["command"] for entry in prompt_entries for hook in entry["hooks"]]
        self.assertTrue(
            any("telemetry-routing.mjs" in command for command in prompt_commands),
            "the hook must be wired into UserPromptSubmit so a later run in the session is routed too",
        )

        # And on Stop, which is the only point where a true consumption total exists. Without this
        # registration the token counters are reported once per session at its very first clio call,
        # when consumption is near zero — technically true and analytically useless.
        stop_entries = manifest["hooks"]["Stop"]
        stop_commands = [hook["command"] for entry in stop_entries for hook in entry["hooks"]]
        self.assertTrue(
            any("telemetry-routing.mjs" in command for command in stop_commands),
            "the hook must be wired into Stop so the session's consumption is reported",
        )

        # Exactly these three, and no fourth added by accident: a hook type this file does not
        # handle would spawn the process on events it has nothing to do on.
        self.assertEqual(set(manifest["hooks"]), {"PostToolUse", "UserPromptSubmit", "Stop"})
        # Only PostToolUse is scoped by a matcher; the other two carry no tool name to match on, and
        # a matcher there would silently stop them firing at all.
        for event in ("UserPromptSubmit", "Stop"):
            for entry in manifest["hooks"][event]:
                self.assertNotIn("matcher", entry, f"{event} entries must not be tool-scoped")

    def test_hook_directory_ships_with_the_plugin(self):
        # Hooks live in the plugin manifest, so ${CLAUDE_PLUGIN_ROOT}/hooks must be part of
        # the released payload. Without this entry the manifest would point at a file that
        # does not exist on an installed plugin.
        manifest = json.loads((ROOT / ".release-manifest.json").read_text(encoding="utf-8"))

        self.assertIn("hooks", manifest["plugin_runtime"])
        self.assertTrue(HOOK.exists())


@unittest.skipIf(NODE is None, "node is not available")
class TelemetryRoutingHookBehaviorTests(unittest.TestCase):
    """The hook is the guaranteed floor; it must never be able to break a tool call."""

    def test_routes_once_on_the_first_clio_call(self):
        session = str(uuid.uuid4())

        first = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__clio-run"},
            telemetry_home=telemetry_home("granted"),
        )

        self.assertEqual(first.returncode, 0)
        payload = json.loads(first.stdout)["hookSpecificOutput"]
        self.assertEqual(payload["hookEventName"], "PostToolUse")
        context = payload["additionalContext"]
        # The session id must be handed over: the agent's stages have to land in the same
        # telemetry session as the floor event, or the two cannot be joined.
        self.assertIn(session, context)
        # And the agent must be told TO open its own start under its real workflow. clio keys
        # session state by the (session_id, workflow) pair, so that start is not a duplicate of
        # the floor's `unattributed` one — it is what gives the run a beginning at all. Telling
        # the agent to skip it produced a real run recorded as a build with no start.
        self.assertIn("DO emit your own `workflow_started`", context)
        self.assertNotIn("do NOT emit workflow_started", context)
        # One session carries several requests, and the routing now recurs across them — so it must
        # also say where one run ends. Without this a second request closed the first one's funnel:
        # a task that succeeded was recorded as blocked by the task that followed it.
        self.assertIn("one run is one request", context)
        # And it must not provoke an id switch mid-run. The write reminder can only arrive after the
        # agent has already opened its run, and a measured run obeyed a plain "reuse this id": it left
        # an abandoned start under its own id plus a second start here, counting one run twice.
        self.assertIn("keep that", context)
        # The identity fields are handed over resolved. The hook knows the installed values; the agent
        # was measured guessing them — five versions for one installation, four invented — so it is
        # told what to send rather than asked to find out.
        self.assertIn('plugin_version="', context)
        self.assertIn('coding_agent="', context)
        for workflow in ("classic-to-freedom-migration", "branding", "app-maintenance"):
            self.assertIn(workflow, context)
        self.assertIn("EVERY workflow", context)
        self.assertIn("does NOT exempt", context)
        self.assertIn("no skill loaded", context)
        # It routes to the vocabulary instead of restating it. This file ships inside an
        # installed plugin, so a copied stage list would outlive the clio release that
        # corrected it — the reminder must name the article, not the stages.
        self.assertIn("get-guidance name=product-telemetry", context)
        self.assertIn("Do not spell a stage from memory", context)
        # The per-flow counter-example must survive; it is what stops the invented name.
        self.assertIn("migration_plan_approved", context)
        residue = context.replace("migration_plan_approved", "").replace(
            "DO emit your own `workflow_started`", ""
        )
        for stage in ("plan_approved", "workflow_completed", "changes_applied"):
            self.assertNotIn(stage, residue)

    def test_names_the_installed_plugin_version_and_never_a_placeholder(self):
        # The routing text tells the agent to send no plugin_version at all rather than the
        # placeholder `unknown` — and the hook used to default to exactly that placeholder, so it
        # broke its own rule and, before clio made the field optional, was rejected outright. The
        # version now comes from the manifest beside this hook, which IS the installed version.
        manifest = json.loads(
            (Path(HOOK).parent.parent / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        )
        session = str(uuid.uuid4())

        result = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__list-apps",
                "cwd": _TMP,
            },
            telemetry_home=telemetry_home("granted"),
        )

        self.assertEqual(result.returncode, 0)
        context = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn(f'plugin_version="{manifest["version"]}"', context)
        for placeholder in ('plugin_version="unknown"', 'plugin_version="null"',
                            'plugin_version="undefined"', 'coding_agent="null"'):
            self.assertNotIn(placeholder, context)

    def test_coding_agent_names_the_host_that_is_running_the_hook(self):
        # One default for every host would report a Codex run as Claude Code — a cohort that never
        # ran, and indistinguishable in the data from a real Claude Code session.
        session = str(uuid.uuid4())

        result = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__list-apps",
                "cwd": _TMP,
            },
            telemetry_home=telemetry_home("granted"),
            host="codex",
        )

        self.assertEqual(result.returncode, 0)
        context = json.loads(result.stdout)["systemMessage"]
        self.assertIn('coding_agent="Codex"', context)
        self.assertNotIn("Claude Code", context)

    def test_the_floor_payload_carries_no_placeholder_identity(self):
        # What actually reached a live stand: coding_agent=claude-code, plugin_version=unknown. The
        # routing text forbids exactly that placeholder, and clio slugs one host's name over four.
        # Asserted on the wire, because the routing text agreeing with itself proved nothing.
        manifest = json.loads(
            (Path(HOOK).parent.parent / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        )
        session = str(uuid.uuid4())
        stub, capture = stub_clio()

        result = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=telemetry_home("granted"),
            clio=NODE,
            capture=capture,
            capture_dir=stub,
        )

        self.assertEqual(result.returncode, 0)
        floor = await_payloads(capture, 1)
        self.assertEqual(len(floor), 1)
        self.assertEqual(floor[0]["event_name"], "workflow_started")
        self.assertEqual(floor[0]["workflow"], "unattributed")
        self.assertEqual(floor[0]["plugin_version"], manifest["version"])
        self.assertNotEqual(floor[0]["plugin_version"], "unknown")
        self.assertEqual(floor[0]["coding_agent"], "Claude Code")

    def test_the_floor_payload_names_the_host_that_ran_the_hook(self):
        session = str(uuid.uuid4())
        stub, capture = stub_clio()

        result = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=telemetry_home("granted"),
            clio=NODE,
            capture=capture,
            capture_dir=stub,
            host="cursor",
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(await_payloads(capture, 1)[0]["coding_agent"], "Cursor")

    def test_omits_a_model_the_validator_would_refuse(self):
        # Claude Code writes synthetic assistant messages carrying model "<synthetic>". clio rejects
        # a malformed token by rejecting the WHOLE event, so one such message after the last real
        # turn cost the floor — the tier this design calls guaranteed — for the entire session.
        session = str(uuid.uuid4())
        transcript = Path(tempfile.mkdtemp(prefix="caadt-synthetic-", dir=_TMP), "session.jsonl")
        transcript.write_text(
            json.dumps({"message": {"model": "claude-opus-5", "usage": {
                "input_tokens": 10, "output_tokens": 3}}})
            + chr(10)
            + json.dumps({"message": {"model": "<synthetic>", "usage": {
                "input_tokens": 1, "output_tokens": 1}}}),
            encoding="utf-8",
        )
        stub, capture = stub_clio()

        result = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__list-apps",
                "transcript_path": str(transcript),
                "cwd": _TMP,
            },
            telemetry_home=telemetry_home("granted"),
            clio=NODE,
            capture=capture,
            capture_dir=stub,
        )

        self.assertEqual(result.returncode, 0)
        floor = await_payloads(capture, 1)[0]
        # The last REAL model survives instead of being overwritten by the unusable one, and nothing
        # outside clio's token shape is ever sent.
        self.assertEqual(floor["model"], "claude-opus-5")
        self.assertNotIn("<", floor["model"])

    def test_a_refused_floor_emit_is_retried_on_the_next_clio_call(self):
        # The claim is taken before the emit, so a refused send used to spend the one marker that
        # allows the floor and lose it permanently — the same failure mode the consent check above
        # already guards against. The refusal is now noticed on a later call rather than awaited,
        # because the emit is fire-and-forget: see `dispatch` in the hook.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        failing, _ = stub_clio(answers="rejected")
        recording, capture = stub_clio()

        rejected = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=home, clio=NODE, capture_dir=failing,
        )
        self.assertIn("rejected", await_outcome(session, "floor"))
        retried = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=home, clio=NODE, capture=capture, capture_dir=recording,
        )

        for result in (rejected, retried):
            self.assertEqual(result.returncode, 0)
        floor = await_payloads(capture, 1, event_name="workflow_started")
        self.assertEqual(len(floor), 1, "the floor must be re-attempted after a send that stored nothing")

    def test_a_clio_that_never_answers_is_retried_once_the_grace_has_passed(self):
        # A detached spawn reports nothing to this process: a clio that is not installed produces no
        # answer and no visible error, so an unanswered dispatch must not wait for one forever. The
        # answer's age decides, and the test backdates it instead of sleeping.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        silent, _ = stub_clio(answers="silent")
        recording, capture = stub_clio()

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
                 telemetry_home=home, clio=NODE, capture_dir=silent)
        age_out_outcome(session, "floor")
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
                 telemetry_home=home, clio=NODE, capture=capture, capture_dir=recording)

        self.assertEqual(
            len(await_payloads(capture, 1, event_name="workflow_started")), 1,
            "an answer that never arrives must eventually count as a refusal",
        )

    def test_returns_promptly_when_clio_hangs(self):
        # The whole point of the hand-off. This runs inside PostToolUse, so any wait here is time the
        # developer's own tool call spends blocked — the previous implementation held it for as long
        # as clio took, up to a 15s timeout, contradicting the invariant AGENTS.md states.
        session = str(uuid.uuid4())
        hanging, capture = stub_clio(answers="hangs")

        started = time.monotonic()
        result = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=telemetry_home("granted"), clio=NODE,
            capture=capture, capture_dir=hanging,
        )
        elapsed = time.monotonic() - started

        self.assertEqual(result.returncode, 0)
        self.assertLess(elapsed, 5.0, "the hook must not wait for clio to answer")
        # And the event was still handed off rather than skipped: the hanging stub captured it.
        self.assertEqual(len(await_payloads(capture, 1)), 1)

    def test_a_clio_that_never_records_stops_being_retried(self):
        # Retrying without end would buy a process spawn on every tool call of the session.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        failing, capture = stub_clio(answers="rejected")

        for attempt in range(5):
            result = run_hook(
                {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
                telemetry_home=home, clio=NODE, capture=capture, capture_dir=failing,
            )
            self.assertEqual(result.returncode, 0)
            # Each refusal has to be on disk before the next call can notice it, since the answer
            # arrives after the hook has already returned.
            await_outcome(session, "floor")

        attempts = await_payloads(capture, 3, event_name="workflow_started")
        self.assertEqual(len(attempts), 3, "bounded by FLOOR_ATTEMPT_LIMIT")

    def test_a_persistently_refused_floor_says_so_once_and_not_once_per_call(self):
        # `noteFloorExhausted` is the only local signal that an install's floor is dead: a clio that
        # refuses `workflow_started` on every attempt leaves the session with no telemetry and, without
        # that line, nothing anywhere saying anything was ever tried. Raised in review of PR #96 as
        # untested, and a regression in either half of it is silent. The diagnostic has to appear once
        # the attempt slots are spent, and its `claimOnce` guard has to hold it to one line per session
        # rather than repeating on every later clio call for the life of a long session.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        failing, capture = stub_clio(answers="rejected")

        lines = 0
        first_written_on = None
        stderr = ""
        for call in range(1, 7):
            result = run_hook(
                {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
                telemetry_home=home, clio=NODE, capture=capture, capture_dir=failing,
            )
            self.assertEqual(result.returncode, 0)
            written = result.stderr.count("was rejected on every attempt")
            if written and first_written_on is None:
                first_written_on = call
            lines += written
            stderr += result.stderr
            # Each refusal has to be on disk before the next call can notice it, since the answer
            # arrives after the hook has already returned.
            await_outcome(session, "floor")

        self.assertEqual(
            lines, 1,
            "the exhaustion diagnostic is claimed once per session, not once per remaining call",
        )
        # FLOOR_ATTEMPT_LIMIT is 3, so calls 1 to 3 each take an attempt slot and the fourth is the
        # first that finds none left. Writing it earlier would report a dead floor while a retry was
        # still outstanding.
        self.assertEqual(
            first_written_on, 4,
            "the diagnostic belongs on the first call after the attempt slots are spent",
        )
        # The line names clio's reason. A generic "refused" could not tell a deploy that shipped ahead
        # of its clio from a one-off rejection for a bad field, and those need opposite responses.
        self.assertIn("clio's last answer was 'invalid-token'", stderr)
        self.assertNotIn("predates the flow-agnostic telemetry vocabulary", stderr,
                         "a field-level refusal must not be reported as an incompatible clio")

    def test_an_incompatible_clio_is_named_as_the_reason_the_floor_died(self):
        # The degradation path of the whole design: nothing probes clio's version before the first
        # send, so a toolkit build that reaches a clio predating the vocabulary learns it from the
        # answer. `unknown-event-name` is that answer, and it has to come out as a distinct sentence
        # with the cause and the fix, once, or a maintainer reading stderr sees only "refused" and
        # cannot tell the whole install is dead on arrival.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        too_old, capture = stub_clio(answers="unknown-event")

        stderr = ""
        for _ in range(5):
            result = run_hook(
                {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
                telemetry_home=home, clio=NODE, capture=capture, capture_dir=too_old,
            )
            self.assertEqual(result.returncode, 0)
            stderr += result.stderr
            await_outcome(session, "floor")

        self.assertEqual(stderr.count("clio's last answer was 'unknown-event-name'"), 1)
        self.assertEqual(stderr.count("predates the flow-agnostic telemetry vocabulary"), 1,
                         "the incompatible-clio sentence is written once, with the cause and the fix")
        self.assertIn("upgrade clio", stderr)

    def test_a_withdrawn_consent_stops_the_next_call_not_the_next_session(self):
        # The hook reads clio's consent record off disk instead of asking clio for its live decision,
        # which docs/telemetry-transport-decision.md accepts as a trade-off. What that trade-off
        # actually costs is decided by how long a stale answer survives, and nothing pinned it.
        # Consent is re-read on every invocation, so a withdrawal takes effect on the very NEXT hook
        # call. Caching it for the session would leave an opt-out silently ineffective for the rest of
        # that session, which is a different and far worse bargain than the one written down.
        write = {
            "tool_name": "mcp__clio__clio-run",
            "tool_input": {"command": "modify-entity-schema-column", "args": {"environment-name": "x"}},
        }

        # Control arm first: with consent left standing, the second call's write reminder does fire.
        # Without this the assertion below would pass just as well if the reminder were simply spent
        # by the first call, which would make the test agree with any behaviour at all.
        kept = telemetry_home("granted")
        kept_session = str(uuid.uuid4())
        run_hook({"session_id": kept_session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=kept)
        still_reminded = run_hook({"session_id": kept_session, **write}, telemetry_home=kept)
        self.assertIn(
            "get-guidance name=product-telemetry", still_reminded.stdout,
            "the write reminder has to fire on the second call while consent stands",
        )

        # Withdrawal arm: the same two calls, with consent revoked in between.
        home = telemetry_home("granted")
        session = str(uuid.uuid4())
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"}, telemetry_home=home)
        Path(home, "consent.json").write_text(
            json.dumps({"telemetry_consent": "denied"}), encoding="utf-8"
        )
        after = run_hook({"session_id": session, **write}, telemetry_home=home)

        self.assertEqual(after.returncode, 0)
        self.assertEqual(
            after.stdout.strip(), "",
            "a withdrawal must silence the hook on the next call, not at the next session",
        )

    def test_a_refused_reading_is_re_sent_rather_than_remembered(self):
        # Marking a refused send as delivered hides the failure behind a series that merely looks
        # sparse, and a persistently refused field would end the series in silence. The reading is
        # therefore held as pending and only becomes the reported figure once clio confirms it.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        failing, capture = stub_clio(answers="rejected")
        transcript = write_transcript()

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, clio=NODE, capture_dir=failing)
        run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": transcript},
            telemetry_home=home, clio=NODE, capture=capture, capture_dir=failing,
        )
        await_outcome(session, "usage")
        # A second Stop on the SAME transcript: the refused reading was never confirmed, so the
        # session's reported total has not moved and the reading is sent again.
        run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": transcript},
            telemetry_home=home, clio=NODE, capture=capture, capture_dir=failing,
        )

        readings = await_payloads(capture, 2, event_name="session_usage")
        self.assertGreaterEqual(len(readings), 2,
                                "a reading clio did not accept must be re-sent, not remembered as sent")
        marker = Path(_TMP, "caadt-telemetry-routing", f"{session}.usage")
        self.assertTrue(marker.exists(), "a dispatched reading must leave a pending record")
        self.assertEqual(json.loads(marker.read_text(encoding="utf-8"))["output"], 0,
                         "nothing may be recorded as reported until clio confirms it")

    def test_sweeps_stale_markers_but_not_on_every_call(self):
        # Marker files are per session and nothing removes them when a session ends, so they need a
        # sweep — but it was running from `stateDir()`, which `markerPath()` calls, so a full
        # directory listing plus a stat per file ran several times per hook invocation and the cost
        # grew with every marker any session on the machine had ever left behind.
        state = Path(_TMP, "caadt-telemetry-routing")
        state.mkdir(parents=True, exist_ok=True)
        stale_age = time.time() - 8 * 24 * 60 * 60

        def stale_marker(name: str) -> Path:
            marker = state / name
            marker.write_text("", encoding="utf-8")
            os.utime(marker, (stale_age, stale_age))
            return marker

        # The sweep is rate-limited by a stamp file, so an earlier test in the same directory would
        # otherwise decide this one's outcome: clear it to make a sweep due, which is also the
        # only state the assertion below is about.
        (state / ".swept").unlink(missing_ok=True)
        first = stale_marker("caadt-sweep-first.claimed")
        run_hook({"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=telemetry_home("granted"))
        self.assertFalse(first.exists(), "a marker older than the TTL must be cleaned up")

        # A second invocation moments later must NOT sweep again: the stamp the first one wrote is
        # what keeps housekeeping off the hot path.
        second = stale_marker("caadt-sweep-second.claimed")
        run_hook({"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=telemetry_home("granted"))
        self.assertTrue(second.exists(), "the sweep must be rate-limited, not run on every call")

    def test_fires_on_a_genuine_cursor_after_mcp_execution_payload(self):
        # Not the Claude payload with the host flag flipped, which is what the other cursor tests do:
        # the field names documented for Cursor's afterMCPExecution
        # (https://cursor.com/docs/agent/hooks). Two of them diverge in ways that mattered — the
        # session is `conversation_id`, and `tool_input` arrives as a STRING — so read raw there was no
        # session id at all, main() returned at its first guard, and the Cursor floor never fired.
        stub, capture = stub_clio()

        result = run_hook(
            {
                "conversation_id": "cursor-conv-01",
                "generation_id": "gen-01",
                "hook_event_name": "afterMCPExecution",
                "model": "claude-4.5-sonnet",
                "cursor_version": "1.7.0",
                "workspace_roots": [_TMP],
                "tool_name": "mcp__creatio-ai-app-development-toolkit_clio__clio-run",
                "tool_input": json.dumps({"command": "create-app", "args": {"name": "Usr"}}),
                "result_json": "{}",
                "duration": 812,
            },
            telemetry_home=telemetry_home("granted"),
            clio=NODE, capture=capture, capture_dir=stub, host="cursor",
        )

        self.assertEqual(result.returncode, 0)
        floor = await_payloads(capture, 1, event_name="workflow_started")
        self.assertEqual(len(floor), 1, "the Cursor floor must fire on Cursor's own payload shape")
        self.assertEqual(floor[0]["session_id"], "cursor-conv-01")
        self.assertEqual(floor[0]["coding_agent"], "Cursor")
        # Cursor states the model in the payload, which is the only place it can be read there.
        self.assertEqual(floor[0]["model"], "claude-4.5-sonnet")

    def test_a_clio_that_never_confirms_a_reading_stops_the_series(self):
        # `session_usage` fires per response and its only guard is "the transcript grew", which is
        # true nearly every time. Without a bound, a clio that never confirms would cost a full
        # transcript re-parse AND a process spawn on every remaining response of the session.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        failing, capture = stub_clio(answers="rejected")
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": failing}
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)

        for turn in range(9):
            transcript = Path(tempfile.mkdtemp(prefix=f"caadt-turn-{turn}-", dir=_TMP), "session.jsonl")
            transcript.write_text(
                chr(10).join(
                    json.dumps({"message": {"model": "claude-opus-5", "usage": {
                        "input_tokens": 10, "output_tokens": 3}}})
                    for _ in range(turn + 1)),
                encoding="utf-8",
            )
            run_hook({"session_id": session, "hook_event_name": "Stop",
                      "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)
            await_outcome(session, "usage")

        # Exactly the limit. `<= 5` also accepted 2, 3 or 4 - that is, a series that ends EARLY,
        # which is the direction that loses data and the thing this bound is written against.
        readings = settled_payloads(capture, 5, event_name="session_usage")
        self.assertEqual(len(readings), 5, "bounded by USAGE_ATTEMPT_LIMIT, and not lower")

    def test_an_executor_call_with_no_readable_command_counts_as_a_write(self):
        # `clio-run` alone is read/write-ambiguous, so an unreadable command used to be classified as
        # a read — losing the first-write reminder on what may well have been a mutation. The two
        # ways of being wrong are not equal: guessing write costs at most one extra reminder in a turn
        # already bounded to one.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        # The turn's own reminder is spent first, so what this asserts is the WRITE reminder.
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"}, telemetry_home=home)

        result = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__clio-run",
                "tool_input": {"arguments": {"unexpected": "shape"}},
            },
            telemetry_home=home,
        )

        self.assertEqual(result.returncode, 0)
        self.assertTrue(result.stdout.strip(),
                        "an unresolvable command must still earn the first-write reminder")

    def test_an_unrelated_session_is_never_touched_on_the_always_firing_events(self):
        # `UserPromptSubmit` and `Stop` have no matcher support in the host — they fire on every
        # prompt and every response, including in sessions that never go near Creatio. So the cost on
        # those turns has to be a guard, not work: nothing created, nothing written, nothing swept,
        # no process spawned. Asserted against a FRESH temp directory, because a state directory left
        # by another test would make this pass for the wrong reason.
        fresh = Path(tempfile.mkdtemp(prefix="caadt-fresh-state-", dir=_TMP))
        session = str(uuid.uuid4())

        for payload in (
            {"session_id": session, "hook_event_name": "UserPromptSubmit", "prompt": "unrelated"},
            {"session_id": session, "hook_event_name": "Stop"},
        ):
            with self.subTest(event=payload["hook_event_name"]):
                result = subprocess.run(
                    [NODE, str(HOOK)],
                    input=json.dumps(payload),
                    capture_output=True, text=True, timeout=60,
                    env={**_base_env(), "TMPDIR": str(fresh), "TMP": str(fresh), "TEMP": str(fresh),
                         "CLIO_TELEMETRY_HOME": telemetry_home("granted"),
                         "CAADT_TELEMETRY_CLIO": "caadt-no-such-clio"},
                )

                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "", "an unrelated turn must produce no output")
                self.assertEqual(
                    sorted(p.name for p in fresh.iterdir()), [],
                    "a session that never called clio must leave nothing behind")

    def test_exits_cleanly_on_input_it_cannot_use(self):
        # The guarantee this hook makes is that it never fails the turn it is attached to and never
        # prints anything the host could read as output. Since the always-firing events reach it on
        # every turn, that has to hold for input it was not designed for, not only for the happy path.
        for payload in ("not json at all", "", "[]", '{"hook_event_name": "UserPromptSubmit"}'):
            with self.subTest(payload=payload[:20]):
                result = subprocess.run(
                    [NODE, str(HOOK)],
                    input=payload,
                    capture_output=True, text=True, timeout=60,
                    env={**_base_env(), "TMPDIR": _TMP, "TMP": _TMP, "TEMP": _TMP,
                         "CLIO_TELEMETRY_HOME": telemetry_home("granted"),
                         "CAADT_TELEMETRY_CLIO": "caadt-no-such-clio"},
                )

                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr, "", "a stack trace on stderr is output too")

    def test_a_missing_clio_binary_does_not_surface_an_error(self):
        # The detached spawn emits an 'error' event for a binary that cannot be run, and an 'error'
        # event with no listener throws. The synchronous exit normally wins that race, which is
        # exactly why the listener exists — a guarantee that depends on exit timing is not one.
        session = str(uuid.uuid4())

        result = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=telemetry_home("granted"),
            clio=str(Path(_TMP, "definitely-not-an-executable")),
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        # The routing still reached the agent: a broken clio costs the floor, not the reminder.
        self.assertIn("workflow_started", result.stdout)

    def test_a_refusal_that_echoes_the_success_word_is_still_a_refusal(self):
        # The outcome used to be decided by searching the raw stdout for `"recorded"`. A rejection
        # whose message happens to contain it — "already recorded for this session" — would then be
        # read as success, and since this outcome decides whether the floor claim is kept forever or
        # released for retry, a false success permanently drops the one event this file guarantees.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        echoing, _ = stub_clio(answers="echoes-recorded")
        recording, capture = stub_clio()

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
                 telemetry_home=home, clio=NODE, capture_dir=echoing)
        answer = await_outcome(session, "floor")
        self.assertIn("recorded", answer, "the fixture must contain the word, or it tests nothing")
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
                 telemetry_home=home, clio=NODE, capture=capture, capture_dir=recording)

        self.assertEqual(
            len(await_payloads(capture, 1, event_name="workflow_started")), 1,
            "an error response must be read as a refusal and the floor retried",
        )

    def test_works_from_a_completely_fresh_state_directory(self):
        # Regression: `markerPath` was made side-effect-free so the always-firing events touch
        # nothing, but `markTouchedClio` — the FIRST write of a session — then had no directory to
        # write into. The marker silently failed to appear, so Stop stayed silent for the whole
        # session and no usage reading was ever sent. The suite could not see it because every other
        # test shares one state directory that an earlier test had already created.
        fresh = tempfile.mkdtemp(prefix="caadt-fresh-flow-", dir=_TMP)
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        env = {**_base_env(), "TMPDIR": fresh, "TMP": fresh, "TEMP": fresh,
               "CLIO_TELEMETRY_HOME": home, "CAADT_TELEMETRY_CLIO": NODE,
               "CAADT_STUB_CAPTURE": str(capture)}

        for payload in (
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": fresh},
            {"session_id": session, "hook_event_name": "Stop",
             "transcript_path": write_transcript()},
        ):
            result = subprocess.run(
                [NODE, str(HOOK)], input=json.dumps(payload), cwd=stub,
                capture_output=True, text=True, timeout=60, env=env,
            )
            self.assertEqual(result.returncode, 0)

        events = [p["event_name"] for p in await_payloads(capture, 2)]
        self.assertIn("workflow_started", events)
        self.assertIn("session_usage", events,
                      "a session on a fresh machine must still report its consumption")

    def test_incremental_reading_matches_a_full_parse_across_appends(self):
        # The transcript is now read from a remembered byte offset instead of from zero. That is only
        # allowed if the answer is identical: this walks a session turn by turn, appending as the host
        # does — including a final line with no trailing newline, which is what a just-ended turn looks
        # like — and asserts each reading equals the total of everything written so far.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub}
        transcript = Path(tempfile.mkdtemp(prefix="caadt-incremental-", dir=_TMP), "session.jsonl")
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)

        expected = []
        total = 0
        for turn in range(1, 6):
            total += turn
            # Written the way a host writes it: previous lines terminated, the newest one not yet.
            lines = [
                json.dumps({"message": {"model": "claude-opus-5", "usage": {
                    "input_tokens": 10 * t, "output_tokens": t,
                    "cache_read_input_tokens": t, "cache_creation_input_tokens": 0}}})
                for t in range(1, turn + 1)
            ]
            transcript.write_text(chr(10).join(lines), encoding="utf-8")
            expected.append(total)
            run_hook({"session_id": session, "hook_event_name": "Stop",
                      "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)
            await_outcome(session, "usage")

        readings = await_payloads(capture, len(expected), event_name="session_usage")
        self.assertEqual([r["output_tokens"] for r in readings], expected,
                         "an incrementally read total must equal the full parse of the same file")
        # The latest turn's per-request figures, not a sum of them.
        self.assertEqual(readings[-1]["input_tokens"], 50)

    def test_a_rewritten_transcript_abandons_the_offset_without_losing_the_total(self):
        # Compaction rewrites the transcript. A remembered offset would then point into the middle of
        # different content and silently under-report the session — the failure that made this
        # optimisation risky at all, which is why the offset is trusted only while a fingerprint of
        # the file's head still matches.
        #
        # This test used to demand the total RESTART from zero on a rewrite, which is what the code
        # did and is the more serious of the two bugs here: `session_usage` is a monotonic series, so
        # a reading that goes backwards is suppressed by the growth gate — not for one turn, but for
        # the rest of the session. The series went quiet rather than wrong, which is why neither this
        # suite nor a dashboard would have called it out. The two cases are also indistinguishable
        # from the file alone (both present a changed fingerprint), so the code can only serve one:
        # it carries the committed total forward as a baseline and re-parses the new bytes on top.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub}
        transcript = Path(tempfile.mkdtemp(prefix="caadt-rewritten-", dir=_TMP), "session.jsonl")

        def turn(input_tokens, output_tokens):
            return json.dumps({"message": {"model": "claude-opus-5", "usage": {
                "input_tokens": input_tokens, "output_tokens": output_tokens}}})

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)
        transcript.write_text(chr(10).join([turn(10, 3), turn(20, 4)]) + chr(10), encoding="utf-8")
        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)
        await_outcome(session, "usage")

        # Rewritten from the top, LONGER than before, with different content — so neither the size
        # comparison nor a "files only grow" assumption would catch it on its own.
        transcript.write_text(
            chr(10).join([turn(99, 100), turn(99, 100), turn(99, 100)]) + chr(10), encoding="utf-8")
        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)

        readings = await_payloads(capture, 2, event_name="session_usage")
        # 307, not 300: every byte of the new file is re-parsed (the offset is discarded), and the 7
        # already reported for this session is kept as the floor under it. 300 would mean the series
        # stepped backwards and then stayed silent.
        self.assertEqual([r["output_tokens"] for r in readings], [7, 307],
                         "a rewrite must re-parse from byte zero without discarding what was reported")

    def test_a_stop_event_without_transcript_path_falls_back_to_the_slugged_home_location(self):
        # Every other Stop test supplies `transcript_path` directly, so the fallback that derives
        # it from `~/.claude/projects/<slugged cwd>/<session_id>.jsonl` has never actually been
        # exercised end-to-end — only unit-level, on the slug string itself.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        userhome = tempfile.mkdtemp(prefix="caadt-fallback-home-", dir=_TMP)
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub, "home": userhome}
        cwd = str(Path(_TMP, "fallback project.dir"))

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": cwd},
                 telemetry_home=home, **stubbed)

        # Mirrors slugForCwd(): non-alphanumeric characters (including the dot and space a naive
        # separator-only replace would leave behind) become '-'.
        slug = re.sub(r"[^A-Za-z0-9]", "-", cwd)
        project_dir = Path(userhome, ".claude", "projects", slug)
        project_dir.mkdir(parents=True, exist_ok=True)
        transcript = project_dir / f"{session}.jsonl"
        transcript.write_text(json.dumps({"message": {"model": "claude-opus-5", "usage": {
            "input_tokens": 10, "output_tokens": 7}}}) + chr(10), encoding="utf-8")

        run_hook({"session_id": session, "hook_event_name": "Stop", "cwd": cwd},
                 telemetry_home=home, **stubbed)

        readings = await_payloads(capture, 1, event_name="session_usage")
        self.assertEqual(readings[0]["output_tokens"], 7,
                         "omitting transcript_path must still find the transcript under the home fallback")

    def test_the_resume_path_is_actually_taken_and_agrees_with_a_full_parse(self):
        # The equivalence test this replaces compared a full parse against a full parse: every fixture
        # was under the 4 KB fingerprint sample, so the sample WAS the whole file, its hash changed on
        # every append, and the offset was never once reused. It would have passed with the entire
        # resume branch deleted.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub}
        transcript, expected = write_large_transcript()
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)

        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)
        await_outcome(session, "usage")
        first_offset = scan_marker(session)["offset"]
        append_turn(transcript, output_tokens=11)
        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)

        readings = await_payloads(capture, 2, event_name="session_usage")
        # The resume actually happened: a non-zero offset that advanced.
        self.assertGreater(first_offset, 0, "the offset must be reused, not restarted at 0")
        self.assertGreater(scan_marker(session)["offset"], first_offset)
        # And it agrees with the arithmetic a full parse would produce.
        self.assertEqual([r["output_tokens"] for r in readings], [expected, expected + 11])
        self.assertEqual(readings[-1]["input_tokens"], 20, "latest reading, not a sum")

    def test_a_compacted_transcript_does_not_end_the_series(self):
        # Compaction rewrites the transcript shorter and with a different head, so the offset is
        # correctly abandoned — but the accumulated totals were abandoned with it, and the monotonic
        # gate ("only report a total that grew") then compared the small new total against the large
        # old one and skipped every remaining reading. The series went silent while looking sparse,
        # which is the exact failure this whole tier exists to prevent.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub}
        transcript, expected = write_large_transcript()
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)
        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)
        await_outcome(session, "usage")

        # Compaction: a different, shorter file at the same path.
        transcript.write_text(
            json.dumps({"type": "summary", "note": "compacted"}) + chr(10)
            + json.dumps({"message": {"model": "claude-opus-5", "usage": {
                "input_tokens": 5, "output_tokens": 4}}}) + chr(10),
            encoding="utf-8")
        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)

        readings = await_payloads(capture, 2, event_name="session_usage")
        self.assertEqual(len(readings), 2, "a compaction must not end the series")
        self.assertEqual(readings[1]["output_tokens"], expected + 4,
                         "what was already committed must be carried forward, not restarted")

    def test_a_scan_marker_from_another_version_is_discarded(self):
        # Markers live for seven days, so a record written by an older version of the hook will be
        # read by a newer one. Honouring its offset while misreading its fields would under-report the
        # rest of the session permanently; one full re-parse is the correct price.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub}
        transcript, expected = write_large_transcript()
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)
        marker = Path(_TMP, "caadt-telemetry-routing", f"{session}.scan")
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(json.dumps({
            "v": 99, "size": 10, "offset": 10, "prefix": "0", "prefixLength": 10,
            "output_tokens": "not a number", "input_tokens": 0, "cached_input_tokens": 0,
        }), encoding="utf-8")

        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)

        reading = await_payloads(capture, 1, event_name="session_usage")[0]
        self.assertEqual(reading["output_tokens"], expected,
                         "an unreadable record must produce a full re-parse, not a corrupt total")

    def test_a_synthetic_turn_does_not_zero_the_latest_reading_fields(self):
        # Measured on real transcripts: Claude Code writes turn-boundary messages with
        # `model: "<synthetic>"` and an all-zero usage block. Skipping only the model token left the
        # block, which set hasData and overwrote input_tokens/cached_input_tokens — the two
        # LATEST-READING fields — with zeros, so a session that had spent hundreds of thousands of
        # tokens reported zeros and looked like a healthy reading.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        transcript = Path(tempfile.mkdtemp(prefix="caadt-synth-tail-", dir=_TMP), "session.jsonl")
        transcript.write_text(
            json.dumps({"message": {"model": "claude-opus-5", "usage": {
                "input_tokens": 4000, "output_tokens": 900,
                "cache_read_input_tokens": 7000, "cache_creation_input_tokens": 0}}}) + chr(10)
            + json.dumps({"message": {"model": "<synthetic>", "usage": {
                "input_tokens": 0, "output_tokens": 0,
                "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}}) + chr(10),
            encoding="utf-8")
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, clio=NODE, capture=capture, capture_dir=stub)

        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)},
                 telemetry_home=home, clio=NODE, capture=capture, capture_dir=stub)

        reading = await_payloads(capture, 1, event_name="session_usage")[0]
        self.assertEqual(reading["input_tokens"], 4000, "a synthetic turn must not zero this")
        self.assertEqual(reading["cached_input_tokens"], 7000)
        self.assertEqual(reading["output_tokens"], 900)
        self.assertEqual(reading["model"], "claude-opus-5")

    def test_exactly_one_floor_event_per_session(self):
        # R2's central claim, and it was asserted only in the class that needs a real clio binary and
        # is skipped by default — so CI never checked the one invariant the denominator depends on.
        # A duplicate floor silently inflates it, which biases every ratio computed against it.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub}

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)
        await_outcome(session, "floor")
        run_hook({"session_id": session, "hook_event_name": "UserPromptSubmit"},
                 telemetry_home=home, **stubbed)
        run_hook({"session_id": session, "tool_name": "mcp__clio__clio-run",
                  "tool_input": {"command": "create-app"}}, telemetry_home=home, **stubbed)
        result = run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                          telemetry_home=home, **stubbed)

        self.assertEqual(result.returncode, 0)
        floor = settled_payloads(capture, 1, event_name="workflow_started")
        self.assertEqual(len(floor), 1, "the floor is the denominator: exactly one per session")

    def test_no_second_floor_while_the_first_answer_is_outstanding(self):
        # The retry must not fire on an answer that has not arrived. With a hanging clio nothing can
        # have been answered, so a second dispatch would be unambiguously wrong — and this is the
        # branch the fast recording stub reaches only by luck.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        hanging, capture = stub_clio(answers="hangs")
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": hanging}

        for _ in range(3):
            run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                     telemetry_home=home, **stubbed)

        floor = settled_payloads(capture, 1, event_name="workflow_started")
        self.assertEqual(len(floor), 1, "a pending answer is not a refusal")

    def test_no_second_reading_while_the_first_answer_is_outstanding(self):
        # Same for the series, and this one used to be guarded by comparing transcript SIZES — which
        # differ on nearly every turn, so the guard was decorative and overlapping dispatches were the
        # norm. Overlap is what let one child truncate another's files.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        hanging, capture = stub_clio(answers="hangs")
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": hanging}
        transcript, _ = write_large_transcript()
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)

        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)
        append_turn(transcript, output_tokens=50)
        run_hook({"session_id": session, "hook_event_name": "Stop",
                  "transcript_path": str(transcript)}, telemetry_home=home, **stubbed)

        readings = settled_payloads(capture, 1, event_name="session_usage")
        self.assertEqual(len(readings), 1,
                         "a grown transcript must not start a second dispatch over the first's files")

    def test_parallel_hook_processes_emit_one_floor_between_them(self):
        # Claude Code batches tool calls, so two PostToolUse hooks on one session run concurrently as
        # a matter of course. `claimOnce` is exclusive-create for exactly this reason, and nothing
        # tested it: every other test here is strictly sequential.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        payload = {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP}

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = [pool.submit(run_hook, dict(payload), telemetry_home=home,
                                   clio=NODE, capture=capture, capture_dir=stub)
                       for _ in range(8)]
            for future in results:
                self.assertEqual(future.result().returncode, 0)

        # `run_hook` returning only means the hook PROCESS exited — the detached child it spawned and
        # unref'd (the one that actually writes the outcome file and, on the winning attempt, the
        # payload) can still be running. Synchronizing on that outcome file first, rather than relying
        # on `settled_payloads`' fixed settle window alone, removes most of the risk of a straggling
        # child under CI load being read as "no further event landed" before it has actually run.
        await_outcome(session, "floor")
        floor = settled_payloads(capture, 1, event_name="workflow_started")
        self.assertEqual(len(floor), 1, "eight racing processes must produce one floor event")

    def test_an_unrecognised_answer_is_not_treated_as_a_refusal(self):
        # clio's live response shape could not be captured while this was written, so the parser has a
        # fallback for a shape it does not know. An unknown answer must NOT retry the floor: inside a
        # JSON-encoded text block the bytes are an escaped "recorded", which the substring check
        # cannot see, so a stored event would otherwise be emitted again up to the attempt limit.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        opaque, capture = stub_clio(answers="opaque")
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": opaque}

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)
        await_outcome(session, "floor")
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)

        floor = settled_payloads(capture, 1, event_name="workflow_started")
        self.assertEqual(len(floor), 1, "an answer that says nothing definite must not be retried")

    def test_a_recorded_status_inside_a_text_block_counts_as_recorded(self):
        # The other shape clio may answer with. If this is what it really sends, then every
        # `recorded` path in CI would otherwise be testing a shape that never occurs.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        textual, capture = stub_clio(answers="text-recorded")
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": textual}

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)
        await_outcome(session, "floor")
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)

        floor = settled_payloads(capture, 1, event_name="workflow_started")
        self.assertEqual(len(floor), 1, "a recorded event must never be re-emitted")

    def test_a_bare_command_that_does_not_exist_surfaces_nothing(self):
        # The path-shaped case is refused before `spawn` by the executable guard, so it never reached
        # the 'error' listener the previous version of this test was entirely about. A BARE name does
        # spawn, and its ENOENT arrives as an error event — which throws when unhandled.
        session = str(uuid.uuid4())

        result = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=telemetry_home("granted"),
            clio="caadt-definitely-no-such-command",
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "", "a stack trace on stderr is output too")
        self.assertIn("workflow_started", result.stdout, "the routing still reaches the agent")

    def test_a_path_shaped_executable_that_is_not_a_file_is_never_spawned(self):
        # The security guard: a value that looks like a path must resolve to a real file, or nothing
        # is dispatched at all. Asserted by the absence of the request file, since no child runs.
        session = str(uuid.uuid4())

        result = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=telemetry_home("granted"),
            clio=str(Path(_TMP, "not-a-real-file", "clio.exe")),
        )

        self.assertEqual(result.returncode, 0)
        state = Path(_TMP, "caadt-telemetry-routing")
        self.assertEqual(list(state.glob(f"{session}.floor-*-request")), [],
                         "a path-shaped value that is not a file must not be spawned")

    def test_a_bare_clio_is_spawned_with_cwd_pinned_away_from_the_hooks_own_directory(self):
        # The Windows PATHEXT/cwd hijack this closes: a bare `clio` is left to PATH resolution, and
        # on Windows that resolution consults the process's OWN current directory before PATH is
        # exhausted (nodejs/node#46264) — so an untrusted/cloned repository used as the hook's cwd
        # could supply its own `clio`-shaped executable and have it run in place of the real tool.
        # A prior version of this test only measured that ENOENT reached the error listener when no
        # decoy was reachable at all; it could not have told a pinned cwd apart from an unpinned one,
        # because both looked identical from here. This one can: a DECOY `mcp-server` sits in the
        # hook's own process directory — standing in for the untrusted repo — configured to answer
        # exactly like a real clio would. If cwd pinning were ever dropped, `node mcp-server` (spawned
        # with the bare name "node") would resolve THIS file relative to the hook's inherited cwd and
        # it would answer; with pinning in place, the spawned child's cwd is the fixed state
        # directory instead, which has no such file, so the decoy is never reached and nothing is
        # ever captured.
        session = str(uuid.uuid4())
        decoy_dir = Path(tempfile.mkdtemp(prefix="caadt-decoy-cwd-", dir=_TMP))
        capture = decoy_dir / "captured.jsonl"
        (decoy_dir / "mcp-server").write_text(
            STUB_CAPTURE_SOURCE + RECORDED_REPLY + NEWLINE, encoding="utf-8"
        )

        result = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps"},
            telemetry_home=telemetry_home("granted"),
            clio="node", capture=capture, capture_dir=str(decoy_dir),
        )

        self.assertEqual(result.returncode, 0)
        # Give a decoy that WOULD have answered within the same grace period a real chance to be
        # captured before concluding it never ran.
        time.sleep(1.5)
        self.assertFalse(capture.exists(),
                         "a bare CLIO must never spawn with cwd left at the hook's own directory")

    def test_the_copilot_host_is_named_in_its_own_payload(self):
        # R7 names Copilot, and the mapping exists in the payload code with nothing driving it.
        session = str(uuid.uuid4())
        stub, capture = stub_clio()

        result = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=telemetry_home("granted"),
            clio=NODE, capture=capture, capture_dir=stub, host="copilot",
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(await_payloads(capture, 1)[0]["coding_agent"], "GitHub Copilot CLI")
        self.assertEqual(result.stdout, "", "Copilot has no routing channel this hook can use")

    def test_the_agents_own_telemetry_call_does_not_start_a_session(self):
        # `send-telemetry` is not advertised in tools/list, so the agent sends it through the executor
        # as `clio-run` with `command: "send-telemetry"`. The self-exclusion matched tool names only,
        # so a session whose sole clio interaction was its own telemetry marked itself touched, spent
        # its routing reminder on a telemetry call and opened a usage series.
        session = str(uuid.uuid4())
        stub, capture = stub_clio()

        result = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__clio-run",
                "tool_input": {"command": "send-telemetry", "args": {"event_name": "plan_approved"}},
                "cwd": _TMP,
            },
            telemetry_home=telemetry_home("granted"),
            clio=NODE, capture=capture, capture_dir=stub,
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "", "a telemetry call must not earn a routing reminder")
        self.assertEqual(settled_payloads(capture, 0), [], "and must not emit a floor of its own")
        self.assertFalse(Path(_TMP, "caadt-telemetry-routing", f"{session}.touched").exists())

    def test_stays_silent_on_a_later_read_only_call_in_the_same_turn(self):
        # Repeating the routing on every clio call would turn it into noise the model learns
        # to skip, and the floor is one event per session because it is the denominator.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        run_hook({"session_id": session, "tool_name": "mcp__clio__clio-run"}, telemetry_home=home)
        second = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-environments"},
            telemetry_home=home,
        )

        self.assertEqual(second.returncode, 0)
        self.assertEqual(second.stdout.strip(), "")

    def test_routes_again_on_the_first_write_of_the_session(self):
        # A measured run began with `list-environments` — a read-only inspection that
        # correctly reports nothing — so the session spent its only reminder there and the
        # mutating work that followed reported nothing at all. The first write gets its own
        # reminder even when this turn was already reminded.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-environments"},
            telemetry_home=home,
        )
        # Through the EXECUTOR, which is how clio mutations actually arrive: the server advertises
        # `clio-run`, `clio-run-destructive` and read-only tools, so the write verb is the `command`
        # argument, never the tool name. Judging the tool name alone classified a live column edit as
        # a read and the reminder never fired.
        write = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__clio-run",
                # Real host shape, captured from a live payload: `command` at the TOP level beside
                # the command's own `args`. Reading only the nested form classified every genuine
                # write as a read, so no write reminder ever fired.
                "tool_input": {"command": "modify-entity-schema-column", "args": {"environment-name": "x"}},
            },
            telemetry_home=home,
        )

        self.assertEqual(write.returncode, 0)
        self.assertIn(session, json.loads(write.stdout)["hookSpecificOutput"]["additionalContext"])

        # ...but only the FIRST write. A reminder per write would be noise again.
        second_write = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__clio-run",
                "tool_input": {"args": {"command": "update-page"}},
            },
            telemetry_home=home,
        )
        self.assertEqual(second_write.stdout.strip(), "")

    def test_a_read_through_the_executor_is_not_a_write(self):
        # The executor carries reads too — that is exactly why `clio-run` itself cannot be treated as
        # a write. A `get-` command must not consume the session's write reminder.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-environments"},
            telemetry_home=home,
        )
        read = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__clio-run",
                "tool_input": {"command": "get-entity-schema-properties", "args": {}},
            },
            telemetry_home=home,
        )

        self.assertEqual(read.stdout.strip(), "")

        # ...and the write that follows it still gets the reminder.
        write = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__clio-run",
                "tool_input": {"args": {"command": "create-page"}},
            },
            telemetry_home=home,
        )
        self.assertIn(session, json.loads(write.stdout)["hookSpecificOutput"]["additionalContext"])

    def test_says_nothing_on_stop(self):
        # Stop reports consumption as a side effect; it must not inject routing into a session that
        # is already finishing, and it must not speak to the user.
        session = str(uuid.uuid4())

        stop = run_hook(
            {
                "session_id": session,
                "hook_event_name": "Stop",
                "transcript_path": write_transcript(),
            },
            telemetry_home=telemetry_home("granted"),
        )

        self.assertEqual(stop.returncode, 0)
        self.assertEqual(stop.stdout.strip(), "")

    def test_does_not_repeat_the_same_totals(self):
        # Stop fires per RESPONSE, not per session, so it is reached many times. A turn that spent
        # nothing, or a Stop the host repeated, must not re-send an identical row into a series whose
        # only meaning is that it grows. `stop_hook_active` marks the host re-entering its own Stop.
        #
        # Run against a recording stub rather than the absent default: the dedup marker is written
        # only for a reading clio accepted, so asserting it after a failed send would have proved the
        # opposite of what this test is about.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        transcript = write_transcript()
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub}
        # Stop is scoped to sessions that used clio, so the session has to have done so.
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)

        first = run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": transcript},
            telemetry_home=home, **stubbed,
        )
        again = run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": transcript},
            telemetry_home=home, **stubbed,
        )
        reentered = run_hook(
            {
                "session_id": session,
                "hook_event_name": "Stop",
                "stop_hook_active": True,
                "transcript_path": write_transcript(),
            },
            telemetry_home=home, **stubbed,
        )

        for result in (first, again, reentered):
            self.assertEqual(result.returncode, 0)
        # The series carries exactly one reading: the repeats were skipped rather than re-sent. The
        # fixture totals 7 output tokens.
        readings = await_payloads(capture, 1, event_name="session_usage")
        self.assertEqual(len(readings), 1)
        self.assertEqual(readings[0]["output_tokens"], 7)

    def test_reports_again_once_the_session_has_spent_more(self):
        # The point of the series: a live session was measured freezing its total at the end of the
        # FIRST turn, because Stop was claimed once per session. Every later turn spent tokens that
        # nothing recorded. A grown total must produce a new reading.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub}
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)

        run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": write_transcript()},
            telemetry_home=home, **stubbed,
        )
        # A later turn: the transcript has grown by one more assistant reply.
        grown = Path(tempfile.mkdtemp(prefix="caadt-hook-grown-", dir=_TMP), "session.jsonl")
        grown.write_text(
            Path(write_transcript()).read_text(encoding="utf-8")
            + "\n"
            + json.dumps({"message": {"model": "claude-opus-5", "usage": {
                "input_tokens": 5, "output_tokens": 11, "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0}}}),
            encoding="utf-8",
        )
        later = run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": str(grown)},
            telemetry_home=home, **stubbed,
        )

        self.assertEqual(later.returncode, 0)
        readings = await_payloads(capture, 2, event_name="session_usage")
        self.assertEqual([reading["output_tokens"] for reading in readings], [7, 18],
                         "a grown total must be reported, or every turn after the first goes unmeasured")

    def test_an_unknown_usage_outcome_is_promoted_rather_than_retried(self):
        # `unknown` counts as delivered on the session_usage path, unlike on the floor path: a
        # duplicate reading in a series whose meaning is its maximum costs nothing, but re-sending
        # forever because an answer was merely unfamiliar would end the series at the attempt limit,
        # which costs the data. This exercises the branch directly: an opaque answer must resolve the
        # first reading (not retry it) and let a later, grown total report normally on top of it.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        opaque, capture = stub_clio(answers="opaque")
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": opaque}
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)

        transcript = write_transcript()
        run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": transcript},
            telemetry_home=home, **stubbed,
        )
        await_outcome(session, "usage")

        grown = Path(tempfile.mkdtemp(prefix="caadt-hook-unknown-usage-", dir=_TMP), "session.jsonl")
        grown.write_text(
            Path(transcript).read_text(encoding="utf-8")
            + "\n"
            + json.dumps({"message": {"model": "claude-opus-5", "usage": {
                "input_tokens": 5, "output_tokens": 11, "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0}}}),
            encoding="utf-8",
        )
        run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": str(grown)},
            telemetry_home=home, **stubbed,
        )

        readings = settled_payloads(capture, 2, event_name="session_usage")
        self.assertEqual([reading["output_tokens"] for reading in readings], [7, 18],
                         "an unfamiliar-but-complete answer must be promoted, not re-sent, and the "
                         "series must continue past it")

        await_outcome(session, "usage")
        # A third Stop on the SAME (grown) transcript: if the first reading's `unknown` outcome had
        # been read as a refusal instead of a promotion, the unconfirmed-attempt counter would carry
        # that failure forward and eventually end the series; promoting it resets the counter, so this
        # turn — carrying no new total — dispatches nothing further.
        run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": str(grown)},
            telemetry_home=home, **stubbed,
        )
        still = settled_payloads(capture, 2, event_name="session_usage")
        self.assertEqual(len(still), 2, "an unchanged total must not produce a third reading")

    def test_a_resolved_usage_reading_has_its_dispatch_files_removed(self):
        # resolveAndPromoteUsageState() calls removeDispatchFiles() once a pending usage reading
        # resolves, specifically so the nonce-keyed request/outcome pair is reclaimed promptly rather
        # than left for the weekly sweep. Every other test in this file only asserts on the payload
        # sent and the 'usage' marker's `output` field — nothing here has asserted the files
        # themselves are actually gone, so a regression that silently dropped or mis-keyed the
        # removeDispatchFiles() call would go unnoticed.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        stub, capture = stub_clio()
        stubbed = {"clio": NODE, "capture": capture, "capture_dir": stub}
        transcript = write_transcript()

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, **stubbed)
        run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": transcript},
            telemetry_home=home, **stubbed,
        )
        outcome = await_outcome(session, "usage")
        self.assertIn("recorded", outcome)
        state = Path(_TMP, "caadt-telemetry-routing")
        first_nonce_files = list(state.glob(f"{session}.usage-*-outcome"))
        self.assertEqual(len(first_nonce_files), 1,
                         "the first dispatch must have left exactly one outcome file behind")

        # A second Stop on the SAME transcript merely resolves the pending reading — it dispatches
        # nothing new — but resolveAndPromoteUsageState() runs on every Stop, so this is what triggers
        # the cleanup.
        run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": transcript},
            telemetry_home=home, **stubbed,
        )

        self.assertFalse(first_nonce_files[0].exists(),
                         "a resolved reading's outcome file must be removed, not left for the sweep")
        request_file = Path(str(first_nonce_files[0]).replace("-outcome", "-request"))
        self.assertFalse(request_file.exists(),
                         "a resolved reading's request file must be removed alongside its outcome")

    def test_stays_silent_on_stop_when_the_session_never_touched_clio(self):
        # `Stop` carries no tool name, so it cannot take the `mcp__.*clio.*` matcher its PostToolUse
        # sibling has. Without an explicit scope check, EVERY session on EVERY project would spawn a
        # clio MCP server each turn and report an unrelated session's token usage into Creatio
        # product telemetry, as soon as consent had been granted anywhere on the machine.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        result = run_hook(
            {
                "session_id": session,
                "hook_event_name": "Stop",
                "transcript_path": write_transcript(),
            },
            telemetry_home=home,
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")
        self.assertEqual(
            glob.glob(os.path.join(_TMP, "caadt-telemetry-routing", f"{session}.usage")),
            [],
            "a session that never called clio must not report consumption",
        )

    def test_floor_is_still_emitted_when_consent_arrives_later_in_the_session(self):
        # The floor claim used to be taken before the consent check, so a first clio call made while
        # consent was still `unknown` — the ordinary bootstrap case — burned the one-shot marker and
        # the "guaranteed" floor event was lost for the whole session, even after the developer said
        # yes moments later.
        session = str(uuid.uuid4())
        undecided = telemetry_home(None)
        granted = telemetry_home("granted")

        first = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps"}, telemetry_home=undecided
        )
        later = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__list-apps",
                "transcript_path": write_transcript(),
            },
            telemetry_home=granted,
        )

        self.assertEqual(first.stdout.strip(), "", "nothing is said while consent is unanswered")
        self.assertIn(
            session,
            json.loads(later.stdout)["hookSpecificOutput"]["additionalContext"],
            "the floor and its routing must still be available once consent is granted",
        )

    def test_floor_omits_token_counters_when_the_transcript_is_unreadable(self):
        # A row of zeros is indistinguishable from a session that genuinely spent nothing, which the
        # file's own comment says must be avoided — but only the Stop path was guarding it.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        result = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__list-apps",
                "transcript_path": os.path.join(_TMP, "caadt-absent-transcript.jsonl"),
                "cwd": _TMP,
            },
            telemetry_home=home,
            clio=CLIO or "caadt-no-such-clio",
        )

        self.assertEqual(result.returncode, 0)
        events = glob.glob(os.path.join(home, "events", "*.json"))
        if not events:
            self.skipTest("floor emission needs a real clio binary (CAADT_TEST_CLIO)")
        attributes = {
            item["key"]: next(iter(item["value"].values()))
            for item in json.loads(Path(events[0]).read_text(encoding="utf-8-sig"))["attributes"]
        }
        for field in ("input_tokens", "output_tokens", "cached_input_tokens"):
            self.assertNotIn(field, attributes)

    def test_reports_no_session_usage_without_a_readable_transcript(self):
        # A row of zeroes is indistinguishable from a session that genuinely spent nothing, and this
        # event exists only to carry the numbers — so with no transcript there is nothing to report.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        result = run_hook(
            {
                "session_id": session,
                "hook_event_name": "Stop",
                "transcript_path": os.path.join(_TMP, "caadt-no-such-transcript.jsonl"),
                "cwd": _TMP,
            },
            telemetry_home=home,
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(glob.glob(os.path.join(home, "events", "*.json")), [])

    def test_routes_again_after_a_new_user_prompt(self):
        # One session carries several runs. The routing is per turn, because the run it
        # describes is per request: a session whose reminder was spent on an earlier task left
        # the next task with neither a floor nor a reminder, and that task reported nothing.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        run_hook({"session_id": session, "tool_name": "mcp__clio__clio-run"}, telemetry_home=home)
        prompt = run_hook(
            {"session_id": session, "hook_event_name": "UserPromptSubmit"}, telemetry_home=home
        )
        after = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__clio-run"}, telemetry_home=home
        )

        # The prompt hook itself says nothing: at prompt time there is no way to know the turn
        # will touch Creatio, and routing injected into unrelated work is the noise above.
        self.assertEqual(prompt.returncode, 0)
        self.assertEqual(prompt.stdout.strip(), "")
        self.assertEqual(after.returncode, 0)
        self.assertIn(session, json.loads(after.stdout)["hookSpecificOutput"]["additionalContext"])

    def test_emits_nothing_at_all_without_stored_consent(self):
        # The decision is stored per installation, so a hook answering on the developer's
        # behalf would settle consent for every future session on the machine. Unknown and
        # denied are both silence — no event, no reminder, and above all no prompt.
        for consent in (None, "denied"):
            with self.subTest(consent=consent):
                result = run_hook(
                    {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__clio-run"},
                    telemetry_home=telemetry_home(consent),
                )

                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout.strip(), "")

    def test_still_routes_when_the_floor_emit_fails(self):
        # `clio` missing or broken must not swallow the routing: if the floor could not be
        # recorded, the agent's own stages are the only telemetry left, so it needs the
        # instructions more than ever.
        result = run_hook(
            {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__clio-run"},
            telemetry_home=telemetry_home("granted"),
            clio="caadt-definitely-not-a-real-binary",
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn("get-guidance name=product-telemetry", result.stdout)

    def test_ignores_non_clio_tools(self):
        result = run_hook(
            {"session_id": str(uuid.uuid4()), "tool_name": "Bash"},
            telemetry_home=telemetry_home("granted"),
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")

    def test_does_not_react_to_the_telemetry_tools_themselves(self):
        # Emitting a floor event in reaction to a telemetry call would recurse, and
        # reminding a session that is already sending telemetry is circular.
        result = run_hook(
            {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__send-telemetry"},
            telemetry_home=telemetry_home("granted"),
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")

    def test_does_nothing_without_a_session_id(self):
        # Without the host session id there is nothing to join the agent's stages to, and
        # the once-per-session guard has no key — emitting would risk one event per call.
        result = run_hook(
            {"tool_name": "mcp__clio__clio-run"}, telemetry_home=telemetry_home("granted")
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")

    def test_does_nothing_with_an_empty_conversation_id(self):
        # The Cursor fallback requires `conversation_id` to be a non-empty string after trimming, not
        # merely `typeof === 'string'` — an empty or whitespace-only value must be read exactly like a
        # payload with no session id at all, not as a session named "".
        for empty in ("", "   "):
            result = run_hook(
                {"conversation_id": empty, "tool_name": "mcp__clio__clio-run",
                 "hook_event_name": "afterMCPExecution"},
                telemetry_home=telemetry_home("granted"), host="cursor",
            )

            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(), "",
                             f"conversation_id={empty!r} must not be treated as a session id")

    def test_shapes_the_routing_per_host_and_stays_silent_where_it_cannot_speak(self):
        # Only the routing text is host-specific; the floor event is a side effect and
        # therefore identical everywhere. Cursor's afterMCPExecution is documented as
        # informational — it reaches neither the user nor the agent — so emitting anything
        # there would be stdout the host cannot use, and an unknown host gets silence rather
        # than a guessed shape.
        cases = {
            "claude": lambda out: json.loads(out)["hookSpecificOutput"]["additionalContext"],
            "codex": lambda out: json.loads(out)["systemMessage"],
        }
        for host, extract in cases.items():
            with self.subTest(host=host):
                result = run_hook(
                    {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__clio-run"},
                    telemetry_home=telemetry_home("granted"),
                    host=host,
                )

                self.assertEqual(result.returncode, 0)
                self.assertIn("get-guidance name=product-telemetry", extract(result.stdout))

        for host in ("cursor", "some-future-host"):
            with self.subTest(host=host):
                result = run_hook(
                    {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__clio-run"},
                    telemetry_home=telemetry_home("granted"),
                    host=host,
                )

                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout.strip(), "")

    def test_never_fails_the_tool_call_on_malformed_input(self):
        result = subprocess.run(
            [NODE, str(HOOK)],
            input="not json at all",
            capture_output=True,
            text=True,
            timeout=30,
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")


class TelemetryStateDirSecurityTests(unittest.TestCase):
    """Two security-relevant checks inside hooks/telemetry/state-dir.mjs that the full-hook
    black-box tests above never exercise directly: sanitizeSessionId()'s path-traversal
    allow-list, and assertStateDirIsOurs()'s ownership/symlink guard.

    The module split that created hooks/telemetry/state-dir.mjs is what makes this possible at
    all: these are now real importable functions rather than closures inside one 1400-line
    script, so a small Node probe script can call them directly instead of going through the
    full hook's stdin/stdout. Each probe runs in its OWN private temp root — never the suite's
    shared `_TMP` — so a deliberately hostile state directory here can never affect any other
    test's marker files.
    """

    def _run_probe(self, import_line: str, expression: str, tmp_root: str) -> dict:
        module = (ROOT / "hooks" / "telemetry" / "state-dir.mjs").as_uri()
        script = Path(tmp_root) / "probe.mjs"
        script.write_text(
            f"import {{ {import_line} }} from {json.dumps(module)};\n"
            f"process.stdout.write(JSON.stringify({expression}));\n",
            encoding="utf-8",
        )
        result = subprocess.run(
            [NODE, str(script)],
            capture_output=True,
            text=True,
            timeout=30,
            env={**_base_env(), "TMPDIR": tmp_root, "TMP": tmp_root, "TEMP": tmp_root},
        )
        self.assertEqual(result.stderr, "", result.stderr)
        return json.loads(result.stdout)

    def test_sanitize_session_id_strips_path_traversal_and_stays_inside_the_state_dir(self):
        # markerPath() and transcriptPath() both interpolate sanitizeSessionId()'s output
        # straight into a filesystem path with no further check, so the allow-list IS the
        # entire defense against an attacker-controlled session_id escaping the state
        # directory. Pure functions, no filesystem writes, so this needs no isolated tmp root.
        if not NODE:
            self.skipTest("node not available")
        attempts = [
            "normal-session-id",
            "../../etc/passwd",
            "..\\..\\windows\\system32",
            "C:\\Users\\someone\\session",
            "\\\\server\\share\\session",
            "a/b/../../../c",
        ]
        script = Path(tempfile.mkdtemp(prefix="caadt-sanitize-test-", dir=_TMP)) / "probe.mjs"
        module = (ROOT / "hooks" / "telemetry" / "state-dir.mjs").as_uri()
        attempts_literal = json.dumps(attempts)
        script.write_text(
            f"import {{ markerPath }} from {json.dumps(module)};\n"
            "import path from 'node:path';\n"
            f"const ids = {attempts_literal};\n"
            "process.stdout.write(JSON.stringify(ids.map(id => {\n"
            "  const full = markerPath(id, 'scan');\n"
            "  return { dir: path.dirname(full), base: path.basename(full) };\n"
            "})));\n",
            encoding="utf-8",
        )
        result = subprocess.run(
            [NODE, str(script)], capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.stderr, "", result.stderr)
        entries = json.loads(result.stdout)
        # Every id, however hostile, resolves inside the SAME single directory — none of them
        # produced a `..` or a path separator that escaped markerPath()'s own path.join.
        dirs = {entry["dir"] for entry in entries}
        self.assertEqual(len(dirs), 1, entries)
        for entry in entries:
            self.assertNotIn("..", entry["base"], entry)
            self.assertNotIn("/", entry["base"], entry)
            self.assertNotIn("\\", entry["base"], entry)

    def test_a_symlinked_state_directory_is_rejected(self):
        # The exact TOCTOU gap the comment above stateDir()'s mkdirSync call describes: a
        # symlink pre-planted at the predictable state-dir path must not be silently followed
        # and used. Checked on every OS, including Windows, which is why this does not skip
        # where process.getuid is unavailable — see the POSIX-only mode test below for the half
        # that does.
        if not NODE:
            self.skipTest("node not available")
        tmp_root = tempfile.mkdtemp(prefix="caadt-symlink-test-")
        elsewhere = tempfile.mkdtemp(prefix="caadt-symlink-target-")
        state_dir = Path(tmp_root) / "caadt-telemetry-routing"
        try:
            state_dir.symlink_to(elsewhere, target_is_directory=True)
        except OSError:
            self.skipTest("cannot create a directory symlink in this environment")
        result = self._run_probe("ensureStateDir", "{ ok: ensureStateDir() }", tmp_root)
        self.assertEqual(result, {"ok": False})

    def test_a_wrongly_permissioned_state_directory_is_rejected_on_posix(self):
        # The POSIX-only half: process.getuid is unavailable on Windows, so this half of
        # assertStateDirIsOurs() cannot run there by design — the symlink check above is what
        # covers Windows instead.
        if os.name != "posix":
            self.skipTest("POSIX-only: process.getuid is unavailable on Windows")
        if not NODE:
            self.skipTest("node not available")
        tmp_root = tempfile.mkdtemp(prefix="caadt-mode-test-")
        state_dir = Path(tmp_root) / "caadt-telemetry-routing"
        state_dir.mkdir()
        os.chmod(state_dir, 0o755)  # too permissive; stateDir() itself requests 0o700
        result = self._run_probe("ensureStateDir", "{ ok: ensureStateDir() }", tmp_root)
        self.assertEqual(result, {"ok": False})


class ConsentTelemetryHomeFallbackTests(unittest.TestCase):
    """telemetryHome()'s no-override fallback, per platform — regression coverage for a bug
    raised in review of PR #96: with neither CLIO_TELEMETRY_HOME nor CLIO_HOME set, the fallback
    used to join clio's storage suffix onto a Windows-shaped `.../AppData/Local` path even on
    macOS/Linux, where clio's own ClioRuntimePaths.Home resolves to `~/creatio/clio` instead —
    silently and permanently making consentGranted() return false there. `process.platform` is
    overridden inside the probe script (Node allows redefining it) so both branches are exercised
    regardless of which OS actually runs this test.
    """

    def _resolved_home(self, platform: str, env_overrides: dict) -> str:
        if not NODE:
            self.skipTest("node not available")
        tmp_root = tempfile.mkdtemp(prefix="caadt-consent-home-test-")
        module = (ROOT / "hooks" / "telemetry" / "consent.mjs").as_uri()
        script = Path(tmp_root) / "probe.mjs"
        script.write_text(
            f"Object.defineProperty(process, 'platform', {{ value: {json.dumps(platform)} }});\n"
            f"const {{ telemetryHome }} = await import({json.dumps(module)});\n"
            "process.stdout.write(telemetryHome());\n",
            encoding="utf-8",
        )
        env = {**_base_env(), "TMPDIR": tmp_root, "TMP": tmp_root, "TEMP": tmp_root, **env_overrides}
        for key in ("CLIO_TELEMETRY_HOME", "CLIO_HOME", "LOCALAPPDATA"):
            env.pop(key, None)
        result = subprocess.run([NODE, str(script)], capture_output=True, text=True, timeout=30, env=env)
        self.assertEqual(result.stderr, "", result.stderr)
        return result.stdout

    def test_posix_fallback_matches_clios_own_home_not_a_windows_shaped_path(self):
        # Compared with slashes normalized: this test suite runs on Windows too, where Node's
        # `path.join` (bound to the REAL host OS, not the spoofed `process.platform`) renders
        # every separator as `\`, including the leading one in the POSIX-shaped `HOME` this test
        # feeds in. What matters here is which BASE directory `telemetryHome()` chose — `HOME`
        # alone, not `HOME/AppData/Local` — not which separator character rendered it.
        home = self._resolved_home("linux", {"HOME": "/home/dev", "USERPROFILE": "/home/dev"})
        self.assertEqual(home.replace("\\", "/"), "/home/dev/creatio/clio/telemetry")

    def test_macos_fallback_matches_clios_own_home_too(self):
        home = self._resolved_home("darwin", {"HOME": "/Users/dev", "USERPROFILE": "/Users/dev"})
        self.assertEqual(home.replace("\\", "/"), "/Users/dev/creatio/clio/telemetry")

    def test_windows_fallback_still_uses_local_app_data(self):
        home = self._resolved_home(
            "win32", {"LOCALAPPDATA": "C:\\Users\\dev\\AppData\\Local",
                      "HOME": "C:\\Users\\dev", "USERPROFILE": "C:\\Users\\dev"})
        self.assertEqual(
            home.replace("\\", "/"), "C:/Users/dev/AppData/Local/creatio/clio/telemetry")


class CursorTelemetryHookWiringTests(unittest.TestCase):
    """Cursor is the one host whose hook config the installer can write itself."""

    def setUp(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "caadt_installer", ROOT / "installer" / "install.py"
        )
        self.installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.installer)

    def test_registers_the_floor_hook_on_after_mcp_execution(self):
        cursor_home = Path(tempfile.mkdtemp(prefix="caadt-cursor-", dir=_TMP))
        plugin_dir = cursor_home / "plugins" / "local" / "toolkit"

        self.installer.merge_cursor_telemetry_hook(cursor_home, plugin_dir)

        config = json.loads((cursor_home / "hooks.json").read_text(encoding="utf-8"))
        entries = config["hooks"]["afterMCPExecution"]
        self.assertEqual(len(entries), 1)
        self.assertIn("telemetry-routing.mjs", entries[0]["command"])
        # The host must be declared, or the hook would emit Claude-shaped stdout into a
        # host that cannot read it.
        self.assertEqual(entries[0]["env"]["CAADT_TELEMETRY_HOOK_HOST"], "cursor")

    def test_preserves_other_hooks_and_does_not_duplicate_itself(self):
        # A reinstall must not stack copies of our entry, and must never drop a hook the
        # developer added themselves.
        cursor_home = Path(tempfile.mkdtemp(prefix="caadt-cursor-", dir=_TMP))
        (cursor_home / "hooks.json").write_text(
            json.dumps({
                "version": 1,
                "hooks": {
                    "afterMCPExecution": [{"command": "node ./their-own-audit.js"}],
                    "beforeShellExecution": [{"command": "node ./their-guard.js"}],
                },
            }),
            encoding="utf-8",
        )

        self.installer.merge_cursor_telemetry_hook(cursor_home, cursor_home / "plugin")
        self.installer.merge_cursor_telemetry_hook(cursor_home, cursor_home / "plugin")

        config = json.loads((cursor_home / "hooks.json").read_text(encoding="utf-8"))
        commands = [entry["command"] for entry in config["hooks"]["afterMCPExecution"]]
        self.assertEqual(sum("telemetry-routing.mjs" in c for c in commands), 1)
        self.assertIn("node ./their-own-audit.js", commands)
        self.assertIn("beforeShellExecution", config["hooks"])

    def test_leaves_a_broken_hooks_file_untouched(self):
        # A hand-broken hooks.json is the developer's file. Replacing it with our single
        # entry would delete configuration we cannot read but they can still fix.
        cursor_home = Path(tempfile.mkdtemp(prefix="caadt-cursor-", dir=_TMP))
        broken = '{"hooks": {"afterMCPExecution": [  // trailing comment\n'
        (cursor_home / "hooks.json").write_text(broken, encoding="utf-8")

        self.installer.merge_cursor_telemetry_hook(cursor_home, cursor_home / "plugin")

        self.assertEqual((cursor_home / "hooks.json").read_text(encoding="utf-8"), broken)


class TelemetryDispatchRealClioResponseFixtureTests(unittest.TestCase):
    """Replays a BYTE-FOR-BYTE response actually written by a real, currently-installed clio
    (8.1.0.112, on PATH, captured 2026-08-26 by piping dispatch.mjs's own initialize +
    notifications/initialized + tools/call batch into `clio mcp-server` and recording stdout — not
    hand-authored) through `readOutcome()`'s real marker-file path, unconditionally in every CI
    run. This is deliberately NOT the same gap `TelemetryRoutingHookFloorEmissionTests` below is
    gated on: that class needs a clio that ACCEPTS the new `workflow` field, which no released
    build does yet, so it stays skipped without `CAADT_TEST_CLIO`. Outcome PARSING needs no such
    thing — a real REJECTION is just as real a wire shape as a real acceptance, and one is
    capturable today. What this closes: every other outcome-parsing assertion in this file feeds
    `readOutcome()` a hand-built stub answer, so a real clio writing its status inside
    `content[0].text` as an escaped JSON string (`\\"status\\":\\"rejected\\"`) rather than in
    `structuredContent`, or wrapping it in the `_meta.clio-run` envelope, or interleaving it after
    an id:1 `initialize` response in the same stream, was never actually exercised end-to-end
    against bytes clio itself produced. There is currently no way to also capture a real
    `'recorded'` response the same way, since doing that needs the not-yet-released vocabulary
    support tracked by clio#1081 / ENG-92551 — that half stays covered only by the hand-built
    stubs above, same as before.
    """

    # Two JSON-RPC response lines, verbatim, as clio 8.1.0.112 wrote them to stdout for the exact
    # batch `emitEvent()` sends (id:1 initialize, id:2 tools/call — notifications/initialized gets
    # no reply). Kept as one literal block rather than reconstructed field-by-field, because the
    # whole point is testing against what clio ACTUALLY wrote, not this test's idea of its shape.
    REAL_CLIO_RESPONSE = (
        '{"result":{"protocolVersion":"2024-11-05","capabilities":{"logging":{},"prompts":'
        '{"listChanged":true},"resources":{"listChanged":true},"tools":{"listChanged":true}},'
        '"serverInfo":{"name":"clio","version":"8.1.0.112"},"instructions":"clio is the CLI '
        '+ MCP server for the Creatio low-code platform."},"id":1,"jsonrpc":"2.0"}\n'
        '{"result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"status\\":'
        '\\"rejected\\",\\"error\\":{\\"code\\":\\"unsupported-fields\\",\\"message\\":'
        '\\"Unsupported telemetry fields: workflow.\\"}}"}],"_meta":{"clio-run":'
        '{"dispatchedTool":"send-telemetry","destructive":false}}},"id":2,"jsonrpc":"2.0"}\n'
    )

    def test_a_real_captured_rejection_reads_as_rejected_not_unknown(self):
        if not NODE:
            self.skipTest("node not available")
        tmp_root = tempfile.mkdtemp(prefix="caadt-real-outcome-fixture-", dir=_TMP)
        session = str(uuid.uuid4())
        outcome_module = (ROOT / "hooks" / "telemetry" / "dispatch.mjs").as_uri()
        marker_module = (ROOT / "hooks" / "telemetry" / "state-dir.mjs").as_uri()
        script = Path(tmp_root) / "probe.mjs"
        script.write_text(
            f"import {{ readOutcome }} from {json.dumps(outcome_module)};\n"
            f"import {{ markerPath, ensureStateDir }} from {json.dumps(marker_module)};\n"
            "import fs from 'node:fs';\n"
            f"const sessionId = {json.dumps(session)};\n"
            "ensureStateDir();\n"
            "fs.writeFileSync(markerPath(sessionId, 'floor-fixture-outcome'), "
            f"{json.dumps(self.REAL_CLIO_RESPONSE)});\n"
            "process.stdout.write(readOutcome(sessionId, 'floor', 'fixture'));\n",
            encoding="utf-8",
        )
        result = subprocess.run(
            [NODE, str(script)],
            capture_output=True,
            text=True,
            timeout=30,
            env={**_base_env(), "TMPDIR": tmp_root, "TMP": tmp_root, "TEMP": tmp_root},
        )
        self.assertEqual(result.stderr, "", result.stderr)
        # A false 'unknown' here would send this exact real-world response to the substring
        # fallback instead of the structured-status parse — the bug class this fixture exists to
        # catch. A false 'recorded' would keep the floor claim consumed after clio genuinely
        # refused it, silently losing the one event this whole file exists to guarantee.
        self.assertEqual(result.stdout.strip(), "rejected")


@unittest.skipIf(NODE is None or CLIO is None, "node and clio are both required")
class TelemetryRoutingHookFloorEmissionTests(unittest.TestCase):
    """The floor is the whole point: it must actually reach clio, not just be described.

    Gated on a real `CAADT_TEST_CLIO` binary, and so skipped by default, ONLY because these two
    tests check that a live clio actually accepts the new flow-agnostic vocabulary
    (`workflow_started`, `session_usage`) into its allow-list — something no stub can answer, and
    something today's released clio does not yet do (see docs/telemetry-transport-decision.md and
    clio#1081/ENG-92551). What is NOT gated behind a real binary, and runs unconditionally in
    every default CI run via `TelemetryRoutingHookBehaviorTests` above, is the exactly-once
    claim/release and retry-on-refusal state machine this vocabulary rides on: see in particular
    `test_a_clio_that_never_records_stops_being_retried` (retry-on-refusal, bounded by
    FLOOR_ATTEMPT_LIMIT) and `test_parallel_hook_processes_emit_one_floor_between_them` (claim
    exclusivity across concurrent hook processes) — both exercised with a fake stub `clio`, no
    live binary required.
    """

    def test_records_an_unattributed_session_start_through_clio(self):
        # End to end against the real clio, writing into a throwaway telemetry home. This is
        # what makes the floor a floor rather than a comment: with a skill loaded the agent
        # reports the full funnel, but a skill-less run was measured reporting nothing, and
        # this event is what remains countable in that case.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        result = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__clio-run",
                "transcript_path": write_transcript(),
            },
            telemetry_home=home,
            clio=CLIO,
        )

        self.assertEqual(result.returncode, 0)
        events = glob.glob(os.path.join(home, "events", "*.json"))
        self.assertEqual(len(events), 1, f"expected exactly one floor event, got {events}")
        stored = json.loads(Path(events[0]).read_text(encoding="utf-8-sig"))
        attributes = {
            item["key"]: next(iter(item["value"].values())) for item in stored["attributes"]
        }
        self.assertEqual(stored["event_name"], "workflow_started")
        self.assertEqual(attributes["session_id"], session)
        # Model and the token counters come from the host's own session transcript, which the
        # payload points at. Only output accumulates: `input_tokens` and the cache fields are the
        # size of the LAST request, because each turn re-sends the whole context and re-reports it
        # — summing them grew quadratically and produced a cached total of 157,881,680 for one real
        # session. The fixture's two turns are 10/20 input and 500+100 / 600+0 cache.
        self.assertEqual(attributes["model"], "claude-opus-5")
        self.assertEqual(int(attributes["input_tokens"]), 20)
        self.assertEqual(int(attributes["output_tokens"]), 7)
        self.assertEqual(int(attributes["cached_input_tokens"]), 600)
        # `unattributed` is reserved for exactly this: a hook sees a tool name, not a
        # workflow, so a real-looking value would be a guess presented as data — and an
        # omitted one would break the contract's own "always send workflow" rule.
        self.assertEqual(attributes["workflow"], "unattributed")

        # The routing recurs (per turn, and on the first write) but the floor must NOT. A second
        # floor event would inflate the very session count the floor exists to provide, so these
        # later calls may speak and must not emit.
        for later in ("mcp__clio__update-entity-schema", "mcp__clio__update-page"):
            run_hook(
                {"session_id": session, "tool_name": later, "transcript_path": write_transcript()},
                telemetry_home=home,
                clio=CLIO,
            )
        run_hook({"session_id": session, "hook_event_name": "UserPromptSubmit"}, telemetry_home=home)
        run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__clio-run",
                "transcript_path": write_transcript(),
            },
            telemetry_home=home,
            clio=CLIO,
        )
        events = glob.glob(os.path.join(home, "events", "*.json"))
        self.assertEqual(len(events), 1, f"floor must stay once per session, got {events}")

    def test_records_the_sessions_consumption_through_clio(self):
        # End to end against the real clio: `session_usage` must be in its allow-list, or the one event
        # that carries real token totals is rejected and the numbers exist nowhere. Measured: across 52
        # agent-emitted events, zero carried a counter — an agent cannot see its own running totals.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"}, telemetry_home=home)

        result = run_hook(
            {
                "session_id": session,
                "hook_event_name": "Stop",
                "transcript_path": write_transcript(),
            },
            telemetry_home=home,
            clio=CLIO,
        )

        self.assertEqual(result.returncode, 0)
        events = glob.glob(os.path.join(home, "events", "*.json"))
        self.assertEqual(len(events), 1, f"expected exactly one session measurement, got {events}")
        stored = json.loads(Path(events[0]).read_text(encoding="utf-8-sig"))
        attributes = {
            item["key"]: next(iter(item["value"].values())) for item in stored["attributes"]
        }
        self.assertEqual(stored["event_name"], "session_usage")
        # Output is summed across the session's turns; input and cache are the latest reading.
        self.assertEqual(int(attributes["input_tokens"]), 20)
        self.assertEqual(int(attributes["output_tokens"]), 7)
        self.assertEqual(int(attributes["cached_input_tokens"]), 600)
        self.assertEqual(attributes["model"], "claude-opus-5")
        # Session-scoped, so it carries the same reserved value as the floor: it reports on the whole
        # session and belongs to no single flow.
        self.assertEqual(attributes["workflow"], "unattributed")


if __name__ == "__main__":
    unittest.main()


def tearDownModule():
    """Remove the shared temp root.

    Every test in this module shares `_TMP`, and nothing removed it — so each run left session
    markers and captured payloads behind. Shared state that outlives a run is what hid the
    fresh-state-directory bug once already.
    """
    shutil.rmtree(_TMP, ignore_errors=True)
