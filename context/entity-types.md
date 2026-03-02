# Creatio Entity Types & Data Reference

## Parent Entity Types (KNOWN_PARENTS)

Every entity in Creatio **must extend** one of these parent types. The parent UId goes into `metadata.json` field `D8` and `descriptor.json` field `Parent.UId`.

| Parent Name | UId | Use Case |
|-------------|-----|----------|
| **BaseEntity** | `1bab9dcf-17d5-49f8-9536-8e0064f1dce0` | Standard entity with Id, CreatedOn/By, ModifiedOn/By |
| **BaseLookup** | `11ab4bcb-9b23-4b6d-9c86-520fae925d75` | Lookup/enum entity (adds Name + Description columns) |
| **BaseCodeLookup** | `2681062b-df59-4e52-89ed-f9b7dc909ab2` | Lookup with Code column |
| BaseTag | `9e3f203c-e905-4de5-9571-134f14b8c1e3` | Tag entity |
| BaseFolder | `d602bf96-d029-4b07-9755-63c8f5cb5ed5` | Folder entity |
| BaseFile | `556c5867-60a7-4456-aae1-a57a122bef70` | File attachment entity |
| **BaseProcess** | `e20c0489-122a-4242-999d-c755bc51d76c` | Business process |

### Page Template Parents

| Parent Name | UId | Use Case |
|-------------|-----|----------|
| **ListPageV3Template** | `b7b898d0-8c77-4953-c097-23fa6800da02` | List page (section main page) |
| **PageWithTabsFreedomTemplate** | `3b2e117f-8c6b-4ca5-80a2-7ebb497cddf9` | Form page with tabs |
| **LightFormPage** | `ec5fd902-66ce-4139-a241-10ebd8addc40` | Light form page (mini page) |
| **MinimalCardTemplate** | `0f8eb896-7b62-4dfa-bd55-a414f50932a7` | Minimal card template |
| CentralAreaDesktopTemplate | `fbc98c89-0691-479c-bc25-59c11ac2365f` | Desktop template |
| SectionDesktopTemplate | `76d633dd-63f4-4955-b36c-e6042cb74dfd` | Section desktop |
| BaseHomePage | `4d29bef1-7f28-42e0-9a7e-82e43b14e858` | Home page |
| PageWithRightAreaAndTabsFreedomTemplate | `5f8dd430-acf2-4e1a-80c8-77cf57e245ce` | Form with right area + tabs |

## Inherited Columns from BaseEntity (BASE_ENTITY_COLS)

**DO NOT add these columns** — they are automatically inherited from BaseEntity:

| Column Name | UId | DataValueType |
|-------------|-----|---------------|
| Id | `ae0e45ca-c495-4fe7-a39d-3ab7278e1617` | Guid |
| CreatedOn | `e80190a5-03b2-4095-90f7-a193a960adee` | DateTime |
| CreatedBy | `ebf6bb93-8aa6-4a01-900d-c6ea67affe21` | Lookup |
| ModifiedOn | `9928edec-4272-425a-93bb-48743fee4b04` | DateTime |
| ModifiedBy | `3015559e-cbc6-406a-88af-07f7930be832` | Lookup |
| ProcessListeners | `3fabd836-6a53-4d8d-9069-6df88d9dae1e` | Integer |

### Additional Columns from BaseLookup

| Column Name | UId | DataValueType |
|-------------|-----|---------------|
| Name | `736c30a7-c0ec-4fa9-b034-2552b319b633` | MediumText |
| Description | `9e53fd7c-dde4-4502-a64c-b9e34148108b` | MediumText |

## DataValueType → GUID Map (KNOWN_DVT)

Use these GUIDs in entity metadata column definitions (field `S2`):

| DataValueType | GUID | Notes |
|---------------|------|-------|
| **Guid** | `23018567-a13c-4320-8687-fd6f9e3699bd` | Primary keys, foreign keys |
| **Lookup** | `b295071f-7ea9-4e62-8d1a-919bf3732ff2` | Reference to another entity |
| **Boolean** | `90b65bf8-0ffc-4141-8779-2420877af907` | True/False |
| **Integer** | `6b6b74e2-820d-490e-a017-2b73d4ccf2b0` | Whole numbers |
| **Float** | `5cc8060d-6d10-4773-89fc-8c12d6f659a6` | Decimal numbers |
| **Money** | `ff22e049-4d16-46ee-a529-92d8808932dc` | Currency values |
| **DateTime** | `d21e9ef4-c064-4012-b286-fa1a8171da44` | Date + Time |
| **Date** | `603d4960-a1a2-45e9-b232-206a54421b01` | Date only |
| **Time** | `04cc757b-8f06-482c-8a1a-0c0e171d2410` | Time only |
| **ShortText** | `ddb3a1ee-07e8-4d62-b7a9-d0e618b00fbd` | Up to 250 characters |
| **MediumText** | `325a73b8-0f47-44a0-8412-7606f78003ac` | Up to 500 characters |
| **LongText** | `c0f04627-4620-4bc0-84e5-9419dc8516b1` | Up to 1000+ characters |
| **MaxSizeText** | `5ca35f10-a101-4c67-a96a-383da6afacfc` | Unlimited text |
| **LargeText/RichText** | `79bccffa-8c8b-4863-b376-a69d2244182b` | Rich text / HTML |
| **LocalizableString** | `8b3f29bb-ea14-4ce5-a5c5-293a929b6ba2` | Localizable string |
| **SecureText** | `3509b9dd-2c90-4540-b82e-8f6ae85d8248` | Encrypted text |
| **Image** | `fa6e6e49-b996-475e-a77e-73904e4c5a88` | Image (binary) |
| **ImageLookup** | `b039feb0-ee7c-4884-8aa6-d6d45d84316f` | Image reference |
| **Binary** | `b7342b7a-5dde-40de-aa7c-24d2a57b3202` | Binary data |
| **Color** | `dafb71f9-ee9f-4e0b-a4d7-37aa15987155` | Color value |

## DataValueType → Freedom UI Control Mapping

| DataValueType | Freedom UI Control | Type String |
|---------------|-------------------|-------------|
| ShortText, MediumText, LongText | Input | `crt.Input` |
| MaxSizeText, LargeText/RichText | RichTextEditor | `crt.RichTextEditor` |
| Integer | NumberInput | `crt.NumberInput` |
| Float, Money | NumberInput | `crt.NumberInput` |
| Boolean | Checkbox | `crt.Checkbox` |
| DateTime | DateTimePicker | `crt.DateTimePicker` |
| Date | DateTimePicker | `crt.DateTimePicker` |
| Time | DateTimePicker | `crt.DateTimePicker` |
| Lookup | ComboBox | `crt.ComboBox` |
| Image, ImageLookup | ImageInput | `crt.ImageInput` |
| Color | ColorPicker | `crt.ColorPicker` |

## DataValueType Numeric IDs (for viewConfigDiff)

Used in page `.js` files in DataTable column definitions:

| DataValueType | Numeric ID |
|---------------|------------|
| Guid | 0 |
| ShortText | 1 |
| MediumText | 2 |
| LongText | 3 |
| Integer | 4 |
| Float | 5 |
| Money | 6 |
| DateTime | 7 |
| Date | 8 |
| Time | 9 |
| Lookup | 10 |
| Boolean | 12 |
| MaxSizeText | 13 |
| Image | 14 |

## System Entity UIds

| Entity | Schema UId | Notes |
|--------|------------|-------|
| SysModule | `2b2ed767-0b4b-4a7b-9de2-d48e14a2c0c5` | Section registration |
| SysModuleEntity | `9c762665-90ad-497b-ac4b-45bb729630a1` | Entity-to-section binding |
| Contact | `16be3651-8fe2-4159-8dd0-a803d4683dd3` | Contact entity |
| Account | `25d7c1ab-1de0-4501-b402-02d0e0a520fc` | Account entity |
| Activity | `c449d832-a4cc-4b01-b9d5-8a12c42a9f89` | Activity entity |
| SysAdminUnit | `84f44b9a-4bc3-4cbf-a1a8-cec02c1c029c` | User/role entity |
