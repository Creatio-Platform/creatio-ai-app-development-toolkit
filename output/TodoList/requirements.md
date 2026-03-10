# TodoList — Requirements

## App Overview

A simple Todo List app for personal task tracking in Creatio. It allows users to create and maintain a list of tasks, see them in a structured list view, update their status (New → In Progress → Completed), and manage task details including priority and due dates throughout their lifecycle.

## Business Decisions Locked

- **Goal/KPI**: Enable personal task tracking with status visibility and priority management
- **Roles**: Individual users manage their own tasks
- **Lifecycle**: New → In Progress → Completed (no restrictions on transitions)
- **Acceptance criteria**: 
  - Create new tasks with title, description, priority, and due date
  - View tasks in list with title, status, priority, and due date visible
  - Update task status and details
  - Tasks display in form view with all fields editable

## MCP Application Create Input

- **name**: Todo List
- **code**: UsrTodoList
- **templateCode**: AppFreedomUI
- **description**: Personal task tracking application
- **clientTypeId**: (use default)
- **optionalTemplateData**:
  - useExistingEntitySchema: false
  - entitySchemaName: (empty - new entity)
  - appSectionDescription: Manage your personal tasks and todos
  - useAIContentGeneration: false
- **icon**:
  - iconId: auto
  - iconBackground: auto

## Entities

### UsrTodo (extends BaseEntity)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| UsrTitle | Text (250) | Yes | — | Task title |
| UsrDescription | Text (500) | No | — | Detailed description |
| UsrStatus | Lookup → UsrTodoStatus | Yes | New | Current status |
| UsrPriority | Lookup → UsrTodoPriority | Yes | Medium | Task priority |
| UsrDueDate | Date | No | — | Target completion date |

### UsrTodoStatus (extends BaseLookup)

**Purpose**: Task lifecycle statuses

**Seed Data**:
| Name |
|------|
| New |
| In Progress |
| Completed |

### UsrTodoPriority (extends BaseLookup)

**Purpose**: Task priority levels

**Seed Data**:
| Name |
|------|
| Low |
| Medium |
| High |

## Pages

### UsrTodo List Page
**Columns**: UsrTitle, UsrStatus, UsrPriority, UsrDueDate

### UsrTodo Form Page
- **Header**: UsrTitle
- **Fields**: UsrDescription, UsrStatus, UsrPriority, UsrDueDate
- **Layout notes**: Standard vertical layout with all fields accessible

## Relationships

- UsrTodo.UsrStatus → UsrTodoStatus (many-to-one lookup)
- UsrTodo.UsrPriority → UsrTodoPriority (many-to-one lookup)

## Business Rules

- UsrTitle is mandatory
- UsrStatus defaults to "New" for new tasks
- UsrPriority defaults to "Medium" for new tasks
- UsrStatus and UsrPriority must reference valid lookup values
- All users can create, read, update tasks
- No restrictions on status transitions

## Assumptions

- Single-user personal task tracking (no assignment/collaboration features)
- No task categories required
- Simple CRUD operations without complex business logic
- Standard Creatio permissions apply
- No recurring tasks or reminders in initial version
- Tasks remain in system indefinitely (no auto-archiving)
