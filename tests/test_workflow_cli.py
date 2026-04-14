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

## 1. Business Outcome

Give the team one place to capture and manage daily tasks.

## 2. Core Problem

Tasks are spread across notes and chat, which makes status and ownership unclear.

## 3. Actors and Roles

- Team member: creates and updates tasks
- Team lead: reviews progress and priorities

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

### 4.2 Lookups

- Title: Status; Code: `UsrTodoStatus`; Allowed values: New, Active, Archived

### 4.3 Relationships

- Source entity: Task; Target entity: Status; Cardinality: N:1; Required child-side link: required; Business rationale: each task must have a status.

## 5. Lifecycle and Statuses

Tasks move through New, Active, and Archived statuses.

## 6. Business Logic

- Title and Status are required to create a task.
- Duplicate handling is advisory only.

## 7. UX Expectations

- default list columns: Name, Status
- default filters: Status
- main form groups: Main information

## 8. Edge Cases and Exceptions

- Archived tasks are excluded from default active lists.

## 9. Acceptance Criteria

- User can create, view, and update tasks.

## 10. Access / Personas

- Shared team workspace with one owner field on each task.

## 11. Assumptions

- MVP uses a single workflow.
"""


def build_valid_plan_doc():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: existing task-like app models, existing task-like schemas
  chosen-action: create
  chosen-schema: UsrTask
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: platform task models are broader than the approved scope, no suitable candidate found
  discovery-evidence: application-get-list, dataforge-find-tables, dataforge-find-lookups, dataforge-context, no suitable candidate found

## Ordered Schema Sync

- create UsrTask schema for the approved task model.
"""


def build_invalid_plan_doc_without_reuse_evidence():
    return """# Implementation Plan

## Ordered Schema Sync

- Create the task schema.
"""


def build_invalid_plan_doc_without_discovery_evidence():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: existing task-like app models, existing task-like schemas
  chosen-action: create
  chosen-schema: UsrTask
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: platform task models do not match the approved scope

## Ordered Schema Sync

- Create the task schema.
"""


def build_invalid_plan_doc_without_create_rejection_reason():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: existing task-like app models, existing task-like schemas
  chosen-action: create
  chosen-schema: UsrTask
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: custom app requested
  discovery-evidence: application-get-list, dataforge-find-tables, no suitable candidate found

## Ordered Schema Sync

- create UsrTask schema for the approved task model.
"""


def build_invalid_plan_doc_without_matching_model_decision():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: existing task-like app models, existing task-like schemas
  chosen-action: create
  chosen-schema: UsrTask
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: platform task models are broader than the approved scope, no suitable candidate found
  discovery-evidence: application-get-list, dataforge-find-tables, no suitable candidate found

## Ordered Schema Sync

- create UsrTaskComment schema for the approved comment model.
"""


def build_valid_greenfield_plan_doc():
    return """# Implementation Plan

## Model Decisions

- business-concept: Intake Record
  candidates-considered: greenfield-only domain review
  chosen-action: create
  chosen-schema: UsrIntakeRecord
  rationale: Approved requirements define a net-new business object with no plausible reuse target
  rejected-candidates: no suitable candidate found
  discovery-evidence: dataforge-find-tables attempted (no matches), application-get-list returned no matching app, greenfield-only

## Ordered Schema Sync

- create UsrIntakeRecord schema for the approved intake model.
"""


def build_invalid_plan_doc_outcome_only_evidence():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: existing task-like app models
  chosen-action: create
  chosen-schema: UsrTask
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: no suitable candidate found
  discovery-evidence: greenfield-only, no suitable candidate found

## Ordered Schema Sync

- create UsrTask schema for the approved task model.
"""


def build_valid_reuse_plan_doc():
    return """# Implementation Plan

## Model Decisions

- business-concept: Contact
  candidates-considered: Contact, Account
  chosen-action: reuse
  chosen-schema: Contact
  rationale: Platform Contact entity already satisfies the business role
  rejected-candidates: Account does not match the required persona semantics
  discovery-evidence: dataforge-find-tables, get-entity-schema-properties

## Ordered Schema Sync

- reuse Contact schema as-is for the contact role.
"""


def build_valid_extend_plan_doc():
    return """# Implementation Plan

## Model Decisions

- business-concept: Support Case
  candidates-considered: Case, UsrSupportCase
  chosen-action: extend
  chosen-schema: UsrSupportCase
  rationale: Existing UsrSupportCase matches but needs additional fields
  rejected-candidates: platform Case schema has unwanted coupling to service module
  discovery-evidence: dataforge-find-tables, application-get-info, get-entity-schema-properties

## Ordered Schema Sync

- extend UsrSupportCase with additional approved columns.
"""


def build_valid_multi_block_plan_doc():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: existing task-like app models, existing task-like schemas
  chosen-action: create
  chosen-schema: UsrTask
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: platform task models are broader than the approved scope, no suitable candidate found
  discovery-evidence: application-get-list, dataforge-find-tables, dataforge-find-lookups, no suitable candidate found

- business-concept: Task Status
  candidates-considered: existing status lookups
  chosen-action: create
  chosen-schema: UsrTaskStatus
  rationale: App-specific lifecycle requires dedicated status lookup
  rejected-candidates: no suitable candidate found
  discovery-evidence: dataforge-find-lookups, no suitable candidate found

- business-concept: Task Priority
  candidates-considered: existing priority lookups, ActivityPriority
  chosen-action: reuse
  chosen-schema: ActivityPriority
  rationale: Platform priority lookup matches the required semantics exactly
  rejected-candidates: none
  discovery-evidence: dataforge-find-lookups, get-entity-schema-properties

## Ordered Schema Sync

- create UsrTaskStatus lookup for task lifecycle.
- create UsrTask schema for the approved task model.
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

    def test_validate_implementation_plan_doc_accepts_model_decisions_with_discovery_evidence(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_valid_plan_doc())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_OK", result.stdout)

    def test_validate_implementation_plan_doc_rejects_missing_model_decisions(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_without_reuse_evidence())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing required section: Model Decisions", result.stderr)

    def test_validate_implementation_plan_doc_rejects_missing_discovery_evidence(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_without_discovery_evidence())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("discovery-evidence", result.stderr)

    def test_validate_implementation_plan_doc_rejects_outcome_only_discovery_evidence(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_outcome_only_evidence())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("must cite at least one attempted tool call", result.stderr)

    def test_validate_implementation_plan_doc_accepts_explicit_greenfield_only_outcome(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "IntakeRegistry" / "plan.md"
            write_file(plan_path, build_valid_greenfield_plan_doc())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_OK", result.stdout)

    def test_validate_implementation_plan_doc_rejects_create_without_explicit_reuse_rejection_reason(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_without_create_rejection_reason())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("chosen-action: create must state why reuse or extension was rejected", result.stderr)

    def test_validate_implementation_plan_doc_rejects_schema_sync_without_matching_model_decision(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_without_matching_model_decision())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Ordered Schema Sync references UsrTaskComment without a matching Model Decisions record", result.stderr)

    def test_check_implementation_plan_gate_requires_plan_and_approval_gate(self):
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
            write_file(output_dir / "plan.md", build_valid_plan_doc())
            result = run_workflow_cli("check-implementation-plan-gate", "TodoList", workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_GATE_OK TodoList", result.stdout)

    def test_validate_implementation_plan_doc_accepts_reuse_action(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "ContactApp" / "plan.md"
            write_file(plan_path, build_valid_reuse_plan_doc())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_OK", result.stdout)

    def test_validate_implementation_plan_doc_accepts_extend_action(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "SupportApp" / "plan.md"
            write_file(plan_path, build_valid_extend_plan_doc())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_OK", result.stdout)

    def test_validate_implementation_plan_doc_accepts_multiple_decision_blocks(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TaskApp" / "plan.md"
            write_file(plan_path, build_valid_multi_block_plan_doc())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_OK", result.stdout)

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
