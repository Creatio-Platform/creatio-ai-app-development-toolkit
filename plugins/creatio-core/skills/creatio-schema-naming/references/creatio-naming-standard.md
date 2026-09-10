# Creatio Naming Standard for Creating Objects, Columns, and Lookups

## Naming decision tree

1. **New stored business entity?** Create an object name.
2. **Attribute stored on an object?** Create a column name.
3. **Selectable value from another object?** Create a lookup column name.
4. **New list of selectable values?** Create a lookup object name.
5. **Raw Guid value, not a lookup?** Use a Guid column name with `Id`.
6. **Reference to a core element with `UId`?** Use a `UId` column name.
7. **Join/membership entity?** Create a relation object name using `In`.

## Object names

### Object code

Use a singular business noun in PascalCase.

Good:

```text
Request
RequestType
RequestStatus
RequestTeamMember
RequestTask
```

Avoid:

```text
Requests
RequestObject
RequestData
RequestNew
Request123
TypeOfRequest
```

### Object title

Use a singular user-facing name. Capitalize only the first word unless proper nouns require otherwise.

Good:

```text
Request
Request type
Request status
Request team member
```

Avoid:

```text
Requests
Request Type
Type of request
Request data
```

### Avoid `Of`

Do not use `Of` in object names. Put the owner/context first.

```text
TypeOfActivity -> ActivityType
StatusOfRequest -> RequestStatus
ProductOfDocument -> DocumentProduct
OwnerOfTask -> TaskOwner
```

### Relation/link objects

Use `In` when the object represents membership, inclusion, or a join between records.

Good:

```text
ContactInAccount
ProductInRequest
AttachmentInMessage
ParticipantInRequest
```

Avoid:

```text
AccountContact
RequestProductRelation
MessageAttachmentLink
ContactOfAccount
```

Use `In` only when the object is truly a relation/link object. For ordinary business entities, prefer a direct business name such as `RequestTask` or `RequestProduct`.

## Column names

### Column code

Use PascalCase. Prefer the shortest name that still carries the business meaning.

Good:

```text
Name
Owner
Status
Type
Amount
Priority
PaymentAmount
ApprovalStatus
ExternalCode
```

Avoid:

```text
Value
Data
Info
Text
Field
Flag
Status1
AmountNew
CommentTemp
```

### Prefer one word when object context is enough

Use one-word names for common concepts when the owning object supplies the context:

```text
Name
Owner
Status
Type
Amount
Priority
Quantity
Price
```

Use multi-word names when one word would be ambiguous:

```text
PaymentAmount
ApprovalStatus
StartDate
EndDate
PrimaryAmount
TotalAmount
ExternalCode
```

### Field title

Use a brief user-facing title. Capitalize only the first word unless proper nouns require otherwise.

Good:

```text
Account type
Contact type
Process stage
Phone number
Custom record Id
Payment amount
Approval status
```

Avoid:

```text
Account Type
CONTACT TYPE
ProcessStage
PhoneNumber
This field stores the phone number of the client
```

Put long explanations into `Description`, not into the title.

### Standard common columns

Use these standard names for typical fields.

| Meaning | Code |
|---|---|
| Name | `Name` |
| Responsible user | `Owner` or `Assignee` |
| Status | `Status` |
| Type | `Type` |
| Description | `Description` |
| Comment | `Comments` |
| Start date | `StartDate` |
| End date | `EndDate` |
| Priority | `Priority` |
| Quantity | `Quantity` |
| Price | `Price` |
| Price in primary currency | `PrimaryPrice` |
| Amount | `Amount` |
| Amount in primary currency | `PrimaryAmount` |
| Total amount | `TotalAmount` |
| Total amount in primary currency | `PrimaryTotalAmount` |

Prefer `Status`, not `State`.

### Boolean columns

For Boolean flags, prefer names that read as yes/no attributes.

Good:

```text
IsActive
IsVerified
HasDebt
CanBeCancelled
RequiresApproval
UseManualProcessing
```

Avoid:

```text
Active
Verified
Debt
Approval
ManualProcessing
```

### Date columns

Name the specific date being stored.

Good:

```text
StartDate
EndDate
PaymentDate
ApprovalDate
CancellationDate
```

Use `Date` alone only if the object has a single obvious date.

### Money, amount, price, and quantity columns

Good:

```text
Price
PrimaryPrice
Amount
PrimaryAmount
TotalAmount
PrimaryTotalAmount
Quantity
DiscountPercent
```

Avoid:

```text
Sum
Summ
Amount1
Total
TotalSum
Count
```

### Integration columns

For external systems, make the source or purpose clear.

Good:

```text
ExternalId
ExternalCode
ExternalStatus
IntegrationStatus
LastSyncDate
SyncErrorMessage
```

If there are multiple integrations, include the system name:

```text
SAPExternalId
ESBMessageId
DWHSyncDate
```

## Required, default value, and description

When creating a column, suggest these metadata values together with the name.

### Required

Set `Required = Yes` only when the record is not meaningful without the value.

Usually required:

```text
Status
Type
Owner
StartDate
Amount
```

Usually optional:

```text
Comments
Description
ExternalId
SyncErrorMessage
CancellationReason
```

### Default value

Suggest a default only when there is a clear business default.

Good defaults:

```text
Status -> New
IsActive -> true
Priority -> Normal
Amount -> 0, only if zero is meaningful
```

Avoid defaults that hide missing business data:

```text
Owner -> current user, unless ownership should always default this way
PaymentDate -> current date, unless the date is always creation/payment date
ExternalId -> generated placeholder
```

### Description

Add a short description for non-obvious columns, especially integration, calculated, sensitive, or process-driving fields.

Good:

```text
ExternalStatus — Status received from the external system. Used for synchronization monitoring.
ApprovalStatus — Current approval state used by the approval process.
PrimaryAmount — Amount converted to the primary currency.
```

Avoid repeating the title:

```text
Status — Status.
Amount — Amount.
```

## Lookup, Guid, and UId rules

### Lookup columns do not use `Id`

If the field is a lookup, do not add `Id` to the object column code. Creatio adds the DB-level identifier automatically.

Good:

```text
City
Country
ContactType
RequestStatus
PaymentMethod
```

Avoid:

```text
CityId
CountryId
ContactTypeId
RequestStatusId
PaymentMethodId
```

### Raw Guid columns use `Id`

If the type is Guid and it is not a lookup, add `Id`.

Good:

```text
CustomRecordId
ExternalRecordId
MessageId
RecordId
```

Avoid:

```text
CustomRecord
ExternalRecord
Message
```

### Core object references use `UId`

If a reference points to a core object element that exposes `UId`, add `UId`.

Good:

```text
EntitySchemaColumnUId
ProcessElementUId
DataSourceFilterUId
```

Avoid:

```text
EntitySchemaColumn
ProcessElement
DataSourceFilter
EntitySchemaColumnId
```

## Lookup objects and lookup list titles

Lookup object code stays singular:

```text
RequestType
RequestStatus
PaymentMethod
CancellationReason
DocumentCategory
```

Object title stays singular:

```text
Request type
Request status
Payment method
Cancellation reason
Document category
```

Lookup list title can be plural because it displays records:

```text
Request types
Request statuses
Payment methods
Cancellation reasons
Document categories
```

Keep singular if plural is unnatural.

## Primary display column

Every object must have a primary display column configured. Do not leave an object without one.

Choose a value that is:

- **Text** — a human-readable string column.
- **Required** — so records are never untitled.
- **Auto-filled** — populated automatically (default value, sequence, or rule) so users don't type it manually.
- **Unique** — ideally distinct per record so titles are unambiguous.

The primary display field is used across the platform:

- forms the **page title** of the record;
- appears in **lookups** when the object is referenced from other objects;
- appears in **lists/grids** when no columns have been explicitly configured;
- makes records easy to **open by link**.

`Name` is the usual default primary display column for business entities.

## Creation output template

Use this when asked to create names:

```markdown
## Suggested naming

| Element | Code | Title | Type | Required | Default value | Description | Notes |
|---|---|---|---|---|---|---|---|
| Object | `RequestStatus` | Request status | Object | n/a | n/a | Stores possible request statuses. | Lookup object |
| Column | `Status` | Status | Lookup: RequestStatus | Yes | New | Current request status. | No `Id` suffix |
```

Use alternatives only when ambiguity matters:

```markdown
## Alternatives

- `ApprovalStatus` / Approval status — use if the field tracks approval specifically.
- `ProcessingStatus` / Processing status — use if the field tracks operational processing.
```
