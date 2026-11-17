"""The mobile business-logic flow must stay usable by a developer who has only the public surface.

A partner has clio, the clio MCP server, this toolkit and the ``@creatio/mobile-common`` npm package.
The rules below are pinned because breaking any of them is silent for CI and fatal on the device:

1. The preflight reads tool availability from ``get-tool-contract`` and stops with a remedy the user
   can act on, for clio and for the local Node.js toolchain alike.

2. Nothing is generated before Gate L and nothing is written to Creatio before Gate D.

3. The project layout keeps the settings the Mobile app's script runtime requires. A module that
   bundles the SDK, minifies class names or ships a second script loads wrongly or not at all, and
   the build stays green.

4. The references never send the agent to sources a partner cannot read, and never offer the web
   SDK as an import.

5. The surfaces that describe mobile pages route a request for code to the flow's runbook.

6. The module is exercised before it is delivered. A compile and a build pass without one line of
   the module running, and the developer checks by hand on a phone with no debugger, so a logic
   error that reaches the device costs a blind redelivery.

7. The delivery plan tells the developer what cannot be taken back, and the script is staged
   before that plan is shown, so the plan describes the file that is pushed.

8. The sample behaviour check is a program an agent copies and adapts, so it must run as printed:
   pass on a module that follows its table and fail on one that does not.

9. A step the flow tells the agent to run before a gate is not on that gate's forbidden list, and
   every example names a handler the way the naming rule says.

10. What a module keeps in memory is described as it behaves on a device: one value for the whole
    app, alive until the app restarts, and unknown to a virtual data source's page. A module built
    on the opposite belief shows one record's data on another record.

11. A module delivered into a package the environment already has is not described as a script-only
    delivery: the staged script does not survive a restore, a package with a C# project is compiled,
    and a compilation that fails after the installation is not a failed delivery.

12. The plan that names what the user sees is written with the UI rules already loaded.

13. The flow has one entry point. The app orchestrator's description attracts a request for mobile
    logic, its load order and core rules name the runbook, and no second skill claims the flow.
"""

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# The flow belongs to the app orchestrator: one runbook owns the process, three context files the
# reference material.
ORCHESTRATOR = ROOT / "skills/creatio-app-orchestrator/SKILL.md"
RUNBOOK_PATH = "runbooks/04-mobile-business-logic.md"
RUNBOOK = ROOT / RUNBOOK_PATH
LAYOUT = ROOT / "context/mobile-module-project-layout.md"
SDK_GUIDE = ROOT / "context/mobile-sdk-guide.md"
BEHAVIOUR_CHECK = ROOT / "context/mobile-module-behaviour-check.md"
DOCUMENTS = (RUNBOOK, LAYOUT, SDK_GUIDE, BEHAVIOUR_CHECK)

MODULE_BUNDLE = ROOT / "tests/fixtures/mobile_remote_module_bundle.js"
# The same handler registration with the rule removed: every save is passed on unchanged.
PASS_THROUGH_BUNDLE = """(() => {
	class Guard extends crtSdk.BaseRequestHandler {
		async handle(request) { return this.next?.handle(request); }
	}
	crtSdk.CrtRequestHandler({ requestType: 'crt.SaveRecordRequest', type: 'usr.CarVinSaveGuard' })(Guard);
})();
"""
NODE = shutil.which("node")

# Paths and tools that exist only next to the Mobile app's own sources or need its debug build.
INTERNAL_ONLY_MARKERS = (
    "flutter_creatio",
    "ts_sdk_template_module",
    "creatio-mobile-config.json",
    "inject-on-device",
    "update-source-code",
    "chrome://inspect",
    "excluded-modules",
)


def read(path):
    return path.read_text(encoding="utf-8")


def fenced_blocks(text, language):
    return re.findall(r"```%s\n(.*?)```" % language, text, re.DOTALL)


class MobileBusinessLogicDocsTests(unittest.TestCase):

    def test_preflight_decides_availability_from_the_tool_contract_not_tools_list(self):
        preflight = read(RUNBOOK).split("## Load order", 1)[0]
        self.assertIn("get-tool-contract", preflight)
        self.assertRegex(
            preflight, r"NOT the\s+server's `tools/list`",
            "the workspace and package-file tools are long-tail tools: a preflight that reads the "
            "server's tool list reports every clio as missing them")
        for tool in ("push-workspace", "get-package-file", "update-page", "get-request-info"):
            self.assertIn(tool, preflight, "the preflight must check for `%s`" % tool)

    def test_each_failed_preflight_check_stops_with_a_remedy(self):
        preflight = read(RUNBOOK).split("## Load order", 1)[0]
        self.assertIn(
            "dotnet tool update clio -g", preflight,
            "a clio without the delivery tools must be answered with the command that updates it")
        self.assertIn(
            "Node.js 20 or newer", preflight,
            "the build toolchain requirement must be stated with its version floor")
        self.assertIn(
            "Never install or upgrade Node.js yourself", preflight,
            "the toolkit never changes the developer's machine toolchain on its own")

    def test_both_gates_are_declared_with_what_they_forbid(self):
        orchestrator = read(ORCHESTRATOR)
        playbook = read(RUNBOOK)
        for gate in ("Gate L", "Gate D"):
            self.assertIn(gate, orchestrator, "the entry point names %s" % gate)
            self.assertIn("## %s" % gate, playbook, "the runbook owns the rules of %s" % gate)
        gate_l = playbook.split("## Gate L", 1)[1].split("\n## ", 1)[0]
        gate_d = playbook.split("## Gate D", 1)[1].split("\n## ", 1)[0]
        self.assertIn("Forbidden until approved", gate_l)
        self.assertIn("writing module code", gate_l)
        self.assertIn("Forbidden until approved", gate_d)
        for write in ("push-workspace", "update-page"):
            self.assertIn(
                write, gate_d, "`%s` writes to the environment and must wait for Gate D" % write)
        self.assertIn("The initial request is NOT approval", playbook)

    def test_a_step_that_precedes_gate_d_is_not_forbidden_by_it(self):
        playbook = read(RUNBOOK)
        before_gate_d = playbook.split("### 5.", 1)[1].split("### 8. Present the delivery plan", 1)[0]
        self.assertIn(
            "restore-workspace", before_gate_d,
            "an existing package is brought into the workspace before the script is staged")
        forbidden = playbook.split("## Gate D", 1)[1].split("**Forbidden until approved:**", 1)[1]
        forbidden = forbidden.split(".", 1)[0]
        self.assertNotIn(
            "restore-workspace", forbidden,
            "the flow runs `restore-workspace` before Gate D, so Gate D cannot forbid it: the agent "
            "would have to break the gate or push a stale copy of the package")

    def test_examples_name_handlers_and_requests_as_the_naming_rule_says(self):
        self.assertRegex(
            read(RUNBOOK), r"literal `usr\.` followed by a\s+PascalCase name",
            "the playbook owns the naming rule for handler and request types")
        for path in DOCUMENTS:
            self.assertNotRegex(
                read(path), r"usr\.Usr[A-Z]",
                "%s names a type with the schema prefix after `usr.`; the rule is `usr.` plus a "
                "PascalCase name" % path.name)

    def test_the_run_is_not_reported_as_working_without_a_device_check(self):
        self.assertIn("not yet confirmed on a device", read(RUNBOOK))
        self.assertIn("A green build is not a working feature", read(RUNBOOK))

    def test_project_layout_keeps_what_the_script_runtime_requires(self):
        layout = read(LAYOUT)
        webpack = "\n".join(fenced_blocks(layout, "js"))
        self.assertIn(
            "'@creatio/mobile-common': 'crtSdk'", webpack,
            "the SDK is provided by the app as the global crtSdk and must stay external")
        self.assertIn("iife: true", webpack)
        self.assertIn("filename: 'main.js'", webpack)
        self.assertIn(
            "mode: 'development'", webpack,
            "the SDK keys modules by class name, so the bundle must not be minified")
        tsconfig = "\n".join(fenced_blocks(layout, "json"))
        self.assertIn('"experimentalDecorators": true', tsconfig)
        self.assertIn('"emitDecoratorMetadata": true', tsconfig)
        self.assertNotIn('"dom"', tsconfig, "the script runtime has no DOM")
        self.assertNotIn(
            '"@creatio/mobile-common": "latest"', layout,
            "the SDK dependency must be pinned: the running SDK is the one inside the app")

    def test_only_one_script_is_delivered(self):
        playbook = read(RUNBOOK)
        self.assertIn("Files/src/mobile/<ModuleName>/main.js", playbook)
        self.assertIn(
            "Copy that one file only", playbook,
            "the device evaluates every script in the module folder")

    def test_references_do_not_point_at_sources_a_partner_cannot_reach(self):
        for path in DOCUMENTS:
            text = read(path)
            for marker in INTERNAL_ONLY_MARKERS:
                self.assertNotIn(
                    marker, text,
                    "%s mentions `%s`, which needs the Mobile app's sources or its debug build"
                    % (path.name, marker))

    def test_code_examples_import_the_mobile_sdk_only(self):
        for path in (LAYOUT, SDK_GUIDE):
            for block in fenced_blocks(read(path), "ts"):
                for source in re.findall(r"from '([^']+)'", block):
                    self.assertTrue(
                        source == "@creatio/mobile-common" or source.startswith("./"),
                        "%s: a module example imports from `%s`" % (path.name, source))

    def test_unsupported_mechanisms_are_named_with_their_alternative(self):
        skill = read(RUNBOOK)
        for mechanism in ("custom validator", "custom converter", "UI component", "HTTP"):
            self.assertIn(
                mechanism, skill,
                "the runbook must say that the SDK has no API for a %s" % mechanism)
        self.assertIn("Out of reach for a module", read(RUNBOOK))

    def test_the_built_module_is_exercised_before_delivery(self):
        playbook = read(RUNBOOK)
        verify = playbook.split("### 7. Verify locally", 1)[1].split("\n### 8.", 1)[0]
        self.assertIn("Behaviour check", verify)
        self.assertIn(
            "context/mobile-module-behaviour-check.md", verify,
            "the verification step must point at the way to run the built module")
        harness = "\n".join(fenced_blocks(read(BEHAVIOUR_CHECK), "js"))
        self.assertIn(
            "crtSdk", harness,
            "the check must load the bundle against a stub of the global the app provides")
        self.assertIn(
            "process.argv[2]", harness,
            "the check must run the built file that is delivered, not the sources")
        self.assertNotIn(
            "require('@", harness,
            "the check must need no npm package beyond Node itself")

    def run_sample_check(self, bundle_text):
        harness = fenced_blocks(read(BEHAVIOUR_CHECK), "js")
        self.assertEqual(len(harness), 1, "the reference carries one sample check")
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / "check-behaviour.cjs"
            script.write_text(harness[0], encoding="utf-8")
            bundle = Path(folder) / "main.js"
            bundle.write_text(bundle_text, encoding="utf-8")
            return subprocess.run(
                [NODE, str(script), str(bundle)],
                capture_output=True, text=True, encoding="utf-8", timeout=60)

    @unittest.skipIf(NODE is None, "Node.js is not installed")
    def test_the_sample_check_passes_on_a_module_that_follows_its_table(self):
        result = self.run_sample_check(read(MODULE_BUNDLE))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("5 cases, 0 failed", result.stdout)

    @unittest.skipIf(NODE is None, "Node.js is not installed")
    def test_the_sample_check_fails_on_a_module_that_breaks_its_table(self):
        result = self.run_sample_check(PASS_THROUGH_BUNDLE)
        self.assertEqual(
            result.returncode, 1,
            "a module that blocks nothing and normalizes nothing must fail the check\n"
            + result.stdout + result.stderr)
        self.assertIn("5 cases, 3 failed", result.stdout)

    def test_module_state_is_described_as_it_behaves_on_a_device(self):
        guide = read(SDK_GUIDE)
        self.assertIn("one value for the whole app", guide)
        self.assertIn("closing a page does not clear it", guide)
        self.assertNotIn(
            "cleared when the page", guide,
            "module-level state outlives the page: it lasts until the app restarts")
        self.assertRegex(
            guide, r"back arrow sends no request",
            "a handler cannot rely on a close request to learn that the user left a page")
        self.assertIn(
            "not told which page or record", guide,
            "a virtual data source returns the same rows on every record unless the module "
            "arranges otherwise")
        plan = read(RUNBOOK).split("## Plan format (Gate L)", 1)[1].split("\n## ", 1)[0]
        self.assertIn(
            "Data kept by the module", plan,
            "the developer approves whether the data is shared by every record")
        self.assertIn("Assumes", plan)

    def test_a_list_on_a_virtual_data_source_is_shown_in_full(self):
        guide = read(SDK_GUIDE)
        section = guide.split("### A list fed by a virtual data source", 1)[1].split("\n## ", 1)[0]
        for part in ('"scope": "viewElement"', '"isCollection": true', '"viewModelConfig"', '"crt.List"'):
            self.assertIn(part, section, "the list example must carry %s" % part)
        self.assertIn("RefreshMode.RefreshSpecific", section)
        self.assertIn(
            "targetDataSourceNames", section,
            "a handler that changed the data has to make the page read the source again")

    def test_json_examples_are_well_formed(self):
        for path in (LAYOUT, SDK_GUIDE):
            for block in fenced_blocks(read(path), "json"):
                text = block.strip()
                if not text.startswith(("{", "[")):
                    text = "{%s}" % text
                try:
                    json.loads(text)
                except ValueError as error:
                    self.fail("%s: a json example does not parse: %s\n%s" % (path.name, error, block))

    def test_an_existing_package_delivery_states_what_differs(self):
        playbook = read(RUNBOOK)
        section = playbook.split("## A module inside an existing package", 1)[1].split("\n## ", 1)[0]
        self.assertIn(
            "Every restore removes the staged script", section,
            "a push after a restore without staging again delivers no script")
        self.assertIn("is compiled", section)
        self.assertIn(
            "Starting a compilation is the developer's decision", section,
            "the agent never compiles an environment on its own")
        self.assertRegex(
            section, r"Pages are wired after the push",
            "a push after `update-page` from a stale workspace copy puts the old page back")
        deliver = playbook.split("### 9. Deliver", 1)[1].split("\n### 10.", 1)[0]
        self.assertRegex(
            deliver, r"non-zero exit code with no `Application installed successfully`",
            "a compilation that fails after the installation is not a failed delivery")
        plan = playbook.split("## Delivery plan format (Gate D)", 1)[1].split("\n## ", 1)[0]
        self.assertIn("C# project", plan)

    def test_visible_page_changes_are_designed_before_the_plan(self):
        load_order = read(RUNBOOK).split("## Load order", 1)[1].split("\n## ", 1)[0]
        self.assertRegex(
            load_order, r"before\s+presenting the plan",
            "a plan that names a button or a list is written with the UI rules loaded")

    def test_the_gate_probe_is_not_decided_by_one_package(self):
        preflight = read(RUNBOOK).split("## Load order", 1)[0]
        self.assertRegex(
            preflight, r"repeat it on a second package",
            "a package without files fails the probe the same way a missing gate does")

    def test_the_script_is_staged_before_the_delivery_plan(self):
        playbook = read(RUNBOOK)
        self.assertLess(
            playbook.index("Copy that one file only"), playbook.index("### 8. Present the delivery plan"),
            "the delivery plan must describe a file that already sits in the package folder")

    def test_delivery_plan_states_what_cannot_be_taken_back(self):
        playbook = read(RUNBOOK)
        plan = playbook.split("## Delivery plan format (Gate D)", 1)[1].split("\n## ", 1)[0]
        self.assertIn("Taking it back", plan)
        self.assertIn(
            "stays on devices", plan,
            "the developer approves a write that deleting the package does not undo")
        self.assertIn("CreatioPackages", plan)

    def test_versions_default_to_the_newest(self):
        self.assertIn("assume the users run the latest", read(RUNBOOK))
        self.assertIn("newest published", read(LAYOUT))

    def test_device_check_needs_no_cable_and_no_debugger(self):
        check = read(RUNBOOK).split("## Device check", 1)[1].split("\n## ", 1)[0]
        self.assertIn("by hand", check)
        self.assertIn("Send log", check)
        self.assertIn(
            "behaviour-check table", check,
            "the steps the developer performs come from the inputs already run locally")

    def test_the_app_orchestrator_is_the_only_entry_point(self):
        orchestrator = read(ORCHESTRATOR)
        frontmatter, body = orchestrator.split("\n---\n", 1)
        for trigger in ("Creatio Mobile app", "mobile page", "virtual data source", "remote module"):
            self.assertIn(
                trigger, frontmatter,
                "the orchestrator's description is what attracts a request for mobile logic; it "
                "must name `%s`" % trigger)
        load_order = body.split("## Load Order", 1)[1].split("\n## ", 1)[0]
        self.assertIn("../../" + RUNBOOK_PATH, load_order)
        core_rules = body.split("## Core Rules", 1)[1]
        self.assertIn("../../" + RUNBOOK_PATH, core_rules)
        self.assertIn('`workflow: "mobile-business-logic"`', body)
        self.assertIn(
            "../" + RUNBOOK_PATH, read(ROOT / "rules/creatio-app-orchestrator.mdc"),
            "the Cursor rule is the same entry point for another host")
        self.assertFalse(
            (ROOT / "skills/creatio-mobile-business-logic").exists(),
            "a second skill for the same flow splits the entry point")

    def test_the_runbook_maps_the_telemetry_stages_to_its_gates(self):
        telemetry = read(RUNBOOK).split("## Product telemetry", 1)[1].split("\n## ", 1)[0]
        self.assertIn('`workflow: "mobile-business-logic"`', telemetry)
        for stage in ("workflow_started", "plan_presented", "plan_approved", "build_started",
                      "work_item_completed", "workflow_completed"):
            self.assertIn("`%s`" % stage, telemetry)
        self.assertIn("send-telemetry", telemetry)
        self.assertIn("clio rejects them", telemetry)

    def test_mobile_page_surfaces_route_code_requests_to_the_runbook(self):
        for relative in (
            "context/essentials.md",
            "runbooks/02-requirements-gathering.md",
            "context/business-checklist.md",
            "AGENTS.md",
            "skills/creatio-mobile-page-conversion/references/page-to-mobile-conversion.md",
        ):
            self.assertIn(
                RUNBOOK_PATH, read(ROOT / relative),
                "%s must name the runbook that delivers mobile logic in code" % relative)
        self.assertNotIn(
            "out-of-scope for AI generation", read(ROOT / "runbooks/02-requirements-gathering.md"))


if __name__ == "__main__":
    unittest.main()
