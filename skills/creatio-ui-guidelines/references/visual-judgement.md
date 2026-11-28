# Visual judgement

A Freedom UI page can use only native components, sit on the right template, have every field placed without gaps, and still look wrong: assembled rather than designed, loud where it should be quiet, with no decision about what matters. This reference is the judgement layer for that gap: how to look at the RENDERED page and decide whether it is composed, how to spend colour, type, surface and space, what native Creatio looks like so that deviations read as defects, and which authority wins when judgement and the product disagree. Apply it after the structural rules in `page-layout-and-controls.md` and before calling a page done; use `review-checklists.md` for the audit format and severity model.

## Contents

- Order of authority
- The five checks
- Composed versus assembled
- Fragmentation and monotony
- Hierarchy and the focal point
- Proportion, density and grouping
- Whitespace: decision or hole
- Restraint: surfaces, borders and elevation
- The colour budget and colour roles
- Typography relationships
- The state matrix
- What native Creatio looks like
- The tells of generated work on a Freedom UI page
- Seeing what is really on the page

## Order of authority

Judgement in this file ranks below what the native product renders, the component contract and this skill's layout rules (*When rules collide* in `SKILL.md`). Where the running product does something this file advises against, the product wins for looks, and the review says so.

Judgement decides **what goes on the page**: which blocks exist, which one leads, what is grouped with what, what is left out. It never decides **how a component is drawn**. Once a judgement produces a number (a gap, a size, a colour value) it has left its lane: the theme and the component's native inputs answer that, and custom CSS is the last resort (*Custom CSS* in `page-layout-and-controls.md`). "This group needs more room" is judgement; how much room is a native spacing input on the container.

## The five checks

Rules here are questions, not counts (*Design principles* in `design-judgement.md`, "Rules are not counts"). Run these on the rendered page in the browser before showing it or closing a review. Each is a question with a pass or fail answer.

1. **Say it.** In one sentence: what is this page for? ("The account manager reviews an order and approves or returns it.") If you cannot say it, that, not the spacing, is the defect. Every later decision is measured against this sentence.
2. **Squint.** Blur the page (zoom the screenshot out until text is unreadable). What still stands out should be the answer to the sentence: the record's state, the amount to approve, the stage. More than one survivor is competition, not hierarchy; none means the user does the sorting every time.
3. **Subtract.** Remove an element in your head. Is anything lost? If not, it was decoration, a cost paid daily on a page used daily. Applies to islands, widgets, icons, helper lines, colour fills and whole tabs.
4. **Tomorrow.** Would it look the same tomorrow and on every record? A tile that is always red, an indicator that never changes, a chart with the same shape on every record is wallpaper. A signal that never varies has stopped being a signal.
5. **Two readings.** Would two users read a colour or icon the same way? If one reads a red chip as "lost deal, normal outcome" and the other as "something broke", the colour is wrong for that meaning, whatever its palette name.

## Composed versus assembled

| composed | assembled |
|---|---|
| block sizes vary by importance and land on the same grid lines | every block takes the cell it happened to land in |
| containers end where their content ends | islands stretched to match their neighbours |
| one clear place the eye lands first | every block at the same weight |
| space carries the grouping | borders and extra islands carry the grouping |
| every empty region has a reason | the empty region is where the grid ran out |
| a few typography presets, used consistently | a different text style on every caption |
| colour appears a few times, meaning something each time | colour on every header, icon and tile |

**The ask:** can you say in one line why each block is the size and place it is? "That is the cell it landed in" means the grid decided and nobody else did.

## Fragmentation and monotony

Two opposite failures with one root: no decision about relative importance was made.

- **Fragmentation**: many small islands or expansion panels of two or three fields each. The page reads as a filing cabinet, every boundary costs attention, nothing dominates. It comes from turning the data model's column list into the page structure. The fix is regrouping, not styling: a dozen small panels are usually three real business blocks (see *Grouping and page flow* in `page-layout-and-controls.md`).
- **Monotony**: identical blocks in a row, such as six metric widgets of one size or four islands of one height. Consistent, defensible, and silent. The fix is hierarchy: the block that answers the page's question gets more room or a more prominent place; the rest get less.

Keep spacing, typography presets, component behaviour, colour meanings and action placement consistent; vary span, height and position by importance.

## Hierarchy and the focal point

Build hierarchy from the quietest lever that works, in this order: position and space, weight, a darker or lighter neutral ink, size, a semantic colour, a filled ground. Most pages jump to colour or a filled tile when position and space would do, and then have nothing left for the genuine exception.

- **De-emphasise to emphasise.** Make the neighbours quieter instead of the important block louder; promoting one block costs nothing if three are demoted.
- **Space before size.** A block with room around it reads as important at the same size as its neighbours.
- **Visual hierarchy is not document hierarchy.** A group caption does not have to look large to be a caption; position, weight and space do the work.
- **Check it in greyscale.** If the hierarchy does not read in a greyscale screenshot, colour is propping it up instead of carrying meaning.
- **The first screen carries the answer**: what this record is, its state, the answer to the page's question, and the primary action. A first screen of header, tag row, tab strip and the top of an empty group is chrome spending the space content needed.

## Proportion, density and grouping

**Fixed plus fluid.** A native record page has one fixed-width side column and one content area that absorbs all remaining width; opening navigation or a right panel narrows the content area while the side column keeps its width. Exactly one area absorbs the slack, and the content area must still read at its narrowest, with a right panel open. Trouble signs: a form beside a chart at equal width (they are not peers), three equal columns of unrelated content, a content column so narrow that labels wrap.

**Density follows the task** (*How dense* in `design-judgement.md`) and comes from structure, not compression: if the only route to density is smaller text or removed spacing, the composition is not found yet.

**Grouping, in order of preference.** Space signals belonging more reliably than lines, and it is free, provided the space inside a group is smaller than the space around it. Then:

1. **Proximity**: related fields adjacent in one grid.
2. **A shared surface**: fields inside one island read as one block, with no border of their own.
3. **A titled expansion panel or divider**: when the block needs a caption, folding, or an unambiguous edge.
4. **A separate island**: when the block is a separate thing (a related record's profile, a metric, a related list).

Each step down adds noise; take the last one last. **Containers follow content**: an island with four fields is not stretched to the height of one with twelve, and a related list ends where its rows end.

## Whitespace: decision or hole

Empty space is a decision or a hole, and conflating them produces opposite defects.

- **A decision** separates groups, gives the focal block room, holds a readable measure, or leaves room for content that arrives at runtime (a list that fills, a panel that expands).
- **A hole** is layout residue: an island stretched to fill a cell it did not need, a group with one field, a grid where the third widget cell was left blank, a side column that ends a few fields in beside a long content area.

**The test:** can you say what the empty region is for? "Breathing room around the stage bar" is an answer; "that is where the column ran out" is a hole. Fixing a hole is rarely a matter of filler; usually the structure is wrong.

The side column of a record page is the exception: "the empty region is deliberate" is never an answer for it, because its balance is a layout rule, not a judgement call (*Balance the page* in `page-layout-and-controls.md`). Elsewhere (beside a reading column, around a focal block, after a short list) the test above applies.

## Restraint: surfaces, borders and elevation

Enterprise software that reads as mature is visually quiet:

- **A border or a tone step, never both, and never with a shadow.** A native island is set apart mainly by its white surface against the page ground; any line it carries is the native one, so never add your own.
- **Space carries grouping before any border does.** Delete a border and fix the spacing before adding one.
- **Shadow is for what floats**: menus, dropdowns, popovers, dialogs, dragged items. A resting island, panel or widget is not elevated.
- **Two or three surface levels at most**: page ground, island surface, floating layers. A tinted box inside an island inside a panel is a level nobody can read.
- **Icons with jobs**: the platform's icon family, where the native component carries one or a glyph is faster than a word; not one per caption for decoration.
- **No gradients** on islands, buttons, text or backgrounds unless the theme ships them.

Island appearance comes from the template and *New island / card container — standard settings* (`page-layout-and-controls.md`); copy it from a shipped page on the same template rather than choosing it.

## The colour budget and colour roles

**Most of the page is neutral.** Native working pages carry only a few percent of coloured pixels. Spend colour, in this order, on the data (the stage, the one status that needs action, chart marks), the primary action, interactive affordance (links, selection), and nothing else: not group captions, island headers, decorative icons, accent bars, or tinted backgrounds "to break things up". Grey for what is fine is a decision, not an absence of one.

**Every colour has one nameable role**, the same on every page of the app. If you cannot say what a colour means here, the element needs none; if amber means "approaching the deadline" in one place and "unsaved" in another, it means neither. The status scale and contrast minimums are in *Freedom UI color guidance* and *Contrast rules* in `accessibility-and-colors.md`.

**Business status is not system feedback.**

| | business status | system feedback |
|---|---|---|
| describes | the state of a record | the result of an action |
| lives | in the data, until the record changes | for seconds, or until dismissed |
| shown as | a stage, a chip, a field value | a message, a notification, inline validation |
| examples | Overdue, Approved, Lost | Saved, Could not connect, 3 records failed |

A business status stays quiet: the native chip is a pale tint of its hue with darker text of the same hue. A "Lost" or "Rejected" that is a normal outcome of the process must not look like a system failure; styling routine states as errors teaches users to panic at them, then to ignore red. System feedback may be louder because it is transient.

**Emphasis is not severity.** Where a message component offers several emphasis levels of one hue (resolve them with `get-component-info`), hue and icon carry the severity and the level says how loudly this message must speak. The loudest level appears at most once per page; if two messages both seem to need it, one is less important than it feels.

**Selection is not an alarm.** A selected tile or filter must not look like a warning; two filled tiles in unrelated hues (one selected, one overdue) read as two alarms.

**Some colours are data.** Stage, priority and tag colours are stored on lookup records, so the stage bar and chips may show a colour in no theme palette. Check the lookup before calling it drift; stage colour choice is in *Progress bars* (`accessibility-and-colors.md`).

**Everything colour says, something else says too**: the status word in the chip, the error text, the stage caption. If a greyscale screenshot still reads, colour is adding speed rather than carrying meaning alone.

## Typography relationships

Typeface, sizes and weights come from the theme and the components' typography presets (see *Typography and visual style* in `page-layout-and-controls.md`). Judgement owns the relationships:

- **Labels recede, values lead.** In a native field the label is grey and smaller, the value is darker ink. "Owner" above a person's name reads as the name with a small grey word above it, never as two equal lines.
- **The page title is the largest text on the page, and it is not large.** A working page is not a landing page.
- **A group caption differs from body text by weight before size.**
- **Metadata** (created by, modified on, ids) sits a step down in contrast and size while meeting *Contrast rules* (`accessibility-and-colors.md`).
- **At most one headline figure per page.** If two figures are the biggest thing, neither is.
- **Few styles, each with a job.** Count the distinct text styles on the rendered page; a style used once is usually a mistake.
- **Secondary text is a lighter colour, not a thinner weight.** Thin small type fails contrast and reads as blurry.
- **"It looks heavier" is usually tracking or colour, not weight.** Compare with the same element on a native page before changing anything; a custom weight or letter-spacing is custom CSS.

## The state matrix

Every interactive element needs an answer for each state. Native components draw most of them; the page puts the element in the right state and gives it the words.

| state | the question it answers | check on the page |
|---|---|---|
| default | what is this | the label is the application's own noun |
| hover | can I click it | never the only carrier of information |
| focus | where am I on the keyboard | visible, never suppressed |
| selected | is this the one I chose | survives scrolling; visible without hover |
| disabled | why can't I use this | legible; the reason is discoverable |
| read-only | is this just information | differs from disabled; the value stays in full ink |
| loading | is it working | the platform's loading state, not a blank island |
| empty | is it broken or just empty | says which of the four empty states it is |
| error | what went wrong and what now | in words next to the problem, not only red |

**Read-only is not disabled.** Native Creatio keeps a read-only field's value in full ink and marks it with a lock; a disabled field greys its value. Read-only means "this is information"; disabled means "you cannot do this now, for a reason". A read-only field styled as disabled sends users hunting for a permission problem that does not exist. Read-only and calculated fields also need the source tooltip (*Field guidance* in `page-layout-and-controls.md`).

**Empty and failed states** have their own words: the four empty states and partial failure are in *Empty states* and *Errors: prevention, then recovery* in `ux-writing.md`. A tab or related list empty on most records is a candidate for removal or conditional visibility, not for an empty state.

## What native Creatio looks like

Observations measured on running Creatio pages (computed styles and geometry, not screenshots). They are not values to type into a page; they describe native, so a deviation reads as a defect. Confirm against a shipped page of the same kind on the target environment before relying on one.

**Islands and the page ground**

- The record body is white islands on the page ground, set apart mainly by the ground showing between them. Whether a given container also carries a hairline border is a property of the template, not a rule to remember: measure the native page on the same template (`visual-check.md`, *Compare computed styles with the reference*) instead of assuming either way. The channels between islands and at the page edge are equal, so the islands read as one system, and the header sits on the same plate.
- The ground between islands is the page showing through, not a painted band, so it is never one flat colour; a custom container painting its own grey band reads as foreign.
- Islands have a medium corner radius; buttons, inputs and navigation tiles a small one; chips are fully rounded. An island whose radius, border or shadow differs from the native island in the same place on the same template is a defect even if it looks acceptable alone.

**Fields**

- A resting input is underlined with a **dotted** rule. Hover, focus and validation turn it solid (focus in the link colour; validation in the error colour, with the message beneath).
- The value line keeps its height when empty, so an empty field's underline sits where a filled one's does.
- Labels are grey and quieter than values. A long text such as Description is one full-width field, not two half-width ones. Read-only fields keep the dotted rule and full-ink value and add a lock; placeholders are a lighter grey.

**Chips, tabs, panels, tooltips**

- A status or tag chip is a pale tint of its hue with darker text of that hue; saturated chips with white text are not native.
- In a tab strip the active label is ink with an accent underline sitting on the strip's rule; inactive labels are in the link colour.
- An expansion panel header carries a small toggle, the caption, and its tools as bare ink glyphs, not buttons or a search field.
- The native tooltip is a dark ground with white text.

**Stage bar and page kinds**

- On the **stage bar**, reached stages take the stage's own colour from the lookup data with white text; unreached stages are neutral grey. What it is for, and why it is not a stepper: *Stage bar is not a stepper* in `page-patterns.md`.
- A record page has three native shapes: a form with a side column; a full page that also carries its own right-side panel; a person-style page with no left column and no stage bar. Section pages and shell panels: *Section list page (list report)* and *Workspace and multi-pane screens* in `page-patterns.md`.

## The tells of generated work on a Freedom UI page

What makes a page read as machine-made, roughly loudest first, and what a native page does instead:

| tell | what a native page does |
|---|---|
| A welcome line or an explanatory sentence as the title | a noun title (the primary display value), and the work |
| Captions that narrate ("Where the time has gone", "What this card will do") | the application's own nouns ("Notes", "Card settings") |
| An indicator per field, each repeating the field's value | label and value in the field; analytics only where they answer the page's question |
| Metric tiles each in its own colour, or a filled tile when nothing needs action | neutral tiles; colour only on the one that needs action, if any |
| A decorative icon on every caption and tile | icons where the native component carries one |
| Islands with a border, a shadow or a radius the native ones lack | islands styled exactly like the native ones on the same template |
| Saturated chips with white text; a routine "Lost" styled as an error | pale tint chips; a routine outcome styled as routine |
| Solid field underlines, or every input restyled to outline | the native dotted rule and default appearance |
| A side column half-empty, or filled with decorative widgets | a balanced column of needed fields, or a template without a side column |
| A stepper showing a record's lifecycle, or a stage bar as a form wizard | the stage bar for lifecycle, the stepper for filling a form |
| Demo records named "Test 1" with totals that do not add up | plausible data whose totals add up from their rows |
| An illustration with "No data" on every empty list | the empty state that says which of the four it is, in one line (`ux-writing.md`) |

A page with every tell removed is not yet good; it is tidy. What fills the space afterwards is the product: the record's real data at its real size, the page's question answered by its most prominent block, and totals that add up.

## Seeing what is really on the page

Structural checks (`get-page`, page validation, the accessibility tree) find structural defects; craft defects (a radius a step off, a leftover border, a label a shade too dark) show only when the rendered page sits next to a native one. Use structure to decide what to work on, then compare side by side with a shipped page of the same kind before calling anything finished.

- **The eye finds craft; the measurement settles numbers.** A screenshot confirms a story ("this island has a border the others lack"); a computed style, a bounding box or an overflow measurement confirms a number (*Measure, do not eyeball* in `visual-check.md`).
- **A style name is not a colour.** A role or input value named "primary", "interaction" or "accent" can resolve to something unexpected, such as a near-white tint that makes text vanish against its own row. Render it and look before relying on it; a variant named for a state changes what it changes (the ground, a marker, the ink), so read which.
- **Words are checked on the rendered page too:** labels that narrate and copy that points at a moved block are in *Terminology and consistency* and *Copy that depends on what sits beside it* in `ux-writing.md`.
- **A pass on one page kind says nothing about another.** A passing record page does not vouch for the section page, mini page or stepper of the same app; look at each kind that changed, on the stand that will be used.

Credit: parts of this reference draw on *Refactoring UI* (hierarchy by de-emphasis), Material's canonical layouts (fixed plus fluid), Carbon's density guidance and PatternFly's empty-state guidelines.
