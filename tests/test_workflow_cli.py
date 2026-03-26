import contextlib
import json
import os
import shutil
import subprocess
import sys
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST_TMP_ROOT = ROOT / ".tmp-tests"
TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
PYTHON = sys.executable


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
            "complete": True,
        },
        "technicalInputs": {
            "environmentMode": "planning-first",
            "credentialsStatus": "deferred",
        },
        "assumptions": [
            "Single user scope for MVP",
        ],
    }


def build_valid_requirements_doc(app_name="TodoList"):
    return f"""# {app_name} - Requirements

## 1. Business context

Short business opening paragraph.

System value:
- Shared registry instead of scattered notes
- Clear owner, status, and activity visibility

MVP success criteria:
- New records are created quickly
- Team can filter and manage the shared base

## 2. Users, access and ownership

Primary roles:
- Sales manager: creates and updates records
- Team lead: reviews and controls activity

Access model:
- Shared workspace for the team
- Each key record has an owner
- Archiving is used instead of deletion

## 3. Core process and business logic

Typical process:
1. Create the main record.
2. Add contacts.
3. Log interactions.
4. Create a follow-up action.

Lifecycle:
- Main record: New, Active, Archived
- Follow-up task: Planned, Completed

Key business logic:
- Records live in one shared registry
- Duplicate handling is advisory only
- Archived records are not deleted

Operational metrics:
- Active records by owner
- Open follow-up tasks by period

## 4. Data model

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
| Status | `UsrStatusId` | Task lifecycle state | Lookup | Yes | ui default: New |

Minimum to create:
- Name
- Status

### 4.2 Lookups

- Title: Status; Code: `UsrTodoStatus`; Allowed values: New, Active, Archived

### 4.3 Relationships

- Source entity: Task; Target entity: Status; Cardinality: N:1; Required child-side link: required; Business rationale: each task must have a status.

## 5. UX assumptions

What should feel easy in the MVP:
- default list columns: Name, Status
- default main filters: Status
- quick access to main records

## Assumptions used for the draft requirements

- MVP uses a single workflow.
"""


def run_workflow_cli(*args, workflow_root, stdin_text=None):
    env = os.environ.copy()
    env["WORKFLOW_ROOT_DIR"] = str(workflow_root)
    env["WORKFLOW_STATE_DIR"] = str(Path(workflow_root) / ".workflow-state")
    return subprocess.run(
        [PYTHON, str(ROOT / "scripts" / "workflow_cli.py"), *args],
        cwd=ROOT,
        env=env,
        text=True,
        input=stdin_text,
        capture_output=True,
    )


class WorkflowCliTests(unittest.TestCase):
    def test_validate_request_spec_accepts_valid_payload(self):
        with temp_workflow_root() as workflow_root:
            request_spec_path = Path(workflow_root) / "output" / "TodoList" / "request-spec.json"
            write_file(request_spec_path, json.dumps(build_valid_request_spec()))
            result = run_workflow_cli("validate-request-spec", str(request_spec_path), workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("REQUEST_SPEC_OK", result.stdout)

    def test_validate_requirements_doc_accepts_valid_document(self):
        with temp_workflow_root() as workflow_root:
            requirements_path = Path(workflow_root) / "output" / "TodoList" / "requirements.md"
            write_file(requirements_path, build_valid_requirements_doc())
            result = run_workflow_cli("validate-requirements-doc", str(requirements_path), workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("REQUIREMENTS_DOC_OK", result.stdout)

    def test_write_planning_state_writes_planning_file(self):
        with temp_workflow_root() as workflow_root:
            result = run_workflow_cli(
                "write-planning-state",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            planning_file = Path(workflow_root) / ".workflow-state" / "TodoList" / "planning-state.json"
            payload = json.loads(planning_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["routingMode"], "planning-first")
            self.assertTrue(payload["environmentInputsDeferred"])

    def test_check_planning_gate_accepts_written_state(self):
        with temp_workflow_root() as workflow_root:
            write_result = run_workflow_cli(
                "write-planning-state",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(write_result.returncode, 0, write_result.stderr)
            check_result = run_workflow_cli("check-planning-gate", "TodoList", workflow_root=workflow_root)
            self.assertEqual(check_result.returncode, 0, check_result.stderr)
            self.assertIn("PLANNING_GATE_OK TodoList", check_result.stdout)

    def test_write_approval_state_writes_workflow_state(self):
        with temp_workflow_root() as workflow_root:
            output_dir = Path(workflow_root) / "output" / "TodoList"
            write_file(output_dir / "requirements.md", build_valid_requirements_doc())
            write_file(output_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            planning_result = run_workflow_cli(
                "write-planning-state",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(planning_result.returncode, 0, planning_result.stderr)
            approval_result = run_workflow_cli(
                "write-approval-state",
                "TodoList",
                "tester",
                "Approved, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(approval_result.returncode, 0, approval_result.stderr)
            payload = json.loads((output_dir / "workflow-state.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["approvalToken"], "APPROVE_REQUIREMENTS")

    def test_check_approval_gate_accepts_approved_state(self):
        with temp_workflow_root() as workflow_root:
            output_dir = Path(workflow_root) / "output" / "TodoList"
            write_file(output_dir / "requirements.md", build_valid_requirements_doc())
            write_file(output_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            planning_result = run_workflow_cli(
                "write-planning-state",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(planning_result.returncode, 0, planning_result.stderr)
            approval_result = run_workflow_cli(
                "write-approval-state",
                "TodoList",
                "tester",
                "Approved, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(approval_result.returncode, 0, approval_result.stderr)
            check_result = run_workflow_cli("check-approval-gate", "TodoList", workflow_root=workflow_root)
            self.assertEqual(check_result.returncode, 0, check_result.stderr)
            self.assertIn("GATE_OK TodoList", check_result.stdout)

    def test_write_planning_state_rejects_invalid_routing_mode(self):
        with temp_workflow_root() as workflow_root:
            result = run_workflow_cli(
                "write-planning-state",
                "TodoList",
                "tester",
                "invalid-mode",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("routingMode must be one of", result.stderr)


if __name__ == "__main__":
    unittest.main()
