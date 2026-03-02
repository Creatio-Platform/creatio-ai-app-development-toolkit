# TodoList — Implementation Plan

## Package

```
Package: UsrTodoList
UId: a1b2c3d4-e5f6-7890-abcd-ef1234567890
DependsOn: CrtBase, CrtCoreBase, CrtUIv2
```

## Generation Order

1. Lookups: UsrTodoTaskStatus, UsrTodoTaskPriority
2. Entities: UsrTodoTask
3. Pages: UsrTodoTask_ListPage, UsrTodoTask_FormPage
4. Addons: UsrTodoTask_FormPage_Addon
5. Data Bindings: SysModuleEntity, SysModule, Lookup seed data

---

## Entities

### UsrTodoTaskStatus (extends BaseLookup)
```
UId: 11111111-aaaa-bbbb-cccc-000000000001
Parent: BaseLookup (11ab4bcb-9b23-4b6d-9c86-520fae925d75)
Columns: none (Name, Description inherited from BaseLookup)
```

### UsrTodoTaskPriority (extends BaseLookup)
```
UId: 11111111-aaaa-bbbb-cccc-000000000002
Parent: BaseLookup (11ab4bcb-9b23-4b6d-9c86-520fae925d75)
Columns: none (Name, Description inherited from BaseLookup)
```

### UsrTodoTask (extends BaseEntity)
```
UId: 22222222-aaaa-bbbb-cccc-000000000001
Parent: BaseEntity (1bab9dcf-17d5-49f8-9536-8e0064f1dce0)

Columns:
  - UsrTitle
    UId: 33333333-aaaa-0001-cccc-000000000001
    DataValueType: Text (ddb3a1ee-07e8-4d62-b7a9-d0e618b00fbd) [DVT: 1]

  - UsrDescription
    UId: 33333333-aaaa-0001-cccc-000000000002
    DataValueType: Text (ddb3a1ee-07e8-4d62-b7a9-d0e618b00fbd) [DVT: 1]

  - UsrStatus
    UId: 33333333-aaaa-0001-cccc-000000000003
    DataValueType: Lookup (b295071f-7ea9-4e62-8d1a-919bf3732ff2) [DVT: 10]
    ReferenceSchema: UsrTodoTaskStatus (11111111-aaaa-bbbb-cccc-000000000001)

  - UsrPriority
    UId: 33333333-aaaa-0001-cccc-000000000004
    DataValueType: Lookup (b295071f-7ea9-4e62-8d1a-919bf3732ff2) [DVT: 10]
    ReferenceSchema: UsrTodoTaskPriority (11111111-aaaa-bbbb-cccc-000000000002)

  - UsrDueDate
    UId: 33333333-aaaa-0001-cccc-000000000005
    DataValueType: DateTime (d21e9ef4-c064-4012-b286-fa1a8171da44) [DVT: 8]
```

---

## Pages

### UsrTodoTask_ListPage
```
UId: 44444444-aaaa-bbbb-cccc-000000000001
Parent: ListPageV3Template (b7b898d0-8c77-4953-c097-23fa6800da02)
Entity: UsrTodoTask
DataGrid columns: UsrTitle, UsrStatus, UsrPriority, UsrDueDate, CreatedOn
```

### UsrTodoTask_FormPage
```
UId: 44444444-aaaa-bbbb-cccc-000000000002
Parent: PageWithTabsFreedomTemplate (3b2e117f-8c6b-4ca5-80a2-7ebb497cddf9)
Entity: UsrTodoTask
Fields:
  Row 1: UsrTitle (crt.Input)
  Row 2: UsrStatus (crt.ComboBox)
  Row 3: UsrPriority (crt.ComboBox)
  Row 4: UsrDueDate (crt.DateTimePicker)
  Row 5: UsrDescription (crt.Input)
```

---

## Addons

### UsrTodoTask_FormPage_Addon
```
UId: 55555555-aaaa-bbbb-cccc-000000000001
TargetEntity: UsrTodoTask (22222222-aaaa-bbbb-cccc-000000000001)
FormPage: UsrTodoTask_FormPage (44444444-aaaa-bbbb-cccc-000000000002)
```

---

## Data Bindings

### SysModuleEntity_UsrTodoTask
```
RecordId: 66666666-aaaa-bbbb-cccc-000000000001
EntitySchemaUId: 22222222-aaaa-bbbb-cccc-000000000001
```

### SysModule_UsrTodoTask
```
RecordId: 77777777-aaaa-bbbb-cccc-000000000001
SysModuleEntityId: 66666666-aaaa-bbbb-cccc-000000000001
Code: UsrTodoTask
ListPageUId: 44444444-aaaa-bbbb-cccc-000000000001
FormPageUId: 44444444-aaaa-bbbb-cccc-000000000002
SectionModuleSchemaUId: 12244568-6d4f-f201-ed26-ac3913021080
CardModuleUId: c3382be3-6619-9256-2260-93d87cf0d9b5
IconBackground: #7848EE
```

### Lookup Seed Data

**UsrTodoTaskStatus_Lookup:**
| Id | Name |
|----|------|
| 88888888-aaaa-0001-cccc-000000000001 | New |
| 88888888-aaaa-0001-cccc-000000000002 | In Progress |
| 88888888-aaaa-0001-cccc-000000000003 | Done |

**UsrTodoTaskPriority_Lookup:**
| Id | Name |
|----|------|
| 88888888-aaaa-0002-cccc-000000000001 | Low |
| 88888888-aaaa-0002-cccc-000000000002 | Medium |
| 88888888-aaaa-0002-cccc-000000000003 | High |
