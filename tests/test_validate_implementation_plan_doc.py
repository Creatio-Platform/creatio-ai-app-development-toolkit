import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from workflow_validators import validate_implementation_plan_doc, WorkflowError

DECISION_BLOCK = """\
- business-concept: Task
  candidates-considered: Activity, Contact
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: user confirmed create over reuse after reviewing discovery evidence
  rejected-candidates: Activity has unwanted coupling to broader lifecycle and does not fit task boundary
  candidate-fit-summary: Activity covers assignee and completion semantics adjacent to the task concept
  required-capabilities: dedicated task lifecycle without inherited interaction semantics
  mismatch-evidence: dataforge-context confirmed Activity belongs to broader interaction model; get-entity-schema-properties showed required lifecycle cannot be satisfied
  discovery-evidence: dataforge-find-tables, dataforge-find-lookups, dataforge-context, get-entity-schema-properties\
"""

VALID_PLAN = f"""## Model Decisions

{DECISION_BLOCK}

## Ordered Schema Sync

- create UsrTask schema for the approved task model
"""

GREENFIELD_PLAN = """\
## Model Decisions

- business-concept: Task
  candidates-considered: none evaluated, greenfield-only
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: no existing entities match the task concept
  rejected-candidates: greenfield-only
  candidate-fit-summary: no candidates found
  required-capabilities: dedicated task lifecycle
  mismatch-evidence: no suitable candidate found
  discovery-evidence: dataforge-find-tables, dataforge-find-lookups, greenfield-only

## Ordered Schema Sync

- create UsrTask schema
"""

DATAFORGE_UNAVAILABLE_PLAN = """\
dataforge-availability: unavailable

## Model Decisions

- business-concept: Task
  candidates-considered: none evaluated, DataForge unavailable
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: DataForge unavailable during planning
  rejected-candidates: no suitable candidate found
  candidate-fit-summary: DataForge unavailable, no discovery performed
  required-capabilities: dedicated task lifecycle
  mismatch-evidence: no discovery performed due to DataForge unavailability
  discovery-evidence: no suitable candidate found

## Ordered Schema Sync

- create UsrTask schema
"""

CAPABILITY_FAILURE_PLAN = """\
## Model Decisions

- business-concept: Task
  candidates-considered: Activity
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: Activity does not fit the approved task boundary due to lifecycle mismatch
  rejected-candidates: Activity does not fit the approved task boundary; lifecycle mismatch with interaction model
  candidate-fit-summary: Activity has assignee and completion but required capabilities cannot be satisfied
  required-capabilities: dedicated task lifecycle, no inherited interaction semantics
  mismatch-evidence: required capability cannot be satisfied without unavoidable inherited behavior; unacceptable for the approved business flow
  discovery-evidence: dataforge-find-tables, dataforge-find-lookups, dataforge-context, get-entity-schema-properties

## Ordered Schema Sync

- create UsrTask schema
"""


class TestValidateImplementationPlanDocValid(unittest.TestCase):
    def test_valid_plan_passes(self):
        result = validate_implementation_plan_doc(VALID_PLAN)
        self.assertIsNone(result)

    def test_greenfield_only_plan_passes(self):
        result = validate_implementation_plan_doc(GREENFIELD_PLAN)
        self.assertIsNone(result)

    def test_dataforge_unavailable_bypasses_evidence_ladder(self):
        result = validate_implementation_plan_doc(DATAFORGE_UNAVAILABLE_PLAN)
        self.assertIsNone(result)

    def test_capability_failure_allows_create_without_user_confirmation(self):
        result = validate_implementation_plan_doc(CAPABILITY_FAILURE_PLAN)
        self.assertIsNone(result)


class TestValidateImplementationPlanDocMissingStructure(unittest.TestCase):
    def test_missing_model_decisions_heading(self):
        doc = VALID_PLAN.replace("## Model Decisions", "## Decisions")
        with self.assertRaises(WorkflowError) as ctx:
            validate_implementation_plan_doc(doc)
        self.assertIn("Model Decisions", str(ctx.exception))

    def test_missing_required_field_rationale(self):
        doc = VALID_PLAN.replace("  rationale: user confirmed create over reuse after reviewing discovery evidence\n", "")
        with self.assertRaises(WorkflowError) as ctx:
            validate_implementation_plan_doc(doc)
        self.assertIn("rationale", str(ctx.exception))

    def test_missing_required_field_discovery_evidence(self):
        doc = VALID_PLAN.replace(
            "  discovery-evidence: dataforge-find-tables, dataforge-find-lookups, dataforge-context, get-entity-schema-properties",
            "",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_implementation_plan_doc(doc)
        self.assertIn("discovery-evidence", str(ctx.exception))


class TestValidateImplementationPlanDocTradeoff(unittest.TestCase):
    def test_tradeoff_escalation_user_confirmation_required_blocks(self):
        doc = VALID_PLAN.replace("  tradeoff-escalation: none", "  tradeoff-escalation: user-confirmation-required")
        with self.assertRaises(WorkflowError) as ctx:
            validate_implementation_plan_doc(doc)
        self.assertIn("user-confirmation-required", str(ctx.exception))


class TestValidateImplementationPlanDocCreatePolicy(unittest.TestCase):
    def test_create_without_rejection_reason_fails(self):
        doc = VALID_PLAN.replace(
            "  rejected-candidates: Activity has unwanted coupling to broader lifecycle and does not fit task boundary",
            "  rejected-candidates: Activity",
        ).replace(
            "  mismatch-evidence: dataforge-context confirmed Activity belongs to broader interaction model; get-entity-schema-properties showed required lifecycle cannot be satisfied",
            "  mismatch-evidence: some differences exist",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_implementation_plan_doc(doc)
        self.assertIn("create", str(ctx.exception).lower())

    def test_create_against_strong_candidate_without_confirmation_or_capability_failure_fails(self):
        doc = f"""## Model Decisions

- business-concept: Task
  candidates-considered: Activity
  chosen-action: create
  chosen-schema: UsrTask
  tradeoff-escalation: none
  rationale: Activity is a broader platform object
  rejected-candidates: Activity is a shared platform lookup module coupling
  candidate-fit-summary: Activity covers adjacent semantics but broader than needed
  required-capabilities: dedicated task lifecycle
  mismatch-evidence: Activity broader than needed for this scope
  discovery-evidence: dataforge-find-tables, dataforge-find-lookups, dataforge-context, get-entity-schema-properties

## Ordered Schema Sync

- create UsrTask schema
"""
        with self.assertRaises(WorkflowError) as ctx:
            validate_implementation_plan_doc(doc)
        self.assertIn("create", str(ctx.exception).lower())


class TestValidateImplementationPlanDocSchemaSyncCrossRef(unittest.TestCase):
    def test_schema_sync_undeclared_schema_fails(self):
        doc = VALID_PLAN.replace("- create UsrTask schema for the approved task model", "- create UsrFoo schema")
        with self.assertRaises(WorkflowError) as ctx:
            validate_implementation_plan_doc(doc)
        self.assertIn("UsrFoo", str(ctx.exception))

    def test_schema_sync_declared_schema_passes(self):
        result = validate_implementation_plan_doc(VALID_PLAN)
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
