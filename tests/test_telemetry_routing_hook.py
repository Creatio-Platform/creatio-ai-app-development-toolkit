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
    "fs.appendFileSync(process.env.CAADT_STUB_CAPTURE, fs.readFileSync(0, 'utf8'));",
]) + NEWLINE
# `emitEvent` looks for the substring "recorded" in RAW stdout, so the status has to appear
# unescaped. Nesting it inside a JSON-encoded text block yields (backslash-quote)recorded and
# would make the stub look like a rejection - which it silently did until this was checked.
RECORDED_REPLY = "process.stdout.write(JSON.stringify({result:{structuredContent:{success:true,status:'recorded'}}}));"

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
):
    """Invoke the hook exactly as Claude Code does: JSON on stdin, JSON on stdout.

    `telemetry_home` redirects clio's telemetry storage, so a test controls the consent
    state and can never read or write the developer's real telemetry. `clio` defaults to a
    name that does not exist, which exercises the floor-emit failure path without spawning
    anything; the integration test below points it at the real binary.
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
        },
    )


def stub_clio(*, succeeds: bool = True) -> "tuple[str, Path]":
    """A stand-in for the clio binary that captures what the hook actually sends.

    The suite could assert only that the hook survives a MISSING clio: the default
    `caadt-no-such-clio` exercises the emit path solely as a failure, so the payload — the thing
    that decides whether an event is accepted at all — was asserted nowhere, and three defects
    reached a live stand through a green suite (`plugin_version=unknown`, one host's name reported
    for every host, and a `<synthetic>` model that made clio reject the whole floor event).

    The hook spawns `<clio> mcp-server`, so a file literally named `mcp-server` beside a `node`
    executable is a stub on every platform, with no shell and no real binary: `CAADT_TELEMETRY_CLIO`
    becomes `node`, and node runs an extension-less file as CommonJS.
    """
    directory = Path(tempfile.mkdtemp(prefix="caadt-stub-clio-", dir=_TMP))
    capture = directory / "captured.jsonl"
    # `emitEvent` counts a send as delivered when stdout contains `"recorded"`, which is what clio
    # answers; a stub that prints nothing reproduces a rejection without restating clio's error shape.
    reply = (
        RECORDED_REPLY if succeeds else 'process.stdout.write("");'
    )
    (directory / "mcp-server").write_text(
        STUB_CAPTURE_SOURCE + reply + NEWLINE, encoding="utf-8"
    )
    return str(directory), capture


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
        floor = sent_payloads(capture)
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
        self.assertEqual(sent_payloads(capture)[0]["coding_agent"], "Cursor")

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
        floor = sent_payloads(capture)[0]
        # The last REAL model survives instead of being overwritten by the unusable one, and nothing
        # outside clio's token shape is ever sent.
        self.assertEqual(floor["model"], "claude-opus-5")
        self.assertNotIn("<", floor["model"])

    def test_a_failed_floor_emit_is_retried_on_the_next_clio_call(self):
        # The claim is taken before the emit, so a rejected send used to spend the one marker that
        # allows the floor and lose it permanently — the same failure mode the consent check above
        # already guards against.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        failing, _ = stub_clio(succeeds=False)
        recording, capture = stub_clio()

        rejected = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=home, clio=NODE, capture_dir=failing,
        )
        retried = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
            telemetry_home=home, clio=NODE, capture=capture, capture_dir=recording,
        )

        for result in (rejected, retried):
            self.assertEqual(result.returncode, 0)
        floor = [p for p in sent_payloads(capture) if p["event_name"] == "workflow_started"]
        self.assertEqual(len(floor), 1, "the floor must be re-attempted after a send that stored nothing")

    def test_a_clio_that_never_records_stops_being_retried(self):
        # Retrying without end would buy a process spawn on every tool call of the session.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        failing, capture = stub_clio(succeeds=False)

        for _ in range(5):
            result = run_hook(
                {"session_id": session, "tool_name": "mcp__clio__list-apps", "cwd": _TMP},
                telemetry_home=home, clio=NODE, capture=capture, capture_dir=failing,
            )
            self.assertEqual(result.returncode, 0)

        attempts = [p for p in sent_payloads(capture) if p["event_name"] == "workflow_started"]
        self.assertEqual(len(attempts), 3, "bounded by FLOOR_ATTEMPT_LIMIT")

    def test_a_rejected_reading_is_not_recorded_as_reported(self):
        # Marking a rejected send as delivered hides the failure behind a series that merely looks
        # sparse, and a persistently rejected field would end the series in silence.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")
        failing, _ = stub_clio(succeeds=False)
        transcript = write_transcript()

        run_hook({"session_id": session, "tool_name": "mcp__clio__list-apps"},
                 telemetry_home=home, clio=NODE, capture_dir=failing)
        run_hook(
            {"session_id": session, "hook_event_name": "Stop", "transcript_path": transcript},
            telemetry_home=home, clio=NODE, capture_dir=failing,
        )

        self.assertFalse(
            Path(_TMP, "caadt-telemetry-routing", f"{session}.usage").exists(),
            "a reading clio did not accept must be retried, not remembered as sent",
        )

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
        # The marker carries the last reported figure and the transcript size it was read at, so an
        # unchanged total is skipped rather than re-sent. The fixture totals 7 output tokens.
        marker = Path(_TMP, "caadt-telemetry-routing", f"{session}.usage")
        self.assertEqual(json.loads(marker.read_text(encoding="utf-8"))["output"], 7)
        # And the series itself carries exactly one reading, which is the claim the marker stands for.
        readings = [p for p in sent_payloads(capture) if p["event_name"] == "session_usage"]
        self.assertEqual(len(readings), 1)

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
        marker = Path(_TMP, "caadt-telemetry-routing", f"{session}.usage")
        self.assertEqual(json.loads(marker.read_text(encoding="utf-8"))["output"], 18,
                         "a grown total must be reported, or every turn after the first goes unmeasured")

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


@unittest.skipIf(NODE is None or CLIO is None, "node and clio are both required")
class TelemetryRoutingHookFloorEmissionTests(unittest.TestCase):
    """The floor is the whole point: it must actually reach clio, not just be described."""

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
