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
BASH = shutil.which("bash")
PWSH = shutil.which("pwsh") or shutil.which("powershell")


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
            "businessOutcome": {"complete": True, "value": "Track daily work, fix scattered process, and assume a single MVP workflow", "source": "confirmed"},
            "rolesAndPermissions": {"complete": True, "value": "Employees manage own tasks; team leads review progress; no special restrictions for MVP", "source": "confirmed"},
            "objectModel": {"complete": True, "value": "Task, status, priority", "source": "confirmed"},
            "lifecycleAndStatuses": {"complete": True, "value": "Not Started, In Progress, Completed", "source": "confirmed"},
            "businessLogic": {"complete": True, "value": "Title is required; duplicates are handled manually; tasks can be archived; editing is shared", "source": "confirmed"},
            "uxExpectations": {"complete": True, "value": "List and form pages are required", "source": "confirmed"},
            "edgeCases": {"complete": True, "value": "Completed tasks keep completion timestamp", "source": "confirmed"},
            "complete": True,
        },
        "technicalInputs": {
            "environmentMode": "planning-first",
            "credentialsStatus": "deferred",
        },
        "planningSignals": {
            "reuseCheckRequired": [],
        },
        "assumptions": [
            "Single user scope for MVP",
        ],
    }


def build_valid_requirements_doc(app_name="TodoList"):
    return f"""# {app_name} - Requirements

## 1. Business Outcome

Provide a shared task registry so the team can track work in one place.

- Core problem: tasks are scattered across notes and chat, so owners and statuses are hard to track.
- Success signal: the team works from one shared task registry.
- Assumptions: MVP uses a single workflow.

## 2. Roles and Permissions

- Team member: creates and updates tasks
- Team lead: reviews progress and priorities
- Shared team workspace with no special restrictions for MVP.

## 3. Object Model

### 3.1 Main entity: Task

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

### 3.2 Lookups

- Title: Status; Code: `UsrTodoStatus`; Allowed values: New, Active, Archived

### 3.3 Relationships

- Source entity: Task; Target entity: Status; Cardinality: N:1; Required child-side link: required; Business rationale: each task must have a status.

## 4. Lifecycle and Statuses

Tasks move through New, Active, and Archived statuses.

## 5. Business Logic

- Title and Status are required to create a task.
- Tasks stay in one shared registry and are archived instead of deleted.

## 6. UX Expectations

- default list columns: Name, Status
- default filters: Status
- main form groups: Main information

## 7. Edge Cases and Exceptions

- Archived tasks remain visible in history views.
"""


def build_valid_plan_doc():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: Activity, existing task-like app models, existing task-like schemas
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: Activity has unwanted coupling to a broader interaction lifecycle and does not fit the approved app-owned task boundary
  candidate-fit-summary: Activity covers assignee, due date, and completion semantics that are adjacent to the requested task concept
  required-capabilities: app-owned task lifecycle, event-specific linkage, dedicated lightweight completion flow
  mismatch-evidence: dataforge-context confirmed Activity belongs to a broader interaction model; get-entity-schema-properties showed the required event linkage and app-owned lifecycle cannot be satisfied without unacceptable inherited behavior
  discovery-evidence: application-get-list, dataforge-find-tables, dataforge-find-lookups, dataforge-context, get-entity-schema-properties

## Ordered Schema Sync

- create UsrTask schema for the approved task model.
"""


def wrapper_env(workflow_root):
    env = os.environ.copy()
    env["WORKFLOW_ROOT_DIR"] = str(workflow_root)
    env["WORKFLOW_STATE_DIR"] = str(Path(workflow_root) / ".workflow-state")
    return env


def run_bash_script(script_name, *args, workflow_root):
    if not BASH:
        raise unittest.SkipTest("bash is required")
    return subprocess.run(
        [BASH, str(ROOT / "scripts" / script_name), *args],
        cwd=ROOT,
        env=wrapper_env(workflow_root),
        text=True,
        capture_output=True,
    )


def run_powershell_script(script_name, *args, workflow_root):
    if not PWSH:
        raise unittest.SkipTest("PowerShell is required")
    return subprocess.run(
        [PWSH, "-NoProfile", "-File", str(ROOT / "scripts" / script_name), *args],
        cwd=ROOT,
        env=wrapper_env(workflow_root),
        text=True,
        capture_output=True,
    )


class UnixWrapperSmokeTests(unittest.TestCase):
    def test_find_python_sh_exports_python_cmd(self):
        if not BASH:
            raise unittest.SkipTest("bash is required")
        result = subprocess.run(
            [BASH, "-lc", f"source '{ROOT / 'scripts' / 'find_python.sh'}' >/dev/null && test -n \"$PYTHON_CMD\" && \"$PYTHON_CMD\" --version"],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_workflow_gate_sh_runs_full_gate_flow(self):
        with temp_workflow_root() as workflow_root:
            output_dir = Path(workflow_root) / "output" / "TodoList"
            write_file(output_dir / "requirements.md", build_valid_requirements_doc())
            write_file(output_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            planning = run_bash_script(
                "workflow_gate.sh",
                "plan-approve",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(planning.returncode, 0, planning.stderr)
            approval = run_bash_script(
                "workflow_gate.sh",
                "requirements-approve",
                "TodoList",
                "tester",
                "Approved, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(approval.returncode, 0, approval.stderr)
            self.assertIn("GATE_OK TodoList", approval.stdout)

    def test_implementation_plan_wrapper_runs_in_bash(self):
        with temp_workflow_root() as workflow_root:
            output_dir = Path(workflow_root) / "output" / "TodoList"
            write_file(output_dir / "requirements.md", build_valid_requirements_doc())
            write_file(output_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            write_file(output_dir / "plan.md", build_valid_plan_doc())
            planning = run_bash_script(
                "workflow_gate.sh",
                "plan-approve",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(planning.returncode, 0, planning.stderr)
            approval = run_bash_script(
                "workflow_gate.sh",
                "requirements-approve",
                "TodoList",
                "tester",
                "Approved, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(approval.returncode, 0, approval.stderr)
            result = run_bash_script("workflow_gate.sh", "implementation-check", "TodoList", workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_GATE_OK TodoList", result.stdout)


class PowerShellWrapperSmokeTests(unittest.TestCase):
    def test_planning_wrappers_work_in_powershell(self):
        with temp_workflow_root() as workflow_root:
            write_result = run_powershell_script(
                "write-planning-state.ps1",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(write_result.returncode, 0, write_result.stderr)
            check_result = run_powershell_script("check-planning-gate.ps1", "TodoList", workflow_root=workflow_root)
            self.assertEqual(check_result.returncode, 0, check_result.stderr)
            self.assertIn("PLANNING_GATE_OK TodoList", check_result.stdout)

    def test_approval_wrappers_work_in_powershell(self):
        with temp_workflow_root() as workflow_root:
            output_dir = Path(workflow_root) / "output" / "TodoList"
            write_file(output_dir / "requirements.md", build_valid_requirements_doc())
            write_file(output_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            planning_result = run_powershell_script(
                "write-planning-state.ps1",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(planning_result.returncode, 0, planning_result.stderr)
            approval_result = run_powershell_script(
                "write-approval-state.ps1",
                "TodoList",
                "tester",
                "Approved, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(approval_result.returncode, 0, approval_result.stderr)
            check_result = run_powershell_script("check-approval-gate.ps1", "TodoList", workflow_root=workflow_root)
            self.assertEqual(check_result.returncode, 0, check_result.stderr)
            self.assertIn("GATE_OK TodoList", check_result.stdout)

    def test_implementation_plan_wrappers_work_in_powershell(self):
        with temp_workflow_root() as workflow_root:
            output_dir = Path(workflow_root) / "output" / "TodoList"
            write_file(output_dir / "requirements.md", build_valid_requirements_doc())
            write_file(output_dir / "request-spec.json", json.dumps(build_valid_request_spec()))
            write_file(output_dir / "plan.md", build_valid_plan_doc())
            planning_result = run_powershell_script(
                "write-planning-state.ps1",
                "TodoList",
                "tester",
                "planning-first",
                "deferred",
                "Todo app for daily work",
                "Yes, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(planning_result.returncode, 0, planning_result.stderr)
            approval_result = run_powershell_script(
                "write-approval-state.ps1",
                "TodoList",
                "tester",
                "Approved, proceed",
                workflow_root=workflow_root,
            )
            self.assertEqual(approval_result.returncode, 0, approval_result.stderr)
            check_result = run_powershell_script("check-implementation-plan-gate.ps1", "TodoList", workflow_root=workflow_root)
            self.assertEqual(check_result.returncode, 0, check_result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_GATE_OK TodoList", check_result.stdout)


if __name__ == "__main__":
    unittest.main()
