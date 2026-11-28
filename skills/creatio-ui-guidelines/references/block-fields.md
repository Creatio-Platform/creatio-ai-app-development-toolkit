# Fields

Use this reference for one field or field-like control: layout and order, required fields, lookups and status chips, guidance, special controls and record connections. Where a rule's strength is not obvious, its lead sentence names it: **pass/fail**, **default** or **heuristic** (`SKILL.md`, *When rules collide*).

## Fields

### Field layout and order

- Prefer a two-column layout for standard record fields.
- Keep labels concise; explanations go in a placeholder or tooltip (*Field guidance*).
- Order fields by task flow and requiredness (*Required fields*).
- Put checkboxes after the related inputs, usually at the bottom of a group or island.
- Information read faster visually than as fields goes into widgets (*Analytics and metric widgets* in `block-widgets.md`).

### Required fields

- **Require the real minimum only (default).** A field is required only when the record cannot be created or is meaningless without it. Extra required fields block quick creation and invite junk; guide recommended fields with defaults, placeholders or business rules instead.
- **Required fields are on the first screen (default):** the header or top island, the left profile column or the first tab, in logical order, with the platform's required mark. On a later tab the user meets the field only when saving fails; when one must live there, name the reason in the plan. Fields edited on most visits go early too.

### Lookups and status chips

- **A lookup to a small fixed catalog is a simple lookup, a dropdown (pass/fail).** Small fixed catalog: values that admins maintain and users only pick, up to about 20 (two included): status, type, category, stage, priority. This is set on the entity column, not the page: set `IsSimpleLookup` (clio `simple-lookup: true` on a `modify` or `add` column operation). Lookups to records users create, or catalogs that grow past about 20 values (Contact, Account, a parent record), keep the selection window. The page binds `crt.ComboBox` either way.
- **Filter lookups to relevant values** (only responsible colleagues), with a hint when the user could miss the filter.
- **A status-like lookup gets colored chips (default).** When a small-catalog lookup's values carry a state or a level the user scans for (status, stage, priority, health, risk, result), color its values without being asked; the form field and every list then show colored chips with no page change. Color follows meaning, one meaning per color across the app, from the scale in `accessibility-and-colors.md`, *Freedom UI color guidance*, never palette order: *Red* health in a green chip is a defect. The chip keeps its text; check its contrast on the rendered page. Lookups without state (country, product line) stay plain. How to write the colors is owned by clio: `get-guidance name=lookup-colors`, with the colors from the scale. Afterwards, confirm the chips render on the page and in a list.

### Field guidance

- **A field that is not self-explanatory gets guidance (default).** Test: a new user could not fill it correctly from the label alone, because it has a format, a unit or scale, limited allowed values, or a source. Non-obvious inputs without guidance are a defect, and so are empty, generic or "e.g."-prefixed hints.
- **Placeholders go on free-entry inputs whose format or sample helps** (text, number, date, email, phone, web). Skip them on self-evident fields, lookups and checkboxes; an unneeded placeholder is as bad as a missing one. A date with a picker usually needs none, and a date hint follows the user's culture.
- **The channel follows when the user needs it:** placeholder for format or sample; tooltip (`i` icon) for meaning the sample cannot carry (units, source, the rule behind a calculated value); a muted one-line description under the field only for guidance needed on every visit. Two channels only when format and meaning both need it, never three.
- **The text is specific and localizable.** "Enter value" or a repeat of the label helps nobody. Every placeholder, tooltip and description is a resource string. Wording: `ux-writing.md`, *3. Field labels and helper text*.
- **A read-only or calculated field gets a tooltip** saying why it is read-only and how and when it is filled.
- **An empty optional field reads as an invitation.** The one exception to "a placeholder shows a format or sample", lookups included: an optional field that usually stays empty on a saved record gets a call-to-action placeholder (`Add revenue`, `Add primary contact`). A list's empty state (`No data`) is the component's own.

### Special field controls

- **Ordered process state uses the DCM stage progress bar** (`crt.EntityStageProgressBar`), not a status combo box; template: *Choosing the page template (before you create the page)* in `page-record.md`.
- **A date without a time of day uses a date-only column.**
- **A bounded number the user sets by feel uses a slider** with the range endpoints (a confidence level 0–100); values typed exactly keep a numeric input.
- **The primary display name is composed from key fields** where a readable title can be derived (`<Need> / <Contact>, <Account>`), by a calculated value or business rule, kept editable, with its source in a tooltip.

### Choice controls

- **A toggle sets a mode that takes effect as configuration** (Use contact's timezone); a checkbox records a plain boolean with the record's data. Do not swap one for the other to restyle.
- **A consequential either/or choice is selectable cards, not a dropdown.** When two or three options change what happens next (send now, schedule, smart-send), show cards with an icon, a short title and a one-line consequence, one selection. An ordinary value pick stays a dropdown.

### Record connections

**Record connections are one `crt.Connections` element, not a ComboBox per link (pass/fail).**

- **Applies to** a request to show or add the record's connections: the Classic **Connected to** block, or links to other records (Contact, Account, Opportunity, Case) shown together where only the filled ones need room.
- **Place one `crt.Connections`.** First read `get-guidance name=page-modification-field-contract` (*CONNECTIONS ARE NOT INSERTED FIELDS*), then `get-component-info search='connections'` for the page contract. By default it goes in a `crt.ExpansionPanel` titled "Connections" in the side column, with no `caption` of its own. Declare no ComboBox, attribute, datasource or child element per connection: the platform generates a field per connection at page load.
- **Which connections exist is a property of the object**, its Connections list in the Object designer (`get-guidance name=process-activity-connections`). To add, remove or reorder one, change the object (`get-entity-connections`, then `update-entity-connections`; semantics from `get-tool-contract`). If clio does not list these tools, tell the user to change the list in the Object designer; never fall back to page fields. The page changes only per-connection display settings, in the element's `connections` property, with the entry shape from `get-component-info`.
- **It renders only with the `UseConnectionsComponent` feature on** (off by default). A `get-entity-connections` warning naming the feature means off: tell the user the block stays invisible until it is on, and do not turn it on without their consent or fall back to ComboBoxes. Without `get-entity-connections` in clio the state is unknown, not on: place the element and say so.
- **A `crt.ComboBox` stays only for a lookup that is not a connection** and belongs to the form's own flow (Owner, Stage, Type, or a filtered list). A column shown by `crt.Connections` gets no second ComboBox; both would bind the same attribute.
- Anti-patterns: a column of empty unrelated lookups where a Connections block would show only the filled ones; inserting a field into `crt.Connections` `items`; adding on the page a connection the object does not list.

## Traps

- A small-catalog lookup opens a selection window → *Lookups and status chips*.

- A `Date` field shows a time → *Special field controls*.

- Non-obvious and read-only fields ship without a tooltip or placeholder → *Field guidance*.

- Ordered status defaults to a combo box → *Special field controls*.
