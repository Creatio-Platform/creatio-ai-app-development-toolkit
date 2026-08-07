import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.scripts.workflow_validators import validate_requirements_doc, WorkflowError


VALID_DOC = """# TestApp - Requirements

## 1. Business Outcome

Provide a shared task registry.

- Core problem: tasks are scattered.
- Success signal: team tracks work in one place.
- Assumptions: MVP uses a single workflow.

## 2. Roles and Permissions

- Team member: creates and updates tasks

## 3. Object Model

### 3.1 Section object: Task

**Title:** Task
**Code:** `UsrTask`
**Primary display field:** `Name`
**Description:** Central work item.

| Title | Code | Description | Data type | Required | Default |
| --- | --- | --- | --- | --- | --- |
| Name | `Name` | Task title | Short text | Yes | - |
| Status | `UsrStatusId` | Lifecycle state | Lookup | Yes | New |

Minimum to create:
- Name
- Status

### 3.2 Lookups

- Title: Status; Code: `UsrTaskStatus`; Allowed values: New, Active, Done

## 4. Lifecycle and Statuses

Tasks move through New, Active, and Done.

## 5. Business Logic

- Name and Status are required to create a task.

## 6. UX Expectations

- list columns: Name, Status
- list filters: Status
- form groups: Main information

## 7. Analytics

### 7.1 Section analytics

#### Tasks section dashboards

- dashboard: Task overview
  - access rights: All Employees
  - scope: open tasks by status
  - widgets: metric — open tasks count; chart — tasks by status (bar)

### 7.2 Workplace analytics

- home page: Team overview
  - scope: how the whole team is performing right now
  - widgets: metric — total tasks; metric — open tasks; list — tasks due this week

## 8. Edge Cases and Exceptions

- Done tasks are excluded from active views.
"""


class TestValidateRequirementsDocSections(unittest.TestCase):
    def test_valid_doc_passes(self):
        validate_requirements_doc(VALID_DOC)  # must not raise

    def test_missing_section_2_roles_and_permissions(self):
        doc = VALID_DOC.replace("## 2. Roles and Permissions", "## 2. Team Roles")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 2. Roles and Permissions", str(ctx.exception))

    def test_missing_section_1_business_outcome(self):
        doc = VALID_DOC.replace("## 1. Business Outcome", "## 1. Overview")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 1. Business Outcome", str(ctx.exception))

    def test_missing_section_3_object_model(self):
        doc = VALID_DOC.replace("## 3. Object Model", "## 3. Data Model")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 3. Object Model", str(ctx.exception))

    def test_missing_section_4_lifecycle(self):
        doc = VALID_DOC.replace("## 4. Lifecycle and Statuses", "## 4. State Machine")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 4. Lifecycle and Statuses", str(ctx.exception))

    def test_missing_section_5_business_logic(self):
        doc = VALID_DOC.replace("## 5. Business Logic", "## 5. Rules")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 5. Business Logic", str(ctx.exception))

    def test_missing_section_6_ux(self):
        doc = VALID_DOC.replace("## 6. UX Expectations", "## 6. User Interface")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 6. UX Expectations", str(ctx.exception))

    def test_missing_section_7_analytics(self):
        doc = VALID_DOC.replace("## 7. Analytics", "## 7. Reporting")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 7. Analytics", str(ctx.exception))

    def test_missing_section_8_edge_cases(self):
        doc = VALID_DOC.replace("## 8. Edge Cases and Exceptions", "## 8. Notes")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 8. Edge Cases and Exceptions", str(ctx.exception))


class TestValidateRequirementsDocAnalytics(unittest.TestCase):
    def test_missing_section_analytics_subsection(self):
        doc = VALID_DOC.replace("### 7.1 Section analytics", "### 7.1 Reports")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("7.1 Section analytics", str(ctx.exception))

    def test_missing_workplace_analytics_subsection(self):
        doc = VALID_DOC.replace("### 7.2 Workplace analytics", "### 7.2 Company reports")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("7.2 Workplace analytics", str(ctx.exception))

    def test_missing_dashboard_label_is_rejected(self):
        # An analytics section with the subheadings but no concrete `dashboard:`
        # block is a placeholder — it must fail the "must be populated" rule.
        doc = VALID_DOC.replace("- dashboard: Task overview", "- Task overview").replace(
            "- dashboard: Team workload", "- Team workload"
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("dashboard:", str(ctx.exception))

    def test_missing_widgets_label_is_rejected(self):
        doc = VALID_DOC.replace(
            "  - widgets: metric — open tasks count; chart — tasks by status (bar)", ""
        ).replace("  - widgets: metric — total tasks; list — tasks due this week", "")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("widgets:", str(ctx.exception))

    def test_flat_section_analytics_without_section_grouping_is_rejected(self):
        # 7.1 must group dashboards by section under a `#### <Section> section
        # dashboards` heading; a flat list (grouping heading removed) must fail.
        doc = VALID_DOC.replace("#### Tasks section dashboards\n\n", "")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("section dashboards", str(ctx.exception))

    def test_grouping_heading_only_under_72_does_not_satisfy_71(self):
        # The 7.1 grouping check must be scoped to the 7.1 slice: a flat 7.1 must
        # NOT pass just because a `... section dashboards` heading exists under 7.2.
        doc = VALID_DOC.replace("#### Tasks section dashboards\n\n", "")  # 7.1 now flat
        doc = doc.replace(
            "### 7.2 Workplace analytics\n",
            "### 7.2 Workplace analytics\n\n#### Company section dashboards\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("7.1", str(ctx.exception))

    def test_workplace_home_page_missing_widgets_is_rejected(self):
        # The §7.2 home page must list its own widgets (it is the app's single home
        # page — populated with metrics/charts, not left as a bare title).
        doc = VALID_DOC.replace(
            "  - widgets: metric — total tasks; metric — open tasks; list — tasks due this week\n",
            "",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("widgets", str(ctx.exception).lower())

    def test_widgets_missing_on_leading_dashboard_is_rejected(self):
        # Symmetric to the above but strips the 7.1 (leading) dashboard's widgets,
        # exercising the non-terminal block boundary (end == next dashboard start).
        doc = VALID_DOC.replace(
            "  - widgets: metric — open tasks count; chart — tasks by status (bar)", ""
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("widgets:", str(ctx.exception))

    def test_empty_section_analytics_71_is_rejected(self):
        # 7.1 must carry at least one dashboard, not just a grouping heading. Drop
        # the only 7.1 dashboard block (keep its heading); the 7.2 dashboard remains.
        doc = VALID_DOC.replace(
            "- dashboard: Task overview\n"
            "  - access rights: All Employees\n"
            "  - scope: open tasks by status\n"
            "  - widgets: metric — open tasks count; chart — tasks by status (bar)\n",
            "",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("7.1", str(ctx.exception))

    def test_access_rights_missing_on_a_dashboard_is_rejected(self):
        # Every dashboard must state its access rights in the plan (surfaced to the
        # developer). Drop the 7.1 dashboard's access-rights line; 7.2 keeps its own.
        doc = VALID_DOC.replace("  - access rights: All Employees\n  - scope: open tasks by status\n", "  - scope: open tasks by status\n")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("access rights:", str(ctx.exception))

    def test_empty_access_rights_value_is_rejected(self):
        # Presence of the label is not enough: the value after `access rights:` must
        # be non-empty (an agent leaving it blank must not pass).
        doc = VALID_DOC.replace(
            "- dashboard: Task overview\n  - access rights: All Employees\n",
            "- dashboard: Task overview\n  - access rights:\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("access rights:", str(ctx.exception))

    def test_non_all_employees_access_rights_is_rejected(self):
        # Access is a STATIC default: the validator pins the exact value
        # `All Employees`. A narrower/other grant (e.g. a role name) must fail, so an
        # agent cannot silently invent a different access scope.
        doc = VALID_DOC.replace(
            "- dashboard: Task overview\n  - access rights: All Employees\n",
            "- dashboard: Task overview\n  - access rights: Managers\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("All Employees", str(ctx.exception))

    def test_empty_widgets_value_is_rejected(self):
        # Same non-empty-value rule for widgets: a bare `widgets:` must fail.
        doc = VALID_DOC.replace(
            "  - widgets: metric — open tasks count; chart — tasks by status (bar)\n",
            "  - widgets:\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("widgets:", str(ctx.exception))

    def test_missing_scope_on_71_dashboard_is_rejected(self):
        # `scope:` is a mandatory §7.1 dashboard field (never empty/TBD), enforced
        # like `widgets:`. Dropping it must fail.
        doc = VALID_DOC.replace("  - scope: open tasks by status\n", "")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("scope:", str(ctx.exception))

    def test_empty_scope_value_on_71_dashboard_is_rejected(self):
        # Presence of the label is not enough — the value after `scope:` must be
        # non-empty.
        doc = VALID_DOC.replace(
            "  - scope: open tasks by status\n", "  - scope:\n"
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("scope:", str(ctx.exception))

    def test_missing_scope_on_72_home_page_is_rejected(self):
        # The §7.2 home page must also state its `scope:`.
        doc = VALID_DOC.replace(
            "  - scope: how the whole team is performing right now\n", ""
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("scope:", str(ctx.exception))

    def test_order_of_71_and_72_does_not_matter_when_both_populated(self):
        # The requirement is "both subsections present AND both populated" — the
        # order between 7.1 and 7.2 is irrelevant. A doc that lists 7.2 before 7.1,
        # with both populated, must still PASS (not be rejected on layout).
        sec71 = (
            "### 7.1 Section analytics\n\n"
            "#### Tasks section dashboards\n\n"
            "- dashboard: Task overview\n"
            "  - access rights: All Employees\n"
            "  - scope: open tasks by status\n"
            "  - widgets: metric — open tasks count; chart — tasks by status (bar)\n\n"
        )
        sec72 = (
            "### 7.2 Workplace analytics\n\n"
            "- home page: Team overview\n"
            "  - scope: how the whole team is performing right now\n"
            "  - widgets: metric — total tasks; metric — open tasks; list — tasks due this week\n\n"
        )
        assert sec71 in VALID_DOC, "fixture block 7.1 drifted"
        assert sec72 in VALID_DOC, "fixture block 7.2 drifted"
        doc = VALID_DOC.replace(sec71 + sec72, sec72 + sec71)  # 7.2 now precedes 7.1
        validate_requirements_doc(doc)  # must not raise

    def test_empty_workplace_analytics_72_is_rejected(self):
        # 7.2 must not be empty: drop its home-page block, leaving 7.1 intact.
        doc = VALID_DOC.replace(
            "- home page: Team overview\n"
            "  - scope: how the whole team is performing right now\n"
            "  - widgets: metric — total tasks; metric — open tasks; list — tasks due this week\n",
            "",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("7.2", str(ctx.exception))

    def test_workplace_analytics_with_dashboard_is_rejected(self):
        # 7.2 is the app's single home page, NOT dashboards. A `dashboard:` block
        # under 7.2 (the mistake this guard exists for) must be rejected.
        doc = VALID_DOC.replace(
            "- home page: Team overview\n"
            "  - scope: how the whole team is performing right now\n",
            "- dashboard: Team overview\n"
            "  - access rights: All Employees\n"
            "  - scope: how the whole team is performing right now\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("7.2", str(ctx.exception))

    def test_workplace_home_page_with_access_rights_is_rejected(self):
        # A home page has no per-page access rights (its audience is the workplace);
        # an `access rights:` line under 7.2 must be rejected.
        doc = VALID_DOC.replace(
            "- home page: Team overview\n"
            "  - scope: how the whole team is performing right now\n",
            "- home page: Team overview\n"
            "  - access rights: All Employees\n"
            "  - scope: how the whole team is performing right now\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("access rights", str(ctx.exception).lower())

    def test_two_home_pages_in_72_is_rejected(self):
        # 7.2 is a single page — more than one `home page:` block must be rejected.
        doc = VALID_DOC.replace(
            "- home page: Team overview\n"
            "  - scope: how the whole team is performing right now\n"
            "  - widgets: metric — total tasks; metric — open tasks; list — tasks due this week\n",
            "- home page: Team overview\n"
            "  - scope: how the whole team is performing right now\n"
            "  - widgets: metric — total tasks; metric — open tasks; list — tasks due this week\n\n"
            "- home page: Second page\n"
            "  - scope: extra\n"
            "  - widgets: metric — total tasks\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("home page", str(ctx.exception).lower())

    def test_two_section_grouping_headings_in_71_pass(self):
        # A real multi-section app has more than one `#### <Section> section
        # dashboards` heading under §7.1, each with its own dashboards. The validator
        # must accept several grouping headings and check every dashboard's own
        # access-rights/widgets lines across all groups.
        second_group = (
            "\n#### Contacts section dashboards\n\n"
            "- dashboard: Contact directory\n"
            "  - access rights: All Employees\n"
            "  - scope: contacts by owner\n"
            "  - widgets: metric — total contacts; chart — contacts by owner (bar)\n"
        )
        anchor = "  - widgets: metric — open tasks count; chart — tasks by status (bar)\n"
        assert anchor in VALID_DOC, "fixture 7.1 dashboard drifted"
        doc = VALID_DOC.replace(anchor, anchor + second_group)
        validate_requirements_doc(doc)  # must not raise (two grouping headings in 7.1)

    def test_dashboard_before_first_grouping_heading_is_rejected(self):
        # A dashboard that floats before the first `#### <Section> section dashboards`
        # heading is not grouped — the grouping check must catch it (a lone heading
        # elsewhere in §7.1 must not rescue a flat/floating dashboard).
        floating = (
            "- dashboard: Floating overview\n"
            "  - access rights: All Employees\n"
            "  - scope: everything\n"
            "  - widgets: metric — everything\n\n"
        )
        anchor = "#### Tasks section dashboards\n"
        assert anchor in VALID_DOC, "fixture 7.1 heading drifted"
        doc = VALID_DOC.replace(anchor, floating + anchor)  # dashboard before the heading
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("before the first grouping heading", str(ctx.exception))

    def test_empty_grouping_heading_is_rejected(self):
        # A `#### <Section> section dashboards` heading with no dashboard under it
        # (dashboards from several sections lumped under a single earlier heading,
        # leaving later headings empty) must be rejected.
        doc = VALID_DOC.replace(
            "### 7.2 Workplace analytics",
            "#### Contacts section dashboards\n\n### 7.2 Workplace analytics",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("at least one 'dashboard:' under it", str(ctx.exception))


class TestValidateRequirementsDocTables(unittest.TestCase):
    def test_missing_field_table_in_entity_block(self):
        doc = VALID_DOC.replace(
            "| Title | Code | Description | Data type | Required | Default |\n"
            "| --- | --- | --- | --- | --- | --- |\n"
            "| Name | `Name` | Task title | Short text | Yes | - |\n"
            "| Status | `UsrStatusId` | Lifecycle state | Lookup | Yes | New |\n",
            ""
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("field table", str(ctx.exception).lower())


class TestValidateRequirementsDocMarkers(unittest.TestCase):
    def test_missing_minimum_to_create_marker(self):
        doc = VALID_DOC.replace("Minimum to create:", "Required fields:")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Minimum to create:", str(ctx.exception))

    def test_missing_list_columns_marker(self):
        doc = VALID_DOC.replace("- list columns:", "- columns:")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("list columns:", str(ctx.exception))

    def test_retired_default_list_columns_label_is_rejected(self):
        # The retired `default list columns:` label ends with `list columns:`, so a
        # plain substring check would let an un-migrated doc pass silently.
        doc = VALID_DOC.replace("- list columns: Name, Status", "- default list columns: Name, Status")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("default list", str(ctx.exception).lower())

    def test_retired_default_list_filters_label_is_rejected(self):
        doc = VALID_DOC.replace("- list filters: Status", "- default list filters: Status")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("default list", str(ctx.exception).lower())

    def test_list_filters_carrier_resolves(self):
        # filters branch of UX_CARRIER_RE: a filter title present in the object
        # model must resolve to a carrier and pass.
        doc = VALID_DOC.replace("- list filters: Status", "- list filters: Status, Name")
        validate_requirements_doc(doc)  # must not raise

    def test_list_filters_title_without_carrier_is_rejected(self):
        # Complementary negative for the filters branch: a filter title with no
        # carrier in section 3 must be rejected (guards against the branch silently
        # never running).
        doc = VALID_DOC.replace("- list filters: Status", "- list filters: Nonexistent")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Nonexistent", str(ctx.exception))


class TestValidateRequirementsDocObjectMetadata(unittest.TestCase):
    def test_missing_title_line_in_entity(self):
        doc = VALID_DOC.replace("**Title:** Task\n", "").replace("- Title: Status;", "- Status;")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Title:", str(ctx.exception))

    def test_missing_description_marker(self):
        doc = VALID_DOC.replace("**Description:** Central work item.\n", "")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Description:", str(ctx.exception))

    def test_missing_title_heading(self):
        doc = VALID_DOC.replace("# TestApp - Requirements", "# TestApp Notes")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("title must match", str(ctx.exception))

    def test_missing_code_marker(self):
        # `Code:` appears in both the object block and the lookup row, and the
        # object block extends through the Lookups subsection, so drop both.
        doc = VALID_DOC.replace("**Code:** `UsrTask`\n", "").replace("Code: `UsrTaskStatus`", "`UsrTaskStatus`")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Code:", str(ctx.exception))

    def test_missing_primary_display_field_marker(self):
        doc = VALID_DOC.replace("**Primary display field:** `Name`\n", "")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Primary display field:", str(ctx.exception))

    def test_object_role_and_purpose_are_optional(self):
        # `Object role:` / `Purpose:` were dropped from the required metadata
        # markers; VALID_DOC carries neither, and their absence must not fail.
        self.assertNotIn("Object role:", VALID_DOC)
        self.assertNotIn("Purpose:", VALID_DOC)
        validate_requirements_doc(VALID_DOC)  # must not raise


class TestValidateRequirementsDocRelatedListInline(unittest.TestCase):
    @staticmethod
    def _doc_with_related_list(*extra_lines):
        anchor = "- form groups: Main information\n"
        assert anchor in VALID_DOC, "fixture anchor missing from VALID_DOC"
        block = "\n\n- Related list Subtasks\n  - list columns: Name, Status\n" + "".join(
            f"  {line}\n" for line in extra_lines
        )
        return VALID_DOC.replace(anchor, anchor + block)

    def test_inline_related_list_rejects_each_page_or_form_label(self):
        for label in (
            "form fields: Name, Status",
            "form groups: Main",
            "add page: mini page (Name)",
            "edit page: full record page",
        ):
            with self.subTest(label=label):
                doc = self._doc_with_related_list("add/edit: inline in the list", label)
                with self.assertRaises(WorkflowError) as ctx:
                    validate_requirements_doc(doc)
                self.assertIn("inline related list", str(ctx.exception))

    def test_digit_named_related_list_surface_is_not_a_false_conflict(self):
        # A surface NAME may start with a digit (e.g. "360 Reviews"). It must be
        # detected as its own surface so an adjacent inline list does not absorb
        # its page/form labels and raise a false conflict.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- form groups: Main information\n\n"
            "- Related list Subtasks\n  - list columns: Name, Status\n  - add/edit: inline in the list\n\n"
            "- Related list 360 Reviews\n  - list columns: Name, Status\n"
            "  - add page: mini page (Name)\n  - edit page: full record page\n  - form fields: Name, Status\n",
        )
        validate_requirements_doc(doc)  # must not raise (two distinct surfaces)

    def test_inline_related_list_without_page_labels_passes(self):
        doc = self._doc_with_related_list("add/edit: inline in the list")
        validate_requirements_doc(doc)  # must not raise

    def test_default_mini_page_related_list_passes(self):
        doc = self._doc_with_related_list(
            "add page: mini page (Name, Status)",
            "edit page: full record page",
            "form fields: Name, Status",
        )
        validate_requirements_doc(doc)  # must not raise

    def test_inline_related_list_then_section_with_form_labels_passes(self):
        # Regression: a trailing Section's page/form labels must NOT fold into
        # the preceding inline related list's block.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- form groups: Main information\n\n"
            "- Related list Subtasks\n  - list columns: Name, Status\n  - add/edit: inline in the list\n\n"
            "- Section Reports\n  - list columns: Name\n  - form groups: Overview\n",
        )
        validate_requirements_doc(doc)  # must not raise

    def test_backticked_bold_related_list_heading_is_detected(self):
        # The §6 contract renders a surface as `- **`Related list <name>`**`. The
        # heading regex must match that form, otherwise the inline conflict check
        # silently becomes a no-op on contract-conforming plans.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- form groups: Main information\n\n"
            "- **`Related list Subtasks`**\n  - list columns: Name, Status\n"
            "  - add/edit: inline in the list\n  - form groups: Main\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("inline related list", str(ctx.exception))

    def test_cyrillic_named_related_list_surface_is_detected(self):
        # The code comment at the surface regex claims non-Latin (Cyrillic) names
        # are supported; pin it — a Cyrillic-named surface must still be detected
        # so its own inline/page-label conflict fires.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- form groups: Main information\n\n"
            "- Related list Підрядники\n  - list columns: Name, Status\n"
            "  - add/edit: inline in the list\n  - add page: mini page (Name)\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("inline related list", str(ctx.exception))

    def test_inline_related_list_then_bare_section_object_bullets_pass(self):
        # A heading-less surface (the section object, or the "single full page"
        # option) is described with bare top-level `form groups:` bullets. Those
        # must NOT be absorbed into a preceding inline related list's block, which
        # would raise a false conflict.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- Related list Subtasks\n  - list columns: Name, Status\n"
            "  - add/edit: inline in the list\n"
            "- form groups: Main information\n",
        )
        validate_requirements_doc(doc)  # must not raise


if __name__ == "__main__":
    unittest.main()
