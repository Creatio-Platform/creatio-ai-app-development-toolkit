# Visual check of the rendered page

Use this reference to check a built or edited Freedom UI page in the browser for visual defects that no rule names: a border the native page does not draw, a padding one step off, a caption cut by its container, a tab marker a pixel off its rule. The checklists in `review-checklists.md` catch what is written down; this file catches what is not, by comparing the rendered page with a native Creatio page on the same template and by measuring instead of looking. The helpers in `../scripts/visual-check.js` read the page without changing it and run in the browser tool's JavaScript execution (for example `javascript_tool`); browser surfaces name their tools differently, so the tool names are examples.

## Contents

- Measure, do not eyeball
- The minimum check (default after every built page)
- Choose the native reference
- Read the DOM as the component map
- Install the visual-check helpers
- Compare computed styles with the reference
- Inspect zoomed crops
- Measure overflow and clipping
- Overlay the reference in difference mode
- What these checks cannot see
- Report what was checked
- Optional: deep review (on request or for a hero block)
  - Ask a blind critic
  - Run the design loop for a hero block
  - Review a whole app with a multi-seat board

## Measure, do not eyeball

Four facts decide how a rendered page is checked:

- **A screenshot finds the big surfaces; a measurement and a difference overlay find the craft.** A full-page look catches a missing island or a page that reads as one flat sheet, not letter-spacing, a marker off its rule, a radius one step too large, or a hairline present on one page and absent on the other.
- **Clipping hides overflow, and a screenshot confirms the lie.** Content wider than its container looks perfect when an ancestor clips it. Overflow is a measurement (`scrollWidth` against `clientWidth`), never a look.
- **For looks, the measured native page beats any written description of it** (*When rules collide* in `SKILL.md`). When this skill, a design mock, or memory says how a native element looks and the native reference measures otherwise, report the contradiction instead of "fixing" the page toward the text. Looks only (border, radius, spacing, colour role): a native page that breaks a layout rule of this skill, such as the column balance, does not overrule it.
- **A measurement is evidence, not a target.** Values the helpers print (pixels, `rgb()` colours) describe what the native page renders. Never type them into a page body: the fix is the component's native input or the removal of a custom style (*Custom CSS* in `page-layout-and-controls.md`).

## The minimum check (default after every built page)

Run these three on every page you build or change, before calling it done; each is a measurement with a result to report:

1. **Style census** against a native reference on the same template — *Compare computed styles with the reference*.
2. **Overflow** at the default width and with a right panel open — *Measure overflow and clipping*.
3. **Zoomed crops of each island**, its header and its button row, next to the same crops of the reference — *Inspect zoomed crops*.

The difference overlay is the next step when a crop pair leaves a difference unclear. The blind critic, the design loop and the board cost several model calls each and run only on request or for a hero block (*Optional: deep review*). Inside a migration build task, the browser budget of that skill's build brief governs how often the browser opens; run the minimum check in the review pass, reusing the page that is already open.

## Choose the native reference

The reference is a shipped Creatio page of the same kind, on the **same template** as the page under review. A page on another template is not a reference: its containers, gutters and header differ by design.

1. Read the page under review with `get-page` and note its template (the parent schema) and the containers it inherits.
2. Resolve the templates with `list-page-templates` and pick a shipped page built on the same one (for a side-profile record page, for example the Accounts or Contacts form page where the product ships them). Read its structure with `get-page`: which containers it uses and which properties it sets on them.
3. Open both pages in the browser in the same state: the same window size, the navigation panel and the right panels in the same state (collapsed or open), a record filled to a comparable degree, the same tab selected. A difference in state shows up as a difference in pixels.

Every page kind takes a shipped page of the same kind: a record page on the same template, a section list page, a dashboard page. A mini page is compared with a shipped mini page opened from a related list's add action, a dialog with a native dialog of the same size, a home page with a shipped home page of the same workplace type. A stepper page with no shipped step-by-step page in the environment is compared component by component against the defaults from `get-component-info`.

When no shipped page of the kind exists, do not substitute another page of ours: a page of ours is the thing being checked, not the bar. Say the reference comparison was not run and why.

## Read the DOM as the component map

Freedom UI renders as custom elements whose tag is the component's name: `crt-flex`, `crt-grid`, `crt-expansion-panel`, `crt-tab-panel-container`, `crt-button`, `crt-label`, `crt-data-grid`. When a screenshot leaves it unclear what a box is, read its tag.

- **`element-name` is the bridge to the page body.** A rendered component carries the name the page body gives it in its `element-name` attribute (`SideAreaProfileContainer`, `MainHeader`, the names of your own inserts). A finding on the rendered page therefore maps straight to the node in `get-page` that causes it.
- **Container intent is in the class.** Classes such as `container-gap-small`, `container-gap-medium`, `fit-content` and `stretch` show which native setting produced a spacing.
- **The page body sits under `crt-navigation-schema-outlet`; an open dialog sits in `.cdk-overlay-container`.** The shell (toolbar, navigation panel, right panels) is outside both and is identical on any two pages of one site, so the helpers below skip it.
- **Read geometry with `getBoundingClientRect`, never from screenshot pixels.** The browser pane scales the viewport, and a fractional device-pixel ratio can make a native hairline compute as a fraction of a CSS pixel.

## Install the visual-check helpers

Paste the content of `../scripts/visual-check.js` into the browser's JavaScript tool (for example `javascript_tool`) once in the open Creatio tab. It defines `__vcCensus`, `__vcOverflow`, `__vcRects`, `__vcOverlay` and `__vcOverlayOff` on `window`, keeps full results in `window.__visualCheck`, and returns the list of installed helpers; it changes nothing on the page except the temporary frame `__vcOverlay` adds. The functions survive an in-app route change (clicking through, or setting `location.hash`), so open the reference and the page under review by route in the same tab; a reload or a typed URL discards them, and then the script is pasted again.

Output is paged at twelve lines because browser tools cut long results; read the rest with the `slice(12)` expression the output prints.

## Compare computed styles with the reference

The style census lists, for every component that carries an `element-name`, the computed border, border radius, box shadow, background, padding and gap, and compares the two pages by **signature**: component tag + property + value. Element names are ignored in the comparison, so two native pages on the same template compare clean, and every line that does appear is a real difference in how a kind of component is drawn.

1. Install the helpers (previous section) on the reference page and run `__vcCensus('reference')`. Read the table once: it is the native vocabulary of this template — which containers are cards, which carry a hairline, which only space their children.
2. Open the page under review by in-app route and run `__vcCensus('ours')`. It prints the difference:
   - **`+` lines — only in ours.** Each is a finding: a border, shadow, radius, background or spacing the native page never draws on that kind of component. Remove it (set the component's native input back, drop the `styles`/`classes`/`extraStyles` that carry it) or justify it as a deliberate, confirmed decision under *Custom CSS* in `page-layout-and-controls.md`. The names after `<-` are the page-body elements to fix; find them in `get-page`.
   - **`-` lines — only in the reference.** Native styling ours lacks: typically a container holding content on the page background with no card (see the island item in `review-checklists.md` → *Layout and structure*), or a panel without the native radius. Check whether ours has a component of that kind at all before calling it a defect; a page without related lists legitimately lacks the panel lines.
3. When a component's look comes from its inner parts (an expansion panel's header row, a data grid's header), rerun both sides with `__vcCensus('reference', true)` and `__vcCensus('ours', true)`; inner elements are then listed under `<tag> > <inner tag>`.
4. Fix through the page body, never by copying a printed value: compare the offending node's properties in `get-page` with the reference node's properties and with `get-component-info`, and change the property that differs.

A component the census does not list has no `element-name` or is not visible; scroll it into view or open the tab that holds it and run the census again.

## Inspect zoomed crops

A full-page screenshot is downscaled, and loses exactly what this check is for: one-pixel lines, dotted field underlines, small radii, focus rings, a marker on or off its rule. Judge those on crops only.

1. Take one screenshot and note its coordinate-frame width (the tool reports it).
2. Run `__vcRects(<that width>)`. It prints a zoom region for every visible island, card, expansion panel and tab container, already converted from CSS pixels into the screenshot's frame.
3. Zoom (for example `computer` → `zoom` with the printed region) on each island, each group or panel header, the tab strip, the page header, and the footer or button row of each island. Scroll and repeat for the parts below the fold; regions are printed for the visible part only.
4. Zoom the same region on the reference at the same scale and compare the two crops. Name a difference in numbers where it is a number (measured with `getBoundingClientRect` or the census, not by eye), and as a role or relationship where it is a colour. A crop pair is also how a finding is reported (*Pixel review format* in `review-checklists.md`).

## Measure overflow and clipping

A clipped overflow looks fine in a screenshot. Measure it.

1. On the reference run `__vcOverflow('reference')`; on the page under review run `__vcOverflow('ours')`.
2. Native pages overflow in their own ways (a tab strip that clips vertically, a grid caption a few pixels wider than its cell), so for ours the helper lists **every ellipsis cut** and **other overflow kinds only where the reference has none** on that component type.
3. Each line names the component (`element-name`), the inner element, how much shows against how much exists, and the start of its text. Findings: a caption or value cut by an ellipsis where the native page shows it whole, a cut button label, a container that clips its children, a horizontal scrollbar inside an island or field group. A data grid with more columns than its width scrolls by design — compare with the reference grid first.
4. Rerun after every width change, because overflow appears at a width, not on a page: with a right panel open, with the navigation panel expanded, and at a narrower window (resize the browser window, reload by in-app route, run again). Raise `MIN` (the second argument, in CSS pixels) only to silence sub-glyph noise, never to make a real cut disappear.

## Overlay the reference in difference mode

Laying one rendering on top of the other in *difference* blend turns identical pixels black and leaves only the differences lit: tracking that makes a tab strip drift, a marker two pixels off its rule, an inner padding one step off. Use it on comparable components — the same template container on both pages (page header, side profile container, tab strip), or the same component kind passed by name on each side — and judge the chrome (edges, corners, header rows, spacing), not the text, which differs between records anyway.

1. On the page under review, with the helpers installed, run `await __vcOverlay('<full URL of the reference page, same site>', '<element-name in ours>', '<element-name in the reference>')` (the third argument defaults to the second). The reference loads in a temporary same-origin frame laid over the page and shifted so the two components align.
2. Zoom on the component (its box is printed in CSS pixels; take the region from `__vcRects` or scale the box by the screenshot ratio). Black is identical; anything lit differs.
3. Name each lit difference, measure it on both pages, and report it as a crop pair.
4. Remove the frame with `__vcOverlayOff()` before doing anything else on the page.

If the helper answers `frame refused`, the site does not allow same-origin framing; fall back to crop pairs at the same scale and the census.

## What these checks cannot see

Say so in the report; the eye still matters.

- **Whether the page is the right page.** Composition, balance, the order a user fills it in, the fit of the template — that is the checklist in `review-checklists.md`, `design-judgement.md` and `page-layout-and-controls.md`.
- **Relationships between parts.** Two radii nesting badly, two greys that are each native but wrong together, a colour role reused for an unrelated meaning.
- **Choice of content.** The wrong icon or image, a label that is accurate but unclear, data that is technically valid but implausible.
- **States not on screen.** Hover, focus, disabled, read-only, empty, error, loading — unless you put the page into that state and run the checks again.
- **Other contexts.** Other themes, other languages (longer captions overflow where English fits), other window widths and panel states not measured.
- **Components outside the census.** Elements without an `element-name`, and inner styling unless the census ran with inner elements.
- **Comparison without a reference.** The census and the overlay compare; on a page kind with no shipped reference they have nothing to compare against.

Look at the whole page at full resolution at least once, the way a user meets it, after the measurements.

## Report what was checked

A visual check reports its method, not a feeling. Include:

- **The reference**: schema name, template, and how it was opened; or that no reference existed and why.
- **Each instrument, ran or not**: style census (with or without inner elements), zoomed crops (which regions), overflow (at which widths and panel states), difference overlay (which components), and from the deep review the blind critic (verdict and the gap it named), design loop or board, if run. An instrument not run is listed with the reason.
- **Findings** as numbered issues in the format of *Pixel review format* in `review-checklists.md`: a "Now — build" / "Should be — native" crop pair, the measured numbers in the labels, the `element-name` and page-body node to change, and a `Done when:` line.
- **What was not verified**, from the list above — for example "census and overflow at the default width with panels closed; not checked with the right panel open or in another language".

"Looks native" with no method behind it is not a result.

## Optional: deep review (on request or for a hero block)

These checks put fresh-context critics or several reviewers on the rendered result. Each costs several model calls, so run them when the user asks for a deeper review, or for the one block that carries the page when a named reference exists. They come after the minimum check, never instead of it.

### Ask a blind critic

The builder cannot judge its own page: it knows what it meant. A fresh-context subagent sees only the result.

- Give it exactly two images: a crop (or full page) of ours and the same crop of the native reference, at the same scale, **labels stripped and order randomised**. Record which is which yourself; do not tell it.
- Ask one question: *which of the two looks like a native Creatio page, and what is the single biggest gap in the other one?* Binary verdict, one gap — not a score, not a list.
- Never give it the page body, the code, the census, or which image is ours: reading the implementation makes a critic judge intent instead of result.
- Run it on the strongest model available, passed explicitly on the subagent call; a weak craft critic approves everything.
- If it picks the reference as native and names a gap, that gap is a finding: verify it on the page (critics hallucinate), then fix it or record why not. If it cannot tell them apart, record that as the result of this check.

### Run the design loop for a hero block

> Adapted from "The Design Loop: Free Guide", itself an adaptation of the Gauntlet Loop by Matt Shumer. The four phases, the three critics, the binary verdicts and the failure modes are the guide's; the binding to Creatio pages is this skill's.

The checklist asks *is this right?* The loop asks *is this better than a named reference?* It runs on **one block that carries the page** — the side profile island, the page header and stage area, the key widget of a dashboard — and only when a named reference exists: a native Creatio page measured in the browser, or the design team's mock of the same product. Without one, the minimum check is what the page needs.

1. **Name the bar.** A specific page or frame that can be opened, not "modern" or "clean"; with a vague bar the critic invents a comparison and approves round one.
2. **Preflight.** Confirm the bar opens, the page under review renders, and the components resolve with `get-component-info`. If any is missing, say which critic goes blind and do not run it.
3. **Teardown.** Write 5–7 mechanisms of the bar to `bar.md`, each checkable by looking and read off the reference by measurement, as relationships and roles, never values to copy — for example "the header carries at most one primary action; the rest are quiet utilities", "the profile island and the content area share one gutter". Show `bar.md` to the user before continuing.
4. **Loop.** Per round, a builder changes the block through `update-page`; then three critics, each in fresh context, judge the rendered result:

| Critic | Given | Never sees | Model |
|---|---|---|---|
| Brief | the rendered crop and the page's question in one sentence | the page body, the bar | a mid-tier model |
| System | the rendered crop, the census difference, the `get-component-info` output for the block's components, and this skill's rules | the bar, the question | a fast model is enough |
| Craft | the rendered crop and the reference crop, blind and unlabelled, plus `bar.md` | which one is ours | the strongest model available |

Verdicts are binary and all three must pass; a fail goes back to the builder with the single biggest gap. There is no fixed round count: the exit is winning, or the user stopping the run. Write each round's verdicts as a verdict file (*Verdict file* in `review-checklists.md`) and keep `bar.md`, the round log and the verdicts in the task's working directory, never in this skill.

What breaks it: a vague bar, the builder judging its own work, a soft critic, a fixed round count, a `bar.md` written from memory. It cannot see two radii that nest badly, the wrong image or icon, or anything outside the block, so run the checklist after the loop exits.

### Review a whole app with a multi-seat board

The loop judges one block repeatedly; a board judges a finished set of pages once, across dimensions, before handover. Run it on request after an app's pages are built: spawn the seats as parallel fresh-context subagents in one message, each with the page list (schema names and rendered screenshots), each page's question and user, and its own charter.

1. **Domain** — every number, deadline, status and workflow is plausible for the business.
2. **Data consistency** — the same figure shown twice matches; totals reconcile to their parts; dates and statuses agree with each other.
3. **Writing and localization** — every label is the application's own word, one term per concept across pages, formats fit the market (see *Copy and content* in `review-checklists.md`).
4. **UX** — each page answers its question; every control the copy promises is visible; no two actions share an icon; the largest block carries the page's main point.
5. **Freedom UI** — only native components, resolved with `get-component-info`; the census difference, the overflow check and the zoomed crops above, run and not eyeballed.
6. **Cross-page consistency** — the same function carries the same icon, label and position everywhere (WCAG SC 3.2.4); shared layout conventions hold across pages.

Merge the findings into one verdict file. When seats disagree: domain correctness, then data consistency, then UX clarity, then writing, then visual polish — a true page beats a polished wrong one. Verify every finding on the page before acting on it, record dismissals with their reason, and after fixing rerun the measurable checks and report the count that passed.
