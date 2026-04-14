import contextlib
import json
import os
import shutil
import subprocess
import unittest
import uuid
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST_TMP_ROOT = ROOT / ".tmp-tests"
TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
BASH = shutil.which("bash")


@contextlib.contextmanager
def temp_workflow_root():
    workdir = TEST_TMP_ROOT / f"tmp-{uuid.uuid4().hex}"
    workdir.mkdir(parents=True, exist_ok=False)
    try:
        yield workdir
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def write_file(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@contextlib.contextmanager
def temp_mode(path, mode):
    original_mode = path.stat().st_mode
    path.chmod(mode)
    try:
        yield
    finally:
        path.chmod(original_mode)


def build_valid_request_spec():
    return {
        "sourcePrompt": "Generate a Todo app",
        "businessChecklist": {
            "businessOutcome": {"complete": True, "value": "Track daily work", "source": "confirmed"},
            "coreProblem": {"complete": True, "value": "Work is scattered across notes and chat", "source": "confirmed"},
            "actorsAndRoles": {"complete": True, "value": "Employees manage own tasks", "source": "confirmed"},
            "domainModel": {"complete": True, "value": "Task, status, priority", "source": "confirmed"},
            "lifecycleAndStatuses": {"complete": True, "value": "Not Started, In Progress, Completed", "source": "confirmed"},
            "businessLogic": {"complete": True, "value": "Title is required; duplicates are handled manually; tasks can be archived; editing is shared", "source": "confirmed"},
            "uxExpectations": {"complete": True, "value": "List and form pages are required", "source": "confirmed"},
            "edgeCases": {"complete": True, "value": "Completed tasks keep completion timestamp", "source": "confirmed"},
            "acceptanceCriteria": {"complete": True, "value": "User can create, view, update tasks", "source": "confirmed"},
            "analytics": {"complete": True, "value": "Track tasks created and completed by period", "source": "confirmed"},
            "accessRestrictions": {"complete": True, "value": "No specific access restrictions are required by default.", "source": "confirmed"},
            "complete": True
        },
        "technicalInputs": {
            "environmentMode": "site-ready-now",
            "creatioUrl": "http://localhost:5001",
            "credentialsStatus": "existing_env"
        },
        "planningSignals": {
            "reuseCheckRequired": []
        },
        "assumptions": [
            "Single user scope for MVP"
        ]
    }


def build_valid_requirements_doc(app_name="TodoList"):
    return f"""# {app_name} - Requirements

## 1. Business Outcome

Give the team a shared registry for tasks and follow-up actions.

## 2. Core Problem

Tasks are spread across notes and chat, so visibility and control are weak.

## 3. Actors and Roles

- Team member: creates and updates tasks
- Team lead: reviews status and priorities

## 4. Domain Model

### 4.1 Main entity: Task

Title: Task
Code: `UsrTask`
Entity role: `main`
Primary display field: `Name`
Description: Main work item.
Purpose: Main work item.

| Title | Code | Description | Data type | Required | Default |
| --- | --- | --- | --- | --- | --- |
| Name | `Name` | Task title | Short text | Yes | - |
| Status | `UsrStatusId` | Task lifecycle state | Lookup | Yes | New |

Minimum to create:
- Name
- Status

### 4.2 Supporting entity: Follow-up Task

Title: Follow-up Task
Code: `UsrFollowUpTask`
Entity role: `supporting`
Primary display field: `Name`
Description: Next action tied to the main record.
Purpose: Next action tied to the main record.

| Title | Code | Description | Data type | Required | Default |
| --- | --- | --- | --- | --- | --- |
| Name | `Name` | Follow-up title | Short text | Yes | - |
| Parent task | `UsrParentTask` | Main record link | Lookup | Yes | - |
| Due date | `UsrDueDate` | Task deadline | Date/Time | No | - |

### 4.3 Lookups

- Title: Status; Code: `UsrTodoStatus`; Allowed values: New, Active, Archived

### 4.4 Relationships

- Source entity: Task; Target entity: Follow-up Task; Cardinality: 1:N; Required child-side link: required; Business rationale: follow-up actions are tracked separately from the main record.

## 5. Lifecycle and Statuses

Tasks move through New, Active, and Archived. Follow-up tasks move through Planned and Completed.

## 6. Business Logic

- Task title and status are required.
- Follow-up actions must stay linked to a parent task.

## 7. UX Expectations

- default list columns: Name, Status
- default filters: Status
- main form groups: Main information, Follow-up actions
- default sort: Updated date descending

## 8. Edge Cases and Exceptions

- Archived tasks are excluded from the default active view.

## 9. Acceptance Criteria

- User can create tasks, update statuses, and manage follow-up actions.

## 10. Access / Personas

- Shared team workspace with no special restrictions for MVP.

## 11. Assumptions

- MVP uses a single workflow.
"""


def run_script(script_name, *args, workflow_root):
    if not BASH:
        raise unittest.SkipTest("bash is required to run workflow gate scripts on this platform")
    env = os.environ.copy()
    env["WORKFLOW_ROOT_DIR"] = workflow_root
    env["WORKFLOW_STATE_DIR"] = str(Path(workflow_root) / ".workflow-state")
    return subprocess.run(
        [BASH, str(ROOT / "scripts" / script_name), *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True
    )


class WorkflowGateTests(unittest.TestCase):
    def test_validate_requirements_doc_accepts_minimal_valid_structure(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", build_valid_requirements_doc())
            result = run_script("validate-requirements-doc.sh", str(app_dir / "requirements.md"), workflow_root=str(workflow_root))
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_validate_requirements_doc_rejects_missing_required_section(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", "# TodoList - Requirements\n\n## 1. Business context\n")
            result = run_script("validate-requirements-doc.sh", str(app_dir / "requirements.md"), workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing required section", result.stderr)

    def test_validate_requirements_doc_rejects_prose_only_entity_without_field_table(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            write_file(
                app_dir / "requirements.md",
                """# TodoList - Requirements

## 1. Business Outcome

Give the team one shared task registry.

## 2. Core Problem

Tasks are scattered across notes and chat.

## 3. Actors and Roles

- Team member: creates and updates tasks

## 4. Domain Model

### 4.1 Main entity: Task
Title: Task
Code: `UsrTask`
Entity role: `main`
Primary display field: `Name`
Description: Main work item.
Purpose: Main work item.

This entity stores the main work item and its status.

Minimum to create:
- Name

### 4.2 Lookups

- Title: Status; Code: `UsrTodoStatus`; Allowed values: New, Active, Archived

### 4.3 Relationships

- Source entity: Task; Target entity: Status; Cardinality: N:1; Required child-side link: required; Business rationale: each task must have a status.

## 5. Lifecycle and Statuses

Tasks move through New, Active, and Archived.

## 6. Business Logic

- Task title is required.

## 7. UX Expectations

- default list columns: Name, Status
- default filters: Status
- main form groups: Main information

## 8. Edge Cases and Exceptions

- Archived tasks remain visible in history views.

## 9. Acceptance Criteria

- User can create and update tasks.

## 10. Access / Personas

- Shared team workspace.

## 11. Assumptions

- MVP uses a single workflow.
""",
            )
            result = run_script("validate-requirements-doc.sh", str(app_dir / "requirements.md"), workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("field table", result.stderr)

    def test_validate_request_spec_accepts_planning_first_without_url(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            request_spec = build_valid_request_spec()
            request_spec["technicalInputs"] = {
                "environmentMode": "planning-first",
                "credentialsStatus": "deferred"
            }
            write_file(app_dir / "request-spec.json", json.dumps(request_spec))
            result = run_script("validate-request-spec.sh", str(app_dir / "request-spec.json"), workflow_root=str(workflow_root))
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_validate_request_spec_rejects_missing_checklist_source(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            request_spec = build_valid_request_spec()
            request_spec["businessChecklist"]["businessLogic"].pop("source")
            write_file(app_dir / "request-spec.json", json.dumps(request_spec))
            result = run_script("validate-request-spec.sh", str(app_dir / "request-spec.json"), workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("businessChecklist.businessLogic.source must be confirmed or assumed", result.stderr)

    def test_validate_request_spec_rejects_assumed_section_without_explicit_assumption(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            request_spec = build_valid_request_spec()
            request_spec["businessChecklist"]["edgeCases"]["source"] = "assumed"
            request_spec["businessChecklist"]["edgeCases"]["assumption"] = "Assume no duplicate handling for MVP"
            write_file(app_dir / "request-spec.json", json.dumps(request_spec))
            result = run_script("validate-request-spec.sh", str(app_dir / "request-spec.json"), workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("businessChecklist.edgeCases.assumption must be listed in assumptions", result.stderr)

    def test_write_approval_state_requires_planning_gate(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", build_valid_requirements_doc())
            write_file(app_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            result = run_script("write-approval-state.sh", "TodoList", "tester", "Approved, proceed", workflow_root=str(workflow_root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Planning gate failed", result.stderr)

    def test_write_planning_state_accepts_planning_first_without_url(self):
        with temp_workflow_root() as workflow_root:
            result = run_script(
                "write-planning-state.sh",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=str(workflow_root)
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            planning_file = Path(workflow_root) / ".workflow-state" / "TodoList" / "planning-state.json"
            payload = json.loads(planning_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["routingMode"], "planning-first")
            self.assertTrue(payload["environmentInputsDeferred"])
            self.assertEqual(payload["technicalInputs"]["creatioUrl"], "")

    def test_check_approval_gate_rejects_incomplete_request_spec(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", build_valid_requirements_doc())
            write_file(app_dir / "request-spec.json", json.dumps({"businessChecklist": {"complete": True}}))
            planning = run_script(
                "write-planning-state.sh",
                "TodoList",
                "tester",
                "site-ready-now",
                "http://localhost:5001",
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
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", build_valid_requirements_doc())
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
                "site-ready-now",
                "http://localhost:5001",
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
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", build_valid_requirements_doc())
            write_file(app_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            planning = run_script(
                "write-planning-state.sh",
                "TodoList",
                "tester",
                "site-ready-now",
                "http://localhost:5001",
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

    def test_write_approval_state_works_when_requirements_validator_is_not_executable(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", build_valid_requirements_doc())
            write_file(app_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            planning = run_script(
                "write-planning-state.sh",
                "TodoList",
                "tester",
                "site-ready-now",
                "http://localhost:5001",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=str(workflow_root)
            )
            self.assertEqual(planning.returncode, 0, planning.stderr)
            validator_path = ROOT / "scripts" / "validate-requirements-doc.sh"
            with temp_mode(validator_path, 0o644):
                approval = run_script(
                    "write-approval-state.sh",
                    "TodoList",
                    "tester",
                    "Approved, proceed",
                    workflow_root=str(workflow_root)
                )
            self.assertEqual(approval.returncode, 0, approval.stderr)

    def test_check_approval_gate_works_when_requirements_validator_is_not_executable(self):
        with temp_workflow_root() as workflow_root:
            app_dir = workflow_root / "output" / "TodoList"
            write_file(app_dir / "requirements.md", build_valid_requirements_doc())
            write_file(app_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            planning = run_script(
                "write-planning-state.sh",
                "TodoList",
                "tester",
                "site-ready-now",
                "http://localhost:5001",
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
            validator_path = ROOT / "scripts" / "validate-requirements-doc.sh"
            with temp_mode(validator_path, 0o644):
                result = run_script("check-approval-gate.sh", "TodoList", workflow_root=str(workflow_root))
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
