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
  tradeoff-escalation: none
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: platform task models do not match the approved scope
  candidate-fit-summary: existing task-like app models partially cover the concept
  required-capabilities: app-owned task lifecycle and dedicated UX
  mismatch-evidence: follow-up comparison was not captured

## Ordered Schema Sync

- Create the task schema.
"""


def build_invalid_plan_doc_without_create_rejection_reason():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: Activity, existing task-like app models, existing task-like schemas
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: custom app requested
  candidate-fit-summary: Activity appears adjacent to the task concept
  required-capabilities: app-owned task lifecycle and event-specific linkage
  mismatch-evidence: custom app requested
  discovery-evidence: application-get-list, dataforge-find-tables

## Ordered Schema Sync

- create UsrTask schema for the approved task model.
"""


def build_invalid_plan_doc_without_matching_model_decision():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: Activity, existing task-like app models, existing task-like schemas
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: Activity has unwanted coupling to a broader interaction lifecycle
  candidate-fit-summary: Activity covers owner and due date semantics
  required-capabilities: app-owned task lifecycle and simplified UX
  mismatch-evidence: dataforge-context and get-entity-schema-properties showed lifecycle and ownership mismatch
  discovery-evidence: application-get-list, dataforge-find-tables, dataforge-context, get-entity-schema-properties

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
  tradeoff-escalation: none
  rationale: Approved requirements define a net-new business object with no plausible reuse target
  rejected-candidates: no suitable candidate found
  candidate-fit-summary: no plausible existing candidate surfaced during planning
  required-capabilities: net-new intake record, app-owned lifecycle, custom review workflow
  mismatch-evidence: greenfield-only review after dataforge-find-tables and application-get-list found no viable candidate
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
  tradeoff-escalation: none
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: no suitable candidate found
  candidate-fit-summary: existing task-like models were considered
  required-capabilities: app-owned lifecycle and custom workflow
  mismatch-evidence: no concrete comparison captured
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
  tradeoff-escalation: none
  rationale: Platform Contact entity already satisfies the business role
  rejected-candidates: Account does not match the required persona semantics
  candidate-fit-summary: Contact already provides the required identity, communication, and ownership semantics
  required-capabilities: reusable person record with standard communication fields and existing ownership behavior
  mismatch-evidence: Account failed the persona comparison because it models organizations rather than individual people
  discovery-evidence: dataforge-find-tables, dataforge-context, get-entity-schema-properties

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
  tradeoff-escalation: none
  rationale: Existing UsrSupportCase matches but needs additional fields
  rejected-candidates: platform Case schema has unwanted coupling to service module
  candidate-fit-summary: UsrSupportCase already carries the core case identity and service workflow semantics
  required-capabilities: support record with additional approved diagnostics and escalation fields
  mismatch-evidence: platform Case was rejected because dataforge-context and get-entity-schema-properties showed service-module coupling beyond the approved app boundary
  discovery-evidence: dataforge-find-tables, dataforge-context, application-get-info, get-entity-schema-properties

## Ordered Schema Sync

- extend UsrSupportCase with additional approved columns.
"""


def build_valid_multi_block_plan_doc():
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

- business-concept: Task Status
  candidates-considered: existing status lookups
  chosen-action: create
  chosen-schema: UsrTaskStatus
  tradeoff-escalation: none
  rationale: App-specific lifecycle requires dedicated status lookup
  rejected-candidates: no suitable candidate found
  candidate-fit-summary: discovery did not surface a reusable lookup with the approved lifecycle
  required-capabilities: dedicated task lifecycle values with app-owned governance
  mismatch-evidence: dataforge-context and get-entity-schema-properties found no lookup schema that matched the approved status model
  discovery-evidence: dataforge-find-lookups, dataforge-context, get-entity-schema-properties, no suitable candidate found

- business-concept: Task Priority
  candidates-considered: existing priority lookups, ActivityPriority
  chosen-action: reuse
  chosen-schema: ActivityPriority
  tradeoff-escalation: none
  rationale: Platform priority lookup matches the required semantics exactly
  rejected-candidates: none
  candidate-fit-summary: ActivityPriority already contains the required priority values and display semantics
  required-capabilities: reusable priority lookup with stable ordering and existing display values
  mismatch-evidence: no other candidate provided a better match than ActivityPriority
  discovery-evidence: dataforge-find-lookups, dataforge-context, get-entity-schema-properties

## Ordered Schema Sync

- create UsrTaskStatus lookup for task lifecycle.
- create UsrTask schema for the approved task model.
"""


def build_invalid_plan_doc_missing_candidate_comparison_fields():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: Activity, existing task-like app models
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: Activity has unwanted coupling to broader lifecycle semantics
  discovery-evidence: dataforge-find-tables, dataforge-context, get-entity-schema-properties

## Ordered Schema Sync

- create UsrTask schema for the approved task model.
"""


def build_invalid_plan_doc_without_follow_up_evidence():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: Activity, existing task-like app models
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: Activity has unwanted coupling to a broader interaction lifecycle
  candidate-fit-summary: Activity looks adjacent to the task concept
  required-capabilities: app-owned lifecycle and simplified UX
  mismatch-evidence: broader platform object
  discovery-evidence: dataforge-find-tables

## Ordered Schema Sync

- create UsrTask schema for the approved task model.
"""


def build_invalid_plan_doc_outcome_only_rejection_without_schema_confirmation():
    return """# Implementation Plan

## Model Decisions

- business-concept: Task
  candidates-considered: Activity, existing task-like app models
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: MVP needs a dedicated task object for this app
  rejected-candidates: broader than approved scope
  candidate-fit-summary: Activity covers several task-like fields
  required-capabilities: app-owned lifecycle and event-specific linkage
  mismatch-evidence: broader than approved scope
  discovery-evidence: dataforge-find-tables, dataforge-context

## Ordered Schema Sync

- create UsrTask schema for the approved task model.
"""


def build_invalid_plan_doc_create_despite_capability_coverage():
    return """# Implementation Plan

## Model Decisions

- business-concept: Event Status
  candidates-considered: EventStatus
  chosen-action: create
  chosen-schema: UsrEventStatus
  tradeoff-escalation: none
  rationale: Keep the app isolated from the platform lookup
  rejected-candidates: shared lookup may diverge later
  candidate-fit-summary: EventStatus already contains In progress, Completed, and Canceled and covers the approved lifecycle exactly
  required-capabilities: reusable event lifecycle lookup with In progress, Completed, and Canceled values
  mismatch-evidence: shared platform lookup
  discovery-evidence: dataforge-find-lookups, dataforge-context, get-entity-schema-properties

## Ordered Schema Sync

- create UsrEventStatus lookup for event lifecycle.
"""


def build_valid_plan_doc_reuse_existing_lookup_despite_ba_custom_name():
    return """# Implementation Plan

## Model Decisions

- business-concept: Event Status
  candidates-considered: EventStatus, UsrEventStatus
  chosen-action: reuse
  chosen-schema: EventStatus
  tradeoff-escalation: none
  rationale: Live discovery showed the platform lookup already satisfies the approved lifecycle
  rejected-candidates: UsrEventStatus would duplicate an existing lifecycle without adding missing capability
  candidate-fit-summary: EventStatus already contains In progress, Completed, and Canceled and matches the approved lifecycle
  required-capabilities: reusable event lifecycle lookup with In progress, Completed, and Canceled values
  mismatch-evidence: custom lookup is unnecessary because the platform lookup already covers the required lifecycle values
  discovery-evidence: dataforge-find-lookups, dataforge-context, get-entity-schema-properties

## Ordered Schema Sync

- reuse EventStatus lookup for the approved event lifecycle.
"""


def build_valid_plan_doc_reuse_broader_candidate():
    return """# Implementation Plan

## Model Decisions

- business-concept: Event
  candidates-considered: Event
  chosen-action: reuse
  chosen-schema: Event
  tradeoff-escalation: none
  rationale: The existing Event schema already satisfies the approved event role for this MVP
  rejected-candidates: none
  candidate-fit-summary: Event already provides Name, Status, StartDate, EndDate, Owner, and optional descriptive carriers needed for the approved business flow
  required-capabilities: reusable event record with name, status, start date, end date, owner, and optional descriptive content
  mismatch-evidence: extra marketing-oriented fields remain optional and do not block the approved workflow
  discovery-evidence: dataforge-find-tables, dataforge-context, get-entity-schema-properties

## Ordered Schema Sync

- reuse Event schema as-is for the approved event model.
"""


def build_invalid_plan_doc_unresolved_tradeoff():
    return """# Implementation Plan

## Model Decisions

- business-concept: Event Status
  candidates-considered: EventStatus, UsrEventStatus
  chosen-action: reuse
  chosen-schema: EventStatus
  tradeoff-escalation: user-confirmation-required
  rationale: Reuse is technically viable but the ownership choice is still open
  rejected-candidates: UsrEventStatus could also work if the user wants full lifecycle isolation
  candidate-fit-summary: EventStatus already contains In progress, Completed, and Canceled and matches the approved lifecycle
  required-capabilities: reusable event lifecycle lookup with In progress, Completed, and Canceled values
  mismatch-evidence: the remaining difference is a product tradeoff about future lifecycle ownership, not a technical blocker
  discovery-evidence: dataforge-find-lookups, dataforge-context, get-entity-schema-properties

## Ordered Schema Sync

- reuse EventStatus lookup for the approved event lifecycle.
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

    def test_validate_request_spec_rejects_missing_planning_signals(self):
        with temp_workflow_root() as workflow_root:
            request_spec_path = Path(workflow_root) / "output" / "TodoList" / "request-spec.json"
            payload = build_valid_request_spec()
            payload.pop("planningSignals")
            write_file(request_spec_path, json.dumps(payload))
            result = run_workflow_cli("validate-request-spec", str(request_spec_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("planningSignals", result.stderr)

    def test_validate_request_spec_rejects_invalid_reuse_check_signal(self):
        with temp_workflow_root() as workflow_root:
            request_spec_path = Path(workflow_root) / "output" / "TodoList" / "request-spec.json"
            payload = build_valid_request_spec()
            payload["planningSignals"]["reuseCheckRequired"] = [
                {
                    "businessConcept": "Task",
                    "whyAmbiguous": "",
                    "suspectedCandidates": ["Activity"],
                }
            ]
            write_file(request_spec_path, json.dumps(payload))
            result = run_workflow_cli("validate-request-spec", str(request_spec_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("planningSignals.reuseCheckRequired[0].whyAmbiguous", result.stderr)

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

    def test_validate_implementation_plan_doc_rejects_missing_candidate_comparison_fields(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_missing_candidate_comparison_fields())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("candidate-fit-summary", result.stderr)

    def test_validate_implementation_plan_doc_rejects_outcome_only_discovery_evidence(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_outcome_only_evidence())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("must cite at least one attempted tool call", result.stderr)

    def test_validate_implementation_plan_doc_rejects_create_without_follow_up_evidence(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_without_follow_up_evidence())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("follow-up evidence", result.stderr)

    def test_validate_implementation_plan_doc_rejects_outcome_only_rejection_without_schema_confirmation(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "TodoList" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_outcome_only_rejection_without_schema_confirmation())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("schema-level confirmation", result.stderr)

    def test_validate_implementation_plan_doc_rejects_create_when_candidate_already_covers_required_capabilities(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "EventsApp" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_create_despite_capability_coverage())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("reuse-first", result.stderr)

    def test_validate_implementation_plan_doc_accepts_reuse_when_live_discovery_amends_ba_custom_lookup_assumption(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "EventsApp" / "plan.md"
            write_file(plan_path, build_valid_plan_doc_reuse_existing_lookup_despite_ba_custom_name())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_OK", result.stdout)

    def test_validate_implementation_plan_doc_accepts_reuse_for_broader_candidate_when_required_capabilities_are_covered(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "EventsApp" / "plan.md"
            write_file(plan_path, build_valid_plan_doc_reuse_broader_candidate())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("IMPLEMENTATION_PLAN_OK", result.stdout)

    def test_validate_implementation_plan_doc_rejects_unresolved_tradeoff_until_user_confirms_choice(self):
        with temp_workflow_root() as workflow_root:
            plan_path = Path(workflow_root) / "output" / "EventsApp" / "plan.md"
            write_file(plan_path, build_invalid_plan_doc_unresolved_tradeoff())
            result = run_workflow_cli("validate-implementation-plan-doc", str(plan_path), workflow_root=workflow_root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("user-confirmation-required", result.stderr)

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
