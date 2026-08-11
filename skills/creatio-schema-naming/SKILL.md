---
name: creatio-schema-naming
description: 'Creatio data-model naming assistant for creating names for Creatio object schemas, object titles, object columns, field titles, lookup objects, lookup columns, Guid columns, UId references, and relation/link objects. Use when generating new Creatio schemas, metadata, migration scripts, specifications, or implementation plans that require choosing object or column names and basic column metadata — including via clio MCP (create-entity-schema, update-entity-schema, create-lookup, create-app, create-app-section). Triggers include: creatio, schema, entity, object, column, field, lookup, naming, PascalCase, Id/UId suffix, relation object.'
---

# Creatio Schema Naming

## Purpose

Use this skill to create names for Creatio data-model elements before schemas, columns, lookups, or relation objects are implemented.

Turn business meaning into practical schema naming suggestions, including technical code, user-facing title, and basic column metadata when applicable.

## Creation workflow

1. Identify what is being named: object, column, lookup object, lookup column, raw Guid column, UId reference, or relation/link object.
2. Infer business meaning from the user's request, object context, expected data type, and target relation.
3. Choose the shortest clear name that preserves meaning.
4. Return technical and user-facing names:
   - object: `Object code` and `Object title`
   - column: `Column code`, `Field title`, type, required flag, default value, and description
   - lookup object: `Object code`, `Object title`, and optionally lookup list title
5. If meaning is ambiguous, provide the best default plus 1-2 alternatives. Ask for clarification only when the generated name would likely be wrong.
6. For detailed rules and examples, consult `./references/creatio-naming-standard.md`.

## Core naming rules

### Objects

- Use a singular business noun in PascalCase.
- Do not use `Of`; prefer `ActivityType`, `RequestStatus`, `DocumentProduct`.
- Use `In` only for relation/link objects, for example `ContactInAccount` or `AttachmentInMessage`.
- Avoid placeholder names: `Object`, `Table`, `Data`, `Info`, `New`, `Temp`, random numbers.

### Columns

- Use PascalCase.
- Prefer one-word names when the object context is enough: `Name`, `Owner`, `Status`, `Type`, `Amount`, `Priority`.
- Use multiple words only when needed to preserve meaning: `PaymentAmount`, `ApprovalStatus`, `PrimaryAmount`, `ExternalRecordId`.
- Use `Status`, not `State`.
- Reuse standard column names where applicable: `Name`, `Owner`, `Status`, `Type`, `Description`, `Comments`, `StartDate`, `EndDate`, `Priority`, `Quantity`, `Price`, `PrimaryPrice`, `Amount`, `PrimaryAmount`, `TotalAmount`, `PrimaryTotalAmount`.

### Lookup, Guid, and UId columns

- Lookup column code must not include `Id`; Creatio adds the DB-level identifier automatically.
- Raw Guid columns that are not lookups should use the `Id` suffix.
- References to core elements that expose `UId` should use the `UId` suffix.

Examples:

```text
# lookup columns
City
Country
ContactType
RequestStatus

# raw guid columns
ExternalRecordId
MessageId

# uid references
EntitySchemaColumnUId
ProcessElementUId
```

### Titles

- Object title and field title should be brief, user-facing, and capitalized as normal text: first word capitalized, other words lowercase unless proper nouns require otherwise.
- Put long explanations into `Description`, not into the title.
- Lookup object code stays singular; lookup list title can be plural because it displays a list.

### Primary display column

Every object must have a primary display column — prefer a text, required, auto-filled, ideally unique value (often `Name`). See `./references/creatio-naming-standard.md` for why and how.

## Output format for name creation

When asked to create names, prefer this compact format:

```markdown
## Suggested naming

| Element | Code | Title | Type | Required | Default value | Description | Notes |
|---|---|---|---|---|---|---|---|
| Object | `RequestStatus` | Request status | Object | n/a | n/a | Stores possible request statuses. | Lookup object |
| Column | `Status` | Status | Lookup: RequestStatus | Yes | New | Current request status. | No `Id` suffix |
```

When there is ambiguity, add:

```markdown
## Alternatives

- `ApprovalStatus` / Approval status — use if the status is specifically about approval.
- `ProcessingStatus` / Processing status — use if the status tracks operational processing.
```
