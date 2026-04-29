import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from workflow_validators import validate_request_spec, WorkflowError


def _build_valid_spec(**overrides):
    spec = {
        "sourcePrompt": "Generate a task management app",
        "businessChecklist": {
            "complete": True,
            "businessOutcome": {"complete": True, "value": "Track tasks", "source": "confirmed"},
            "rolesAndPermissions": {"complete": True, "value": "Employees manage tasks", "source": "confirmed"},
            "objectModel": {"complete": True, "value": "Task entity with status", "source": "confirmed"},
            "lifecycleAndStatuses": {"complete": True, "value": "New, In Progress, Done", "source": "confirmed"},
            "businessLogic": {"complete": True, "value": "Title required", "source": "confirmed"},
            "uxExpectations": {"complete": True, "value": "List and form pages", "source": "confirmed"},
            "edgeCases": {"complete": True, "value": "Archived tasks stay visible", "source": "confirmed"},
        },
        "technicalInputs": {
            "environmentMode": "planning-first",
            "credentialsStatus": "deferred",
        },
        "planningSignals": {
            "reuseCheckRequired": [],
        },
        "assumptions": [],
    }
    spec.update(overrides)
    return spec


class TestValidateRequestSpecValid(unittest.TestCase):
    def test_valid_spec_passes(self):
        result = validate_request_spec(_build_valid_spec())
        self.assertIsNone(result)

    def test_site_ready_now_with_url_passes(self):
        spec = _build_valid_spec(
            technicalInputs={
                "environmentMode": "site-ready-now",
                "creatioUrl": "http://localhost:5001",
                "credentialsStatus": "provided",
            }
        )
        result = validate_request_spec(spec)
        self.assertIsNone(result)

    def test_assumed_source_with_assumption_passes(self):
        spec = _build_valid_spec()
        spec["businessChecklist"]["edgeCases"] = {
            "complete": True,
            "value": "Archived tasks stay visible",
            "source": "assumed",
            "assumption": "Edge case assumed for MVP",
        }
        spec["assumptions"] = ["Edge case assumed for MVP"]
        result = validate_request_spec(spec)
        self.assertIsNone(result)

    def test_reuse_check_signal_passes(self):
        spec = _build_valid_spec()
        spec["planningSignals"]["reuseCheckRequired"] = [
            {
                "businessConcept": "Task",
                "whyAmbiguous": "Activity may match",
                "suspectedCandidates": ["Activity"],
            }
        ]
        result = validate_request_spec(spec)
        self.assertIsNone(result)


class TestValidateRequestSpecRequiredFields(unittest.TestCase):
    def test_missing_source_prompt_fails(self):
        spec = _build_valid_spec(sourcePrompt="")
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("sourcePrompt", str(ctx.exception))

    def test_checklist_complete_false_fails(self):
        spec = _build_valid_spec()
        spec["businessChecklist"]["complete"] = False
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("businessChecklist", str(ctx.exception))

    def test_missing_technical_inputs_fails(self):
        spec = _build_valid_spec()
        del spec["technicalInputs"]
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("technicalInputs", str(ctx.exception))

    def test_missing_planning_signals_fails(self):
        spec = _build_valid_spec()
        del spec["planningSignals"]
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("planningSignals", str(ctx.exception))

    def test_reuse_check_not_array_fails(self):
        spec = _build_valid_spec()
        spec["planningSignals"]["reuseCheckRequired"] = "Task"
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("reuseCheckRequired", str(ctx.exception))


class TestValidateRequestSpecChecklist(unittest.TestCase):
    def test_section_complete_false_fails(self):
        spec = _build_valid_spec()
        spec["businessChecklist"]["businessOutcome"]["complete"] = False
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("businessOutcome", str(ctx.exception))

    def test_section_missing_value_fails(self):
        spec = _build_valid_spec()
        spec["businessChecklist"]["objectModel"]["value"] = ""
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("objectModel", str(ctx.exception))

    def test_invalid_source_fails(self):
        spec = _build_valid_spec()
        spec["businessChecklist"]["businessLogic"]["source"] = "unknown"
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("source", str(ctx.exception))

    def test_assumed_source_without_assumption_field_fails(self):
        spec = _build_valid_spec()
        spec["businessChecklist"]["edgeCases"]["source"] = "assumed"
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("assumption", str(ctx.exception))

    def test_assumed_source_assumption_not_in_assumptions_list_fails(self):
        spec = _build_valid_spec()
        spec["businessChecklist"]["edgeCases"] = {
            "complete": True,
            "value": "Archived tasks",
            "source": "assumed",
            "assumption": "Orphaned assumption",
        }
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("assumptions", str(ctx.exception))


class TestValidateRequestSpecEnvironmentMode(unittest.TestCase):
    def test_site_ready_now_without_url_fails(self):
        spec = _build_valid_spec(
            technicalInputs={
                "environmentMode": "site-ready-now",
                "credentialsStatus": "provided",
            }
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("creatioUrl", str(ctx.exception))

    def test_invalid_credentials_status_fails(self):
        spec = _build_valid_spec()
        spec["technicalInputs"]["credentialsStatus"] = "unknown"
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("credentialsStatus", str(ctx.exception))

    def test_invalid_environment_mode_fails(self):
        spec = _build_valid_spec()
        spec["technicalInputs"]["environmentMode"] = "hybrid"
        with self.assertRaises(WorkflowError) as ctx:
            validate_request_spec(spec)
        self.assertIn("environmentMode", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
