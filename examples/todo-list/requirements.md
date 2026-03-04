# TodoList — Requirements

## App Overview

A simple task management application where users create tasks, assign status and priority, and manage tasks in list and form pages.

## MCP Application Create Input

- name: `Todo List`
- code: `UsrTodoList`
- templateCode: `AppFreedomUI`
- description: `Simple task management application`
- clientTypeId: `null`
- optionalTemplateData:
  - useExistingEntitySchema: `false`
  - entitySchemaName: `""`
  - appSectionDescription: `Manage todo tasks with statuses and priorities`
  - useAIContentGeneration: `false`
- icon:
  - iconId: `auto`
  - iconBackground: `auto`

## Entities

### UsrTodoTaskStatus (extends BaseLookup)

**Purpose**: Task status lookup.

**Seed Data**:
| Name |
|------|
| New |
| In Progress |
| Done |

### UsrTodoTaskPriority (extends BaseLookup)

**Purpose**: Task priority lookup.

**Seed Data**:
| Name |
|------|
| Low |
| Medium |
| High |

### UsrTodoTask (extends BaseEntity)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| UsrTitle | Text (250) | Yes | — | Task title |
| UsrDescription | Text (500) | No | — | Task description |
| UsrStatus | Lookup → UsrTodoTaskStatus | Yes | New | Current status |
| UsrPriority | Lookup → UsrTodoTaskPriority | No | Medium | Priority |
| UsrDueDate | DateTime | No | — | Due date |

## Pages

### UsrTodoTask List Page

Columns: `UsrTitle`, `UsrStatus`, `UsrPriority`, `UsrDueDate`, `CreatedOn`

### UsrTodoTask Form Page

- Header: `UsrTitle`
- Fields: `UsrTitle`, `UsrDescription`, `UsrStatus`, `UsrPriority`, `UsrDueDate`
- Layout notes: single-column general tab

## Relationships

- `UsrTodoTask.UsrStatus` → `UsrTodoTaskStatus`
- `UsrTodoTask.UsrPriority` → `UsrTodoTaskPriority`

## Business Rules

- `UsrTitle` is required.
- Default status is `New`.
- `UsrDueDate` cannot be in the past for newly created tasks.
