import json
import os
import subprocess
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write_file(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def build_valid_request_spec():
    return {
        "sourcePrompt": "Generate a Todo app",
        "businessChecklist": {
            "businessOutcome": {"complete": True, "value": "Track daily work", "source": "confirmed"},
            "actorsAndRoles": {"complete": True, "value": "Employees manage own tasks", "source": "confirmed"},
            "domainModel": {"complete": True, "value": "Task, status, priority", "source": "confirmed"},
            "lifecycleAndStatuses": {"complete": True, "value": "Not Started, In Progress, Completed", "source": "confirmed"},
            "businessRules": {"complete": True, "value": "Status and priority are required", "source": "confirmed"},
            "uxExpectations": {"complete": True, "value": "List and form pages are required", "source": "confirmed"},
            "edgeCases": {"complete": True, "value": "Completed tasks keep completion timestamp", "source": "confirmed"},
            "acceptanceCriteria": {"complete": True, "value": "User can create, view, update tasks", "source": "confirmed"},
            "complete": True
        },
        "technicalInputs": {
            "creatioUrl": "http://localhost:5001",
            "credentialsStatus": "existing_env"
        },
        "assumptions": [
            "Single user scope for MVP"
        ]
    }


def run_script(script_name, *args, workflow_root):
    env = os.environ.copy()
    env["WORKFLOW_ROOT_DIR"] = workflow_root
    env["WORKFLOW_STATE_DIR"] = str(Path(workflow_root) / ".workflow-state")
    return subprocess.run(
        ["bash", str(ROOT / "scripts" / script_name), *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True
    )


class WorkflowGateTests(unittest.TestCase):
    def test_validate_request_spec_rejects_missing_checklist_source(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workflow_root = Path(temp_dir)
            app_dir = workflow_root / "output" / "TodoList"
            request_spec = build_valid_request_spec()
            request_spec["businessChecklist"]["businessRules"].pop("source")
            write_file(app_dir / "request-spec.json", json.dumps(request_spec))
            result = run_script("validate-request-spec.sh", str(app_dir / "request-spec.json"), workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("businessChecklist.businessRules.source must be confirmed or assumed", result.stderr)

    def test_validate_request_spec_rejects_assumed_section_without_explicit_assumption(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workflow_root = Path(temp_dir)
            app_dir = workflow_root / "output" / "TodoList"
            request_spec = build_valid_request_spec()
            request_spec["businessChecklist"]["edgeCases"]["source"] = "assumed"
            request_spec["businessChecklist"]["edgeCases"]["assumption"] = "Assume no duplicate handling for MVP"
            write_file(app_dir / "request-spec.json", json.dumps(request_spec))
            result = run_script("validate-request-spec.sh", str(app_dir / "request-spec.json"), workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("businessChecklist.edgeCases.assumption must be listed in assumptions", result.stderr)

    def test_write_approval_state_requires_planning_gate(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workflow_root = Path(temp_dir)
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", "# TodoList\n")
            write_file(app_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            result = run_script("write-approval-state.sh", "TodoList", "tester", "Approved, proceed", workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Planning gate failed", result.stderr)

    def test_check_approval_gate_rejects_incomplete_request_spec(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workflow_root = Path(temp_dir)
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", "# TodoList\n")
            write_file(app_dir / "request-spec.json", json.dumps({"businessChecklist": {"complete": True}}))
            planning = run_script(
                "write-planning-state.sh",
                "TodoList",
                "tester",
                "http://localhost:5001",
                "Supervisor",
                "Supervisor",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=str(workflow_root)
            )
            self.assertEqual(planning.returncode, 0, planning.stderr)
            write_file(
                app_dir / "workflow-state.json",
                json.dumps(
                    {
                        "requirementsApproved": True,
                        "approvalToken": "APPROVE_REQUIREMENTS",
                        "appName": "TodoList",
                        "requirementsSha256": "",
                        "approvedBy": "tester",
                        "approvedAtUtc": "2026-03-10T00:00:00Z",
                        "approvalSource": "natural-language",
                        "approvalText": "Approved, proceed",
                        "interactionMode": "nl-business-first",
                        "businessChecklistComplete": True
                    }
                )
            )
            workflow_state = json.loads((app_dir / "workflow-state.json").read_text(encoding="utf-8"))
            workflow_state["requirementsSha256"] = sha256((app_dir / "requirements.md").read_bytes()).hexdigest()
            write_file(app_dir / "workflow-state.json", json.dumps(workflow_state))
            result = run_script("check-approval-gate.sh", "TodoList", workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Request spec failed", result.stderr)

    def test_check_approval_gate_rejects_url_and_proceed_only_flow(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workflow_root = Path(temp_dir)
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", "# TodoList\n")
            write_file(
                app_dir / "request-spec.json",
                json.dumps(
                    {
                        "sourcePrompt": "Generate a Todo app",
                        "businessChecklist": {
                            "complete": True
                        },
                        "technicalInputs": {
                            "creatioUrl": "http://localhost:5001",
                            "credentialsStatus": "existing_env"
                        },
                        "assumptions": []
                    }
                )
            )
            planning = run_script(
                "write-planning-state.sh",
                "TodoList",
                "tester",
                "http://localhost:5001",
                "Supervisor",
                "Supervisor",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=str(workflow_root)
            )
            self.assertEqual(planning.returncode, 0, planning.stderr)
            write_file(
                app_dir / "workflow-state.json",
                json.dumps(
                    {
                        "requirementsApproved": True,
                        "approvalToken": "APPROVE_REQUIREMENTS",
                        "appName": "TodoList",
                        "requirementsSha256": "",
                        "approvedBy": "tester",
                        "approvedAtUtc": "2026-03-10T00:00:00Z",
                        "approvalSource": "natural-language",
                        "approvalText": "Approved, proceed",
                        "interactionMode": "nl-business-first",
                        "businessChecklistComplete": True
                    }
                )
            )
            workflow_state = json.loads((app_dir / "workflow-state.json").read_text(encoding="utf-8"))
            workflow_state["requirementsSha256"] = sha256((app_dir / "requirements.md").read_bytes()).hexdigest()
            write_file(app_dir / "workflow-state.json", json.dumps(workflow_state))
            result = run_script("check-approval-gate.sh", "TodoList", workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Request spec failed", result.stderr)

    def test_check_approval_gate_accepts_full_request_spec(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workflow_root = Path(temp_dir)
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", "# TodoList\n")
            write_file(app_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            planning = run_script(
                "write-planning-state.sh",
                "TodoList",
                "tester",
                "http://localhost:5001",
                "Supervisor",
                "Supervisor",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=str(workflow_root)
            )
            self.assertEqual(planning.returncode, 0, planning.stderr)
            approval = run_script(
                "write-approval-state.sh",
                "TodoList",
                "tester",
                "Approved, proceed",
                workflow_root=str(workflow_root)
            )
            self.assertEqual(approval.returncode, 0, approval.stderr)
            result = run_script("check-approval-gate.sh", "TodoList", workflow_root=str(workflow_root))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("GATE_OK TodoList", result.stdout)


if __name__ == "__main__":
    unittest.main()
