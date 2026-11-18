"""The mobile business-logic flow must stay usable by a developer who has only the public surface.

A partner has clio, the clio MCP server, this toolkit and the ``@creatio/mobile-common`` npm package.
These tests pin the structure of the flow and the code its documents carry, not their wording:

1. The flow has one entry point, its gates forbid writes until approved, and no step the flow runs
   before a gate is forbidden by it.

2. Both plans carry the blocks the developer approves, and the script is staged before the delivery
   plan describes it.

3. The project layout keeps the settings the Mobile app's script runtime requires. A module that
   bundles the SDK, minifies class names or targets the DOM loads wrongly or not at all, and the
   build stays green.

4. The code in the documents is code an agent can copy: JSON parses, examples import only the
   mobile SDK, nothing points at sources a partner cannot read, and the sample behaviour check runs
   as printed — it passes on a module that follows its table and fails on one that does not.

5. The surfaces that describe mobile pages route a request for code to the flow's runbook, and the
   runbook maps the telemetry stages to its gates.
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

LOGIC_PLAN_BLOCKS = (
    "What it does", "Where", "How", "Page changes", "Choices made", "Already on the page",
    "Data kept by the module", "Assumes", "Works offline", "Not covered", "Needs on the device",
)
DELIVERY_PLAN_BLOCKS = (
    "Environment", "Package", "What the push also does", "Script", "Pages that change", "Feature",
    "Taking it back",
)


def read(path):
    return path.read_text(encoding="utf-8")


def fenced_blocks(text, language):
    return re.findall(r"```%s\n(.*?)```" % language, text, re.DOTALL)


def section(text, heading):
    return text.split(heading, 1)[1].split("\n## ", 1)[0]


class MobileBusinessLogicDocsTests(unittest.TestCase):

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

    def test_preflight_checks_the_tools_the_flow_calls(self):
        preflight = read(RUNBOOK).split("## Load order", 1)[0]
        self.assertIn("get-tool-contract", preflight)
        for tool in ("push-workspace", "get-package-file", "update-page", "get-request-info"):
            self.assertIn(tool, preflight, "the preflight must check for `%s`" % tool)

    def test_both_gates_are_declared_with_what_they_forbid(self):
        orchestrator = read(ORCHESTRATOR)
        playbook = read(RUNBOOK)
        for gate in ("Gate L", "Gate D"):
            self.assertIn(gate, orchestrator, "the entry point names %s" % gate)
            self.assertIn("## %s" % gate, playbook, "the runbook owns the rules of %s" % gate)
            self.assertIn("Forbidden until approved", section(playbook, "## %s" % gate))
        gate_d = section(playbook, "## Gate D")
        for write in ("push-workspace", "update-page"):
            self.assertIn(
                write, gate_d, "`%s` writes to the environment and must wait for Gate D" % write)

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

    def test_both_plans_carry_the_blocks_the_developer_approves(self):
        playbook = read(RUNBOOK)
        for heading, blocks in (("## Plan format (Gate L)", LOGIC_PLAN_BLOCKS),
                                ("## Delivery plan format (Gate D)", DELIVERY_PLAN_BLOCKS)):
            plan = "\n".join(fenced_blocks(section(playbook, heading), ""))
            for block in blocks:
                self.assertRegex(
                    plan, r"(?m)^%s$" % re.escape(block),
                    "the plan under `%s` must carry the block `%s`" % (heading, block))

    def test_the_script_is_staged_before_the_delivery_plan(self):
        verify = read(RUNBOOK).split("### 7. Verify locally", 1)[1].split("\n### 8.", 1)[0]
        self.assertIn(
            "packages/<Package>/Files/src/mobile/<ModuleName>/main.js", verify,
            "the delivery plan must describe a file that already sits in the package folder")

    def test_the_built_module_is_exercised_before_delivery(self):
        playbook = read(RUNBOOK)
        verify = playbook.split("### 7. Verify locally", 1)[1].split("\n### 8.", 1)[0]
        self.assertIn(
            "context/mobile-module-behaviour-check.md", verify,
            "the verification step must point at the way to run the built module")

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

    def test_code_examples_import_the_mobile_sdk_only(self):
        for path in (LAYOUT, SDK_GUIDE):
            for block in fenced_blocks(read(path), "ts"):
                for source in re.findall(r"from '([^']+)'", block):
                    self.assertTrue(
                        source == "@creatio/mobile-common" or source.startswith("./"),
                        "%s: a module example imports from `%s`" % (path.name, source))

    def test_no_example_puts_the_schema_prefix_after_usr(self):
        for path in DOCUMENTS:
            self.assertNotRegex(
                read(path), r"usr\.Usr[A-Z]",
                "%s names a type with the schema prefix after `usr.`; the rule is `usr.` plus a "
                "PascalCase name" % path.name)

    def test_references_do_not_point_at_sources_a_partner_cannot_reach(self):
        for path in DOCUMENTS:
            text = read(path)
            for marker in INTERNAL_ONLY_MARKERS:
                self.assertNotIn(
                    marker, text,
                    "%s mentions `%s`, which needs the Mobile app's sources or its debug build"
                    % (path.name, marker))

    def test_a_list_on_a_virtual_data_source_is_shown_in_full(self):
        example = section(read(SDK_GUIDE), "### A list fed by a virtual data source")
        for part in ('"scope": "viewElement"', '"isCollection": true', '"viewModelConfig"', '"crt.List"'):
            self.assertIn(part, example, "the list example must carry %s" % part)

    def test_a_computed_text_is_shown_in_full(self):
        example = section(read(SDK_GUIDE), "## A text computed by the module")
        for part in ('{ "value": "" }', '"crt.Label"', "crt.LoadDataRequest",
                     "crt.HandleViewModelAttributeChangeRequest"):
            self.assertIn(part, example, "the computed text example must carry %s" % part)

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

    def test_the_sample_check_runs_the_delivered_bundle_without_npm(self):
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
        for part in ("dialogAnswer", "HandlerChainService", "writes.push", "options.request",
                     "getAttribute:", "setAttribute:", "get:", "set:"):
            self.assertIn(
                part, harness,
                "the sample check's stub must answer `%s`, which real handlers use" % part)

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

    def test_the_runbook_maps_the_telemetry_stages_to_its_gates(self):
        telemetry = section(read(RUNBOOK), "## Product telemetry")
        self.assertIn('`workflow: "mobile-business-logic"`', telemetry)
        for stage in ("workflow_started", "plan_presented", "plan_approved", "build_started",
                      "work_item_completed", "workflow_completed"):
            self.assertIn("`%s`" % stage, telemetry)
        self.assertIn("send-telemetry", telemetry)

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


if __name__ == "__main__":
    unittest.main()
