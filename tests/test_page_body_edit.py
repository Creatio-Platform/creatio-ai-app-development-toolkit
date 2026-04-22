import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.page_body_edit import (
    _derive_attr_key,
    add_form_fields,
    add_list_columns,
    detect_vm_marker,
    discover_form_container,
    find_max_row_index,
    replace_marker_content,
    validate_body_structure,
)
from scripts.page_body_tools import extract_attribute_paths, parse_marker_json

FIXTURES = ROOT / "tests" / "fixtures"


FORM_PAGE_BODY = """define("UsrTest_FormPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
\treturn {
\t\tviewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "insert",
\t\t\t\t"name": "Name",
\t\t\t\t"values": {
\t\t\t\t\t"layoutConfig": {
\t\t\t\t\t\t"column": 1,
\t\t\t\t\t\t"row": 1,
\t\t\t\t\t\t"colSpan": 1,
\t\t\t\t\t\t"rowSpan": 1
\t\t\t\t\t},
\t\t\t\t\t"type": "crt.Input",
\t\t\t\t\t"label": "$Resources.Strings.Name",
\t\t\t\t\t"control": "$Name"
\t\t\t\t},
\t\t\t\t"parentName": "SideAreaProfileContainer",
\t\t\t\t"propertyName": "items",
\t\t\t\t"index": 0
\t\t\t},
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"name": "Feed",
\t\t\t\t"values": {
\t\t\t\t\t"type": "crt.Feed",
\t\t\t\t\t"dataSourceName": "PDS"
\t\t\t\t},
\t\t\t\t"parentName": "FeedTabContainer",
\t\t\t\t"propertyName": "items",
\t\t\t\t"index": 0
\t\t\t}
\t\t]/**SCHEMA_VIEW_CONFIG_DIFF*/,
\t\tviewModelConfig: /**SCHEMA_VIEW_MODEL_CONFIG*/{
\t\t\t"attributes": {
\t\t\t\t"Name": {
\t\t\t\t\t"modelConfig": {
\t\t\t\t\t\t"path": "PDS.Name"
\t\t\t\t\t}
\t\t\t\t},
\t\t\t\t"Id": {
\t\t\t\t\t"modelConfig": {
\t\t\t\t\t\t"path": "PDS.Id"
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t}/**SCHEMA_VIEW_MODEL_CONFIG*/,
\t\tmodelConfig: /**SCHEMA_MODEL_CONFIG*/{
\t\t\t"dataSources": {
\t\t\t\t"PDS": {
\t\t\t\t\t"type": "crt.EntityDataSource",
\t\t\t\t\t"config": {
\t\t\t\t\t\t"entitySchemaName": "UsrTest"
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t}/**SCHEMA_MODEL_CONFIG*/,
\t\thandlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
\t\tconverters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
\t\tvalidators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
\t};
});"""


LIST_PAGE_BODY = """define("UsrTest_ListPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
\treturn {
\t\tviewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"name": "DataTable",
\t\t\t\t"values": {
\t\t\t\t\t"columns": [
\t\t\t\t\t\t{
\t\t\t\t\t\t\t"id": "aaa-bbb",
\t\t\t\t\t\t\t"code": "PDS_Name",
\t\t\t\t\t\t\t"caption": "#ResourceString(PDS_Name)#",
\t\t\t\t\t\t\t"dataValueType": 1
\t\t\t\t\t\t},
\t\t\t\t\t]
\t\t\t\t}
\t\t\t}
\t\t]/**SCHEMA_VIEW_CONFIG_DIFF*/,
\t\tviewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"path": [
\t\t\t\t\t"attributes",
\t\t\t\t\t"Items",
\t\t\t\t\t"viewModelConfig",
\t\t\t\t\t"attributes"
\t\t\t\t],
\t\t\t\t"values": {
\t\t\t\t\t"PDS_Name": {
\t\t\t\t\t\t"modelConfig": {
\t\t\t\t\t\t\t"path": "PDS.Name"
\t\t\t\t\t\t}
\t\t\t\t\t},
\t\t\t\t}
\t\t\t}
\t\t]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
\t\tmodelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"path": ["dataSources", "PDS", "config"],
\t\t\t\t"values": {
\t\t\t\t\t"entitySchemaName": "UsrTest"
\t\t\t\t}
\t\t\t}
\t\t]/**SCHEMA_MODEL_CONFIG_DIFF*/,
\t\thandlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
\t\tconverters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
\t\tvalidators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
\t};
});"""


class TestValidateBodyStructure(unittest.TestCase):
    def test_valid_form_page(self):
        result = validate_body_structure(FORM_PAGE_BODY)
        self.assertTrue(result["valid"])
        self.assertEqual(result["errors"], [])

    def test_valid_list_page(self):
        result = validate_body_structure(LIST_PAGE_BODY)
        self.assertTrue(result["valid"])
        self.assertEqual(result["errors"], [])

    def test_missing_marker_detected(self):
        broken = FORM_PAGE_BODY.replace("/**SCHEMA_HANDLERS*/", "")
        result = validate_body_structure(broken)
        self.assertFalse(result["valid"])
        self.assertTrue(any("SCHEMA_HANDLERS" in e for e in result["errors"]))


class TestDetectVmMarker(unittest.TestCase):
    def test_detects_object_variant(self):
        self.assertEqual(detect_vm_marker(FORM_PAGE_BODY), "SCHEMA_VIEW_MODEL_CONFIG")

    def test_detects_diff_variant(self):
        self.assertEqual(detect_vm_marker(LIST_PAGE_BODY), "SCHEMA_VIEW_MODEL_CONFIG_DIFF")


class TestDiscoverFormContainer(unittest.TestCase):
    def test_standard_form_page(self):
        view_config = [
            {"operation": "insert", "name": "Name", "parentName": "SideAreaProfileContainer",
             "propertyName": "items", "index": 0, "values": {"layoutConfig": {"row": 1}, "type": "crt.Input"}},
            {"operation": "insert", "name": "Status", "parentName": "SideAreaProfileContainer",
             "propertyName": "items", "index": 1, "values": {"layoutConfig": {"row": 2}, "type": "crt.ComboBox"}},
            {"operation": "merge", "name": "Feed", "values": {"type": "crt.Feed"}},
        ]
        self.assertEqual(discover_form_container(view_config), "SideAreaProfileContainer")

    def test_custom_container(self):
        view_config = [
            {"operation": "insert", "name": "Name", "parentName": "GeneralInfoTab",
             "propertyName": "items", "index": 0, "values": {"layoutConfig": {"row": 1}, "type": "crt.Input"}},
            {"operation": "insert", "name": "Code", "parentName": "GeneralInfoTab",
             "propertyName": "items", "index": 1, "values": {"layoutConfig": {"row": 2}, "type": "crt.Input"}},
        ]
        self.assertEqual(discover_form_container(view_config), "GeneralInfoTab")

    def test_empty_view_config(self):
        self.assertIsNone(discover_form_container([]))

    def test_no_field_inserts(self):
        view_config = [
            {"operation": "merge", "name": "SomeWidget", "values": {"visible": True}},
            {"operation": "insert", "name": "Tab1", "parentName": "TabPanel",
             "propertyName": "items", "index": 0, "values": {"type": "crt.TabPanel"}},
        ]
        self.assertIsNone(discover_form_container(view_config))

    def test_multiple_containers_picks_most_frequent(self):
        view_config = [
            {"operation": "insert", "name": "F1", "parentName": "ContainerA",
             "propertyName": "items", "index": 0, "values": {"layoutConfig": {"row": 1}, "type": "crt.Input"}},
            {"operation": "insert", "name": "F2", "parentName": "ContainerB",
             "propertyName": "items", "index": 0, "values": {"layoutConfig": {"row": 1}, "type": "crt.Input"}},
            {"operation": "insert", "name": "F3", "parentName": "ContainerB",
             "propertyName": "items", "index": 1, "values": {"layoutConfig": {"row": 2}, "type": "crt.ComboBox"}},
            {"operation": "insert", "name": "F4", "parentName": "ContainerB",
             "propertyName": "items", "index": 2, "values": {"layoutConfig": {"row": 3}, "type": "crt.DateTimePicker"}},
        ]
        self.assertEqual(discover_form_container(view_config), "ContainerB")

    def test_ignores_non_field_inserts(self):
        view_config = [
            {"operation": "insert", "name": "Btn1", "parentName": "ButtonContainer",
             "propertyName": "items", "index": 0, "values": {"layoutConfig": {"row": 1}, "type": "crt.Button"}},
            {"operation": "insert", "name": "F1", "parentName": "FieldContainer",
             "propertyName": "items", "index": 0, "values": {"layoutConfig": {"row": 1}, "type": "crt.Input"}},
        ]
        self.assertEqual(discover_form_container(view_config), "FieldContainer")


class TestAddFormFieldsDynamicContainer(unittest.TestCase):
    def test_discovers_container_from_existing_fields(self):
        body_with_custom = FORM_PAGE_BODY.replace("SideAreaProfileContainer", "CustomFormContainer")
        fields = [
            {"name": "UsrNew", "type": "crt.Input", "path": "PDS.UsrNew"},
        ]
        result = add_form_fields(body_with_custom, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        new_insert = next(op for op in view_config if op.get("name") == "PDS_UsrNew")
        self.assertEqual(new_insert["parentName"], "CustomFormContainer")

    def test_explicit_parent_overrides_discovery(self):
        fields = [
            {"name": "UsrNew", "type": "crt.Input", "path": "PDS.UsrNew", "parentName": "MyExplicitContainer"},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        new_insert = next(op for op in view_config if op.get("name") == "PDS_UsrNew")
        self.assertEqual(new_insert["parentName"], "MyExplicitContainer")

    def test_missing_path_raises_error(self):
        fields = [{"name": "UsrBadField", "type": "crt.Input", "label": "Bad"}]
        with self.assertRaises(Exception) as ctx:
            add_form_fields(FORM_PAGE_BODY, fields)
        self.assertIn("missing required 'path'", str(ctx.exception))
        self.assertIn("UsrBadField", str(ctx.exception))


class TestAddFormFields(unittest.TestCase):
    def test_adds_fields_to_form_page(self):
        fields = [
            {"name": "UsrStatus", "type": "crt.ComboBox", "path": "PDS.UsrStatus"},
            {"name": "UsrDueDate", "type": "crt.DateTimePicker", "path": "PDS.UsrDueDate", "pickerType": "date"},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        validation = validate_body_structure(result)
        self.assertTrue(validation["valid"], f"Validation errors: {validation['errors']}")
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        insert_names = [op["name"] for op in view_config if op.get("operation") == "insert"]
        self.assertIn("PDS_UsrStatus", insert_names)
        self.assertIn("PDS_UsrDueDate", insert_names)
        status_insert = next(op for op in view_config if op.get("name") == "PDS_UsrStatus")
        self.assertEqual(status_insert["values"]["type"], "crt.ComboBox")
        self.assertEqual(status_insert["values"]["control"], "$PDS_UsrStatus")
        self.assertEqual(status_insert["parentName"], "SideAreaProfileContainer")
        self.assertEqual(status_insert["values"]["layoutConfig"]["row"], 2)
        due_insert = next(op for op in view_config if op.get("name") == "PDS_UsrDueDate")
        self.assertEqual(due_insert["values"]["type"], "crt.DateTimePicker")
        self.assertEqual(due_insert["values"]["pickerType"], "date")
        self.assertEqual(due_insert["values"]["layoutConfig"]["row"], 3)

    def test_adds_attributes_to_view_model_config_object(self):
        fields = [
            {"name": "UsrStatus", "type": "crt.ComboBox", "path": "PDS.UsrStatus"},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        attr_paths = extract_attribute_paths(result)
        self.assertEqual(attr_paths["PDS_UsrStatus"], "PDS.UsrStatus")
        self.assertEqual(attr_paths["Name"], "PDS.Name")

    def test_skips_existing_fields(self):
        fields = [
            {"name": "Name", "type": "crt.Input", "path": "PDS.Name", "attrKey": "Name"},
            {"name": "UsrNew", "type": "crt.Input", "path": "PDS.UsrNew"},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        name_inserts = [op for op in view_config if op.get("name") == "Name" and op.get("operation") == "insert"]
        self.assertEqual(len(name_inserts), 1)
        usr_inserts = [op for op in view_config if op.get("name") == "PDS_UsrNew"]
        self.assertEqual(len(usr_inserts), 1)

    def test_multiline_input_field(self):
        fields = [
            {"name": "UsrDescription", "type": "crt.Input", "path": "PDS.UsrDescription", "multiline": True},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        desc_insert = next(op for op in view_config if op.get("name") == "PDS_UsrDescription")
        self.assertTrue(desc_insert["values"]["multiline"])

    def test_preserves_non_insert_operations(self):
        fields = [
            {"name": "UsrField", "type": "crt.Input", "path": "PDS.UsrField"},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        feed_ops = [op for op in view_config if op.get("name") == "Feed"]
        self.assertEqual(len(feed_ops), 1)
        self.assertEqual(feed_ops[0]["operation"], "merge")


class TestDeriveAttrKey(unittest.TestCase):
    def test_pds_path_produces_pds_prefixed_key(self):
        self.assertEqual(_derive_attr_key({"name": "UsrName", "path": "PDS.UsrName"}), "PDS_UsrName")

    def test_explicit_attrKey_overrides_path(self):
        self.assertEqual(_derive_attr_key({"name": "Name", "path": "PDS.Name", "attrKey": "Name"}), "Name")

    def test_no_path_falls_back_to_name(self):
        self.assertEqual(_derive_attr_key({"name": "UsrFoo"}), "UsrFoo")

    def test_single_segment_path_falls_back_to_name(self):
        self.assertEqual(_derive_attr_key({"name": "UsrFoo", "path": "UsrFoo"}), "UsrFoo")


class TestTitleFieldPdsBinding(unittest.TestCase):
    def test_usr_name_field_generates_pds_prefixed_control_and_label(self):
        fields = [{"name": "UsrName", "type": "crt.Input", "path": "PDS.UsrName"}]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        insert = next(op for op in view_config if op.get("name") == "PDS_UsrName")
        self.assertEqual(insert["values"]["control"], "$PDS_UsrName")
        self.assertEqual(insert["values"]["label"], "$Resources.Strings.PDS_UsrName")
        attr_paths = extract_attribute_paths(result)
        self.assertEqual(attr_paths["PDS_UsrName"], "PDS.UsrName")

    def test_standard_name_field_with_attrKey_preserves_bare_binding(self):
        fields = [{"name": "Name", "type": "crt.Input", "path": "PDS.Name", "attrKey": "Name"}]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        name_inserts = [op for op in view_config if op.get("name") == "Name" and op.get("operation") == "insert"]
        self.assertEqual(len(name_inserts), 1)


class TestAddListColumns(unittest.TestCase):
    def test_adds_columns_to_list_page(self):
        columns = [
            {"code": "PDS_UsrStatus", "dataValueType": 10, "width": 144},
            {"code": "PDS_UsrDueDate", "dataValueType": 8, "width": 144},
        ]
        result = add_list_columns(LIST_PAGE_BODY, columns)
        validation = validate_body_structure(result)
        self.assertTrue(validation["valid"], f"Validation errors: {validation['errors']}")
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        dt_op = next(op for op in view_config if op.get("name") == "DataTable")
        col_codes = [c["code"] for c in dt_op["values"]["columns"]]
        self.assertIn("PDS_Name", col_codes)
        self.assertIn("PDS_UsrStatus", col_codes)
        self.assertIn("PDS_UsrDueDate", col_codes)

    def test_adds_attributes_to_view_model_config_diff(self):
        columns = [
            {"code": "PDS_UsrStatus", "dataValueType": 10},
        ]
        result = add_list_columns(LIST_PAGE_BODY, columns)
        vm_data = parse_marker_json(result, "SCHEMA_VIEW_MODEL_CONFIG_DIFF")
        merge_op = next(op for op in vm_data if "attributes" in (op.get("path") or []))
        self.assertIn("PDS_UsrStatus", merge_op["values"])
        self.assertEqual(merge_op["values"]["PDS_UsrStatus"]["modelConfig"]["path"], "PDS.UsrStatus")

    def test_skips_existing_columns(self):
        columns = [
            {"code": "PDS_Name", "dataValueType": 1},
            {"code": "PDS_UsrNew", "dataValueType": 10},
        ]
        result = add_list_columns(LIST_PAGE_BODY, columns)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        dt_op = next(op for op in view_config if op.get("name") == "DataTable")
        name_cols = [c for c in dt_op["values"]["columns"] if c["code"] == "PDS_Name"]
        self.assertEqual(len(name_cols), 1)
        new_cols = [c for c in dt_op["values"]["columns"] if c["code"] == "PDS_UsrNew"]
        self.assertEqual(len(new_cols), 1)

    def test_handles_trailing_commas_in_columns(self):
        result = add_list_columns(LIST_PAGE_BODY, [{"code": "PDS_UsrField", "dataValueType": 1}])
        validation = validate_body_structure(result)
        self.assertTrue(validation["valid"])


class TestRoundTrip(unittest.TestCase):
    def test_form_page_round_trip(self):
        fields = [
            {"name": "UsrStatus", "type": "crt.ComboBox", "path": "PDS.UsrStatus"},
            {"name": "UsrPriority", "type": "crt.ComboBox", "path": "PDS.UsrPriority"},
            {"name": "UsrDueDate", "type": "crt.DateTimePicker", "path": "PDS.UsrDueDate"},
            {"name": "UsrDescription", "type": "crt.Input", "path": "PDS.UsrDescription", "multiline": True},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config_1 = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        result2 = add_form_fields(result, fields)
        view_config_2 = parse_marker_json(result2, "SCHEMA_VIEW_CONFIG_DIFF")
        self.assertEqual(len(view_config_1), len(view_config_2))

    def test_list_page_round_trip(self):
        columns = [
            {"code": "PDS_UsrStatus", "dataValueType": 10},
            {"code": "PDS_UsrPriority", "dataValueType": 10},
        ]
        result = add_list_columns(LIST_PAGE_BODY, columns)
        view_config_1 = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        result2 = add_list_columns(result, columns)
        view_config_2 = parse_marker_json(result2, "SCHEMA_VIEW_CONFIG_DIFF")
        dt1 = next(op for op in view_config_1 if op.get("name") == "DataTable")
        dt2 = next(op for op in view_config_2 if op.get("name") == "DataTable")
        self.assertEqual(len(dt1["values"]["columns"]), len(dt2["values"]["columns"]))


class TestLiveFixture(unittest.TestCase):
    def test_add_fields_to_live_fixture(self):
        fixture_path = FIXTURES / "test1_form_page_live.js"
        if not fixture_path.exists():
            self.skipTest("Live fixture not available")
        body = fixture_path.read_text(encoding="utf-8")
        fields = [
            {"name": "UsrNewField", "type": "crt.Input", "path": "PDS.UsrNewField"},
        ]
        result = add_form_fields(body, fields)
        validation = validate_body_structure(result)
        self.assertTrue(validation["valid"], f"Validation errors: {validation['errors']}")
        attr_paths = extract_attribute_paths(result)
        self.assertEqual(attr_paths["PDS_UsrNewField"], "PDS.UsrNewField")
        self.assertEqual(attr_paths["Name"], "PDS.Name")


if __name__ == "__main__":
    unittest.main()
