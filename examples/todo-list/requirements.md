# TodoList — Requirements

## App Overview
A simple task management application. Users can create, view, and manage tasks with statuses and priorities.

## Package
- Name: `UsrTodoList`
- Dependencies: CrtBase, CrtCoreBase, CrtUIv2

## Entities

### UsrTodoTaskStatus (extends BaseLookup)
Lookup for task statuses. Inherited columns: Name, Description.

**Seed Data:**
| Name | Description |
|------|-------------|
| New | Default status for new tasks |
| In Progress | Task is being worked on |
| Done | Task is completed |

### UsrTodoTaskPriority (extends BaseLookup)
Lookup for task priorities. Inherited columns: Name, Description.

**Seed Data:**
| Name | Description |
|------|-------------|
| Low | Low priority |
| Medium | Medium priority |
| High | High priority |

### UsrTodoTask (extends BaseEntity)
Primary entity for tasks.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| UsrTitle | Text (250) | Yes | Task title |
| UsrDescription | Text (500) | No | Task description |
| UsrStatus | Lookup → UsrTodoTaskStatus | No | Current status |
| UsrPriority | Lookup → UsrTodoTaskPriority | No | Priority level |
| UsrDueDate | DateTime | No | Due date |

## Pages

### UsrTodoTask List Page
Columns to display: UsrTitle, UsrStatus, UsrPriority, UsrDueDate, CreatedOn

### UsrTodoTask Form Page
Fields layout:
1. UsrTitle (Text input)
2. UsrStatus (ComboBox)
3. UsrPriority (ComboBox)
4. UsrDueDate (DateTimePicker)
5. UsrDescription (Multiline text input)

## Relationships
- UsrTodoTask.UsrStatus → UsrTodoTaskStatus (Lookup)
- UsrTodoTask.UsrPriority → UsrTodoTaskPriority (Lookup)
