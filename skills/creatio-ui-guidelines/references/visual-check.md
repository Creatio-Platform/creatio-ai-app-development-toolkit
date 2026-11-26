# Visual check of the rendered page

Use this reference to check a built or edited Freedom UI page in the browser for visual defects that no rule names: a border the native page does not draw, a padding one step off, a caption cut by its container, a tab marker a pixel off its rule. The checklists in `review-checklists.md` catch what is written down; this file catches what is not, by comparing the rendered page with a native Creatio page on the same template and by measuring instead of looking. Every snippet here is generic, reads the page without changing it, and runs in the browser tool's JavaScript execution (for example `javascript_tool`); browser surfaces name their tools differently, so the tool names are examples.

## Contents

- Measure, do not eyeball
- Choose the native reference
- Read the DOM as the component map
- Install the visual-check helpers
- Compare computed styles with the reference
- Inspect zoomed crops
- Measure overflow and clipping
- Overlay the reference in difference mode
- Ask a blind critic
- Run the design loop for a hero block
- Review a whole app with a multi-seat board
- What these checks cannot see
- Report what was checked

## Measure, do not eyeball

Four facts decide how a rendered page is checked:

- **A screenshot finds the big surfaces; a difference overlay and a measurement find the craft.** A full-page look catches a missing island or a page that reads as one flat sheet. It does not catch letter-spacing, a marker floating off its rule, a radius one step too large, or a hairline that is present on one page and absent on the other — those show up only when the two pages are measured or laid on top of each other.
- **Clipping hides overflow, and a screenshot confirms the lie.** Content wider than its container looks perfect when an ancestor clips it. Overflow is a measurement (`scrollWidth` against `clientWidth`), never a look.
- **The native page wins over any written description of it.** When this skill, a design mock, or memory says how a native element looks and the native reference measures otherwise, the measurement holds for the visual fact; report the contradiction instead of "fixing" the page toward the text. This covers looks only (border, radius, spacing, colour role) — layout rules of this skill, such as the left/right balance, are not overruled by a native page that breaks them.
- **A measurement is evidence, not a target.** Values printed by the snippets below (pixels, `rgb()` colours) describe what the native page renders. Never type them into a page body: the fix is the component's native input or the removal of a custom style (see the custom-CSS rule in `SKILL.md`).

Inside a migration build task, the browser budget of that skill's build brief governs how often the browser opens; run this file's checks in the review pass, reusing the page that is already open.

## Choose the native reference

The reference is a shipped Creatio page of the same kind, on the **same template** as the page under review. A page on another template is not a reference: its containers, gutters and header differ by design.

1. Read the page under review with `get-page` and note its template (the parent schema) and the containers it inherits.
2. Resolve the templates with `list-page-templates` and pick a shipped page built on the same one — for a record page with a side profile, a base-product record page of that template (for example the Accounts or Contacts form page where the product ships them). Read its structure with `get-page`: which containers it uses and which properties it sets on them.
3. Open both pages in the browser in the same state: the same window size, the navigation panel and the right panels in the same state (collapsed or open), a record filled to a comparable degree, the same tab selected. A difference in state shows up as a difference in pixels.

By page kind:

| Page under review | Reference |
|---|---|
| Record (form) page | a shipped record page on the same template (side profile, header above tabs, or progress-bar template) |
| Section list page | a shipped section list page |
| Mini page | a shipped mini page, opened from a related list's add action |
| Dialog / modal | a native dialog of the same size |
| Dashboard / analytics page | a shipped dashboard page |
| Step-by-step page (stepper) | a shipped step-by-step page if the environment has one; otherwise there is no page reference — compare the components against their defaults from `get-component-info` and state that the reference comparison was not run |
| Home / landing page | a shipped home page of the same workplace type |

When no shipped page of the kind exists in the environment, do not substitute another page of ours: a page of ours is the thing being checked, not the bar. Say the reference comparison was not run and why.

## Read the DOM as the component map

Freedom UI renders as custom elements whose tag is the component's name: `crt-flex`, `crt-grid`, `crt-expansion-panel`, `crt-tab-panel-container`, `crt-button`, `crt-label`, `crt-data-grid`. When a screenshot leaves it unclear what a box is, read its tag.

- **`element-name` is the bridge to the page body.** A rendered component carries the name the page body gives it in its `element-name` attribute (`SideAreaProfileContainer`, `MainHeader`, the names of your own inserts). A finding on the rendered page therefore maps straight to the node in `get-page` that causes it.
- **Container intent is in the class.** Classes such as `container-gap-small`, `container-gap-medium`, `fit-content` and `stretch` show which native setting produced a spacing.
- **The page body sits under `crt-navigation-schema-outlet`; an open dialog sits in `.cdk-overlay-container`.** The shell (toolbar, navigation panel, right panels) is outside both and is identical on any two pages of one site, so the helpers below skip it.
- **Read geometry with `getBoundingClientRect`, never from screenshot pixels.** The browser pane scales the viewport, and the device-pixel ratio can be fractional, so a native hairline border can compute as a fraction of a CSS pixel.
- Most components render without shadow DOM; the helpers still walk shadow roots so a component that uses one is not missed.

## Install the visual-check helpers

Run this once in the open Creatio tab. It defines five functions on `window` and writes nothing except its results in `window.__visualCheck` and, only while `__vcOverlay` runs, one temporary overlay frame. The functions survive an in-app route change (clicking through, or setting `location.hash`), so open the reference and the page under review by route in the same tab; a reload or a typed URL discards them, and then the script is run again.

```js
(() => {
  const store = window.__visualCheck = window.__visualCheck || {};
  // The shell is the same on both pages; the page body and any open dialog are what differ.
  const roots = () => {
    const s = document.querySelectorAll('crt-navigation-schema-outlet, .cdk-overlay-container');
    return s.length ? [...s] : [document];
  };
  const each = (root, fn) => {
    for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) each(el.shadowRoot, fn); fn(el); }
  };
  // Tool output is often cut after a few thousand characters: print one page, keep the rest.
  const page = (key, head, lines) => {
    store[key] = lines;
    const more = lines.length > 12 ? [`... ${lines.length - 12} more: __visualCheck.${key}.slice(12)`] : [];
    return [head, ...lines.slice(0, 12), ...more].join('\n');
  };
  const blank = v => !v || v === 'none' || v === 'normal' || v === 'transparent'
    || /^(0px ?)+$/.test(v) || /rgba\([^)]*,\s*0\)$/.test(v) || /\/\s*0\)$/.test(v);
  const sides = f => {
    const v = ['top', 'right', 'bottom', 'left'].map(f);
    return v.every(x => x === v[0]) ? v[0] : v.join(' ');
  };
  const PROPS = ['border', 'radius', 'shadow', 'background', 'padding', 'gap'];
  const styleOf = el => {
    const cs = getComputedStyle(el), g = p => cs.getPropertyValue(p);
    const border = sides(s => (g(`border-${s}-style`) === 'none' || g(`border-${s}-width`) === '0px')
      ? '-' : `${g(`border-${s}-width`)} ${g(`border-${s}-style`)} ${g(`border-${s}-color`)}`);
    const img = g('background-image');
    const out = {
      border: border === '-' ? '' : border,
      radius: g('border-radius'),
      shadow: g('box-shadow'),
      background: [g('background-color'), img === 'none' ? '' : img.slice(0, 60)].filter(x => !blank(x)).join(' + '),
      padding: sides(s => g(`padding-${s}`)),
      gap: g('row-gap') === g('column-gap') ? g('row-gap') : `${g('row-gap')} / ${g('column-gap')}`,
    };
    for (const p of PROPS) if (blank(out[p])) delete out[p];
    return out;
  };
  const shown = el => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  window.__vcCensus = (MODE, INNER = false) => {
    const rows = [];
    for (const root of roots()) each(root, el => {
      const name = el.getAttribute('element-name');
      if (!name || !shown(el)) return;
      const tag = el.tagName.toLowerCase();
      rows.push({ tag, name, style: styleOf(el) });
      if (INNER) for (const c of el.querySelectorAll('*')) {
        if (c.closest('[element-name]') !== el || !shown(c)) continue;
        const s = styleOf(c);
        if (Object.keys(s).length) rows.push({ tag: `${tag} > ${c.tagName.toLowerCase()}`, name, style: s });
      }
    });
    const sigs = {};
    for (const r of rows) for (const p of PROPS) if (r.style[p]) {
      const k = `${r.tag} | ${p}: ${r.style[p]}`;
      (sigs[k] = sigs[k] || []).push(r.name);
    }
    store[`census_${MODE}`] = sigs;
    const ref = store.census_reference;
    if (MODE === 'ours' && ref) {
      const extra = Object.keys(sigs).filter(k => !ref[k]).map(k => `+ ${k}   <- ${sigs[k].slice(0, 4).join(', ')}`);
      const lack = Object.keys(ref).filter(k => !sigs[k]).map(k => `- ${k}`);
      return page('census_diff', `ours vs reference: ${extra.length} only in ours (+), ${lack.length} only in the reference (-)`, [...extra, ...lack]);
    }
    const table = rows.filter(r => Object.keys(r.style).length)
      .map(r => `${r.tag} ${r.name} | ${PROPS.filter(p => r.style[p]).map(p => `${p}: ${r.style[p]}`).join(' | ')}`);
    return page(`census_${MODE}_lines`, `${MODE}: ${rows.length} named components, ${table.length} styled`, table);
  };

  window.__vcOverflow = (MODE, MIN = 8) => {
    const found = [];
    for (const root of roots()) each(root, el => {
      if (/^(svg|mat-icon|img)$/i.test(el.tagName)) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || el.clientWidth < 4 || el.clientHeight < 4) return;
      const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
      let kind = '';
      if (dx > 4 && cs.textOverflow === 'ellipsis') kind = 'text cut by ellipsis';
      else if (dx >= MIN && /hidden|clip/.test(cs.overflowX)) kind = 'clipped horizontally';
      else if (dx >= MIN && /auto|scroll/.test(cs.overflowX)) kind = 'scrolls horizontally';
      else if (dy >= MIN && /hidden|clip/.test(cs.overflowY)) kind = 'clipped vertically';
      if (!kind) return;
      const h = el.closest('[element-name]'), tag = el.tagName.toLowerCase();
      found.push({ key: `${kind} | ${h ? h.tagName.toLowerCase() : '-'} > ${tag}`,
        line: `${kind} | ${h ? h.getAttribute('element-name') : '-'} > ${tag} | shows ${el.clientWidth}x${el.clientHeight} of ${el.scrollWidth}x${el.scrollHeight} | "${(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"` });
    });
    store[`overflow_${MODE}`] = found;
    const ref = MODE === 'ours' && store.overflow_reference;
    const keep = ref ? found.filter(f => f.key.startsWith('text cut') || !ref.some(r => r.key === f.key)) : found;
    return page(`overflow_${MODE}_lines`, `${MODE}: ${found.length} overflowing, ${keep.length} listed`
      + (ref ? ' (every ellipsis cut, other kinds only where the reference has none)' : ''), keep.map(f => f.line));
  };

  window.__vcRects = (SHOT_WIDTH = innerWidth) => {
    const k = SHOT_WIDTH / innerWidth, out = [];
    for (const root of roots()) for (const el of root.querySelectorAll('[element-name]')) {
      const cs = getComputedStyle(el), b = el.getBoundingClientRect();
      const card = !blank(cs.backgroundColor) || cs.borderTopStyle !== 'none'
        || /^crt-(expansion-panel|tab-panel-container)$/i.test(el.tagName);
      if (!card || b.width < 4 || b.height < 4 || b.bottom < 0 || b.top > innerHeight) continue;
      const r = [b.left, Math.max(b.top, 0), b.right, Math.min(b.bottom, innerHeight)].map(v => Math.round(v * k));
      out.push(`${el.getAttribute('element-name')} (${el.tagName.toLowerCase()}): [${r.join(', ')}]`);
    }
    return page('rects', `zoom regions in a ${SHOT_WIDTH}-wide screenshot frame (visible part only)`, out);
  };

  window.__vcOverlay = async (REF_URL, OURS_NAME, REF_NAME = OURS_NAME) => {
    document.getElementById('__vc_overlay')?.remove();
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const find = (doc, name) => doc.querySelector(`[element-name="${name}"]`);
    const ours = find(document, OURS_NAME);
    if (!ours) return `no element-name="${OURS_NAME}" on this page`;
    ours.scrollIntoView({ block: 'center' });
    const f = Object.assign(document.createElement('iframe'), { id: '__vc_overlay', src: REF_URL });
    Object.assign(f.style, { position: 'fixed', left: '0', top: '0', width: `${innerWidth}px`, height: `${innerHeight}px`,
      border: '0', mixBlendMode: 'difference', pointerEvents: 'none', zIndex: '2147483647' });
    document.body.appendChild(f);
    let theirs = null;
    for (let i = 0; i < 60 && !theirs; i++) {
      await sleep(500);
      try { theirs = find(f.contentDocument, REF_NAME); } catch (e) { f.remove(); return `frame refused: ${e.message}`; }
    }
    if (!theirs) { f.remove(); return `no element-name="${REF_NAME}" in the reference after 30 s`; }
    await sleep(1500);
    theirs.scrollIntoView({ block: 'center' });
    await sleep(500);
    const a = ours.getBoundingClientRect(), b = theirs.getBoundingClientRect();
    f.style.left = `${Math.round(a.left - b.left)}px`;
    f.style.top = `${Math.round(a.top - b.top)}px`;
    const box = r => `${Math.round(r.width)}x${Math.round(r.height)}`;
    return `overlay on: ours ${box(a)} at ${Math.round(a.left)},${Math.round(a.top)} (CSS px), reference ${box(b)}; `
      + 'zoom on that box, then remove it: __vcOverlayOff()';
  };
  window.__vcOverlayOff = () => { document.getElementById('__vc_overlay')?.remove(); return 'overlay removed'; };

  return 'installed: __vcCensus, __vcOverflow, __vcRects, __vcOverlay, __vcOverlayOff';
})();
```

Output is paged at twelve lines because browser tools cut long results; read the rest with the `slice(12)` expression the output prints.

## Compare computed styles with the reference

The style census lists, for every component that carries an `element-name`, the computed border, border radius, box shadow, background, padding and gap, and compares the two pages by **signature**: component tag + property + value. Element names are ignored in the comparison, so two native pages on the same template compare clean (a shipped Accounts and Contacts form page on one template give zero lines either way), and every line that does appear is a real difference in how a kind of component is drawn.

1. Install the helpers (previous section) on the reference page and run `__vcCensus('reference')`. Read the table once: it is the native vocabulary of this template — which containers are cards, which carry a hairline, which only space their children.
2. Open the page under review by in-app route and run `__vcCensus('ours')`. It prints the difference:
   - **`+` lines — only in ours.** Each is a finding: a border, shadow, radius, background or spacing the native page never draws on that kind of component. Remove it (set the component's native input back, drop the `styles`/`classes`/`extraStyles` that carry it) or justify it as a deliberate, confirmed decision under the custom-CSS rule in `SKILL.md`. The names after `<-` are the page-body elements to fix; find them in `get-page`.
   - **`-` lines — only in the reference.** Native styling ours lacks: typically a container holding content on the page background with no card (see the island item in `review-checklists.md` → *Layout and structure*), or a panel without the native radius. Check whether ours has a component of that kind at all before calling it a defect; a page without related lists legitimately lacks the panel lines.
3. When a component's look comes from its inner parts (an expansion panel's header row, a data grid's header), rerun both sides with `__vcCensus('reference', true)` and `__vcCensus('ours', true)`; inner elements are then listed under `<tag> > <inner tag>`.
4. Fix through the page body, never by copying a printed value: compare the offending node's properties in `get-page` with the reference node's properties and with `get-component-info`, and change the property that differs.

A component the census does not list has no `element-name` or is not visible; scroll it into view or open the tab that holds it and run the census again.

## Inspect zoomed crops

A full-page screenshot is downscaled to fit the image budget, and a downscaled page loses exactly what this check is for: one-pixel lines, dotted field underlines, small radii, focus rings, a marker sitting on or off its rule. Never judge those from the full screenshot.

1. Take one screenshot and note its coordinate-frame width (the tool reports it).
2. Run `__vcRects(<that width>)`. It prints a zoom region for every visible island, card, expansion panel and tab container, already converted from CSS pixels into the screenshot's frame.
3. Zoom (for example `computer` → `zoom` with the printed region) on each island, each group or panel header, the tab strip, the page header, and the footer or button row of each island. Scroll and repeat for the parts below the fold; regions are printed for the visible part only.
4. Zoom the same region on the reference at the same scale and look at the two crops side by side. Name what differs in numbers where it is a number (measure it with `getBoundingClientRect` or the census, not by eye), and as a role or relationship where it is a colour.

A crop pair is also the format a finding is reported in: see *Pixel review format* in `review-checklists.md`.

## Measure overflow and clipping

A clipped overflow looks fine in a screenshot. Measure it.

1. On the reference run `__vcOverflow('reference')`; on the page under review run `__vcOverflow('ours')`.
2. Native pages overflow in their own ways (a tab strip that clips vertically, a grid header whose caption is a few pixels wider than its cell), so for ours the helper lists **every ellipsis cut** and **other overflow kinds only where the reference has none** of that kind on that component type.
3. Each listed line names the component (`element-name`), the inner element, how much shows against how much exists, and the start of its text. Treat as findings: a field caption or value cut by an ellipsis where the native page shows it whole, a button label cut, a container that clips its children, a horizontal scrollbar inside an island or a field group. A data grid with more columns than its width scrolls horizontally by design — compare with the reference grid before reporting it.
4. Rerun after every width change, because overflow appears at a width, not on a page: with a right panel open, with the navigation panel expanded, and at a narrower window (resize the browser window, reload by in-app route, run again). Raise `MIN` (the second argument, in CSS pixels) only to silence sub-glyph noise, never to make a real cut disappear.

## Overlay the reference in difference mode

Laying one rendering on top of the other in *difference* blend turns identical pixels black and leaves only the differences lit. It finds what a score and a glance do not: tracking that makes a tab strip drift, a marker two pixels off its rule, an inner padding one step off, a radius that does not match.

Use it when the two components are comparable — the same template container on both pages (the page header, the side profile container, the tab strip), or the same component kind passed by name on each side. Content naturally differs between two records; judge the chrome — edges, corners, header rows, spacing between parts — not the text.

1. On the page under review, with the helpers installed, run `await __vcOverlay('<full URL of the reference page, same site>', '<element-name in ours>', '<element-name in the reference>')` (the third argument defaults to the second). The reference loads in a temporary same-origin frame laid over the page and shifted so the two components align.
2. Zoom on the component (its box is printed in CSS pixels; take the region from `__vcRects` or scale the box by the screenshot ratio). Black is identical; anything lit differs.
3. Name each lit difference, measure it on both pages, and report it as a crop pair.
4. Remove the frame with `__vcOverlayOff()` before doing anything else on the page.

If the helper answers `frame refused`, the site does not allow same-origin framing; fall back to crop pairs at the same scale and the census.

## Ask a blind critic

The builder cannot judge its own page: it knows what it meant. A fresh-context subagent sees only the result.

- Give it exactly two images: a crop (or full page) of ours and the same crop of the native reference, at the same scale, **labels stripped and order randomised**. Record which is which yourself; do not tell it.
- Ask one question: *which of the two looks like a native Creatio page, and what is the single biggest gap in the other one?* Binary verdict, one gap — not a score, not a list.
- Never give it the page body, the code, the census, or which image is ours: reading the implementation makes a critic judge intent instead of result.
- Run this seat on the strongest model available, and pass the model explicitly on the subagent call. A weak craft critic approves everything.
- If it picks the reference as native and names a gap, that gap is a finding: verify it on the page (critics hallucinate), then fix it or record why not. If it cannot tell them apart, record that as the result of this check.

## Run the design loop for a hero block

> Adapted from "The Design Loop: Free Guide", itself an adaptation of the Gauntlet Loop by Matt Shumer. The four phases, the three critics, the binary verdicts and the failure modes are the guide's; the binding to Creatio pages is this skill's.

The checklist asks *is this right?* The loop asks *is this better than a named reference?* It is expensive and runs on **one block that carries the page** — the side profile island, the page header and stage area, the key widget of a dashboard — and only when a named reference exists: a native Creatio page measured in the browser, or the design team's mock of the same product. Without a named reference, do not run it; the checklist and the checks above are what the page needs.

1. **Name the bar.** A specific page or frame that can be opened, not "modern" or "clean". A vague bar is the main reason the loop fails: the critic invents a comparison and approves round one.
2. **Preflight.** Confirm the bar opens, the page under review renders in the browser, and the components resolve with `get-component-info`. Report which critic goes blind if any of these is missing, and do not run a blind critic.
3. **Teardown.** Write 5–7 mechanisms of the bar to `bar.md`, each checkable by looking, read off the reference by measurement and not from memory of it. Write them as relationships and roles, never as values to copy — for example "the header carries at most one primary action; the rest are quiet utilities", "the profile island and the content area share one gutter", "an icon on a coloured ground is white". Show `bar.md` to the user before continuing.
4. **Loop.** Per round, a builder changes the block through `update-page`; then three critics, each in fresh context, judge the rendered result:

| Critic | Given | Never sees | Model |
|---|---|---|---|
| Brief | the rendered crop and the page's question in one sentence | the page body, the bar | a mid-tier model |
| System | the rendered crop, the census difference, the `get-component-info` output for the block's components, and this skill's rules | the bar, the question | a fast model is enough |
| Craft | the rendered crop and the reference crop, blind and unlabelled, plus `bar.md` | which one is ours | the strongest model available |

Critics are harsh and binary; all three must pass; any fail goes back to the builder with the single biggest gap. There is no fixed round count: the exit is winning, or the user stopping the run. Write each round's verdicts in the verdict-file shape (*Verdict file* in `review-checklists.md`) and keep `bar.md`, the round log and the verdicts in the task's working directory, never in this skill. Budget in critic calls, not minutes.

What breaks it: a vague bar; the builder judging its own work; a soft critic; a fixed round count; a `bar.md` written from memory of the reference. What it cannot see: two radii that nest badly, the wrong image or icon, anything outside the block — the author's eye catches those. **Run the checklist after the loop exits**, not instead of it.

## Review a whole app with a multi-seat board

The loop judges one block repeatedly; a board judges a finished set of pages once, across dimensions, before handover. Run it after an app's pages are built: spawn the seats as parallel fresh-context subagents in one message, each with the page list (schema names and rendered screenshots), each page's question and user, and its own charter.

1. **Domain** — every number, deadline, status and workflow is plausible for the business.
2. **Data consistency** — the same figure shown twice matches; totals reconcile to their parts; dates and statuses agree with each other.
3. **Writing and localization** — every label is the application's own word, one term per concept across pages, formats fit the market (see *Copy and content* in `review-checklists.md`).
4. **UX** — each page answers its question; every control the copy promises is visible; no two actions share an icon; the largest block carries the page's main point.
5. **Freedom UI** — only native components, resolved with `get-component-info`; the census difference, the overflow check and the zoomed crops above, run and not eyeballed.
6. **Cross-page consistency** — the same function carries the same icon, label and position everywhere (WCAG SC 3.2.4); shared layout conventions hold across pages.

Merge the seats' findings into one verdict file. When seats disagree: domain correctness, then data consistency, then UX clarity, then writing, then visual polish — a page that is true beats a polished one that is wrong. Verify every finding on the page before acting on it, record dismissals with their reason, and after fixing rerun the measurable checks and report the count that passed, not "looks fine".

## What these checks cannot see

Say so in the report; the eye still matters.

- **Whether the page is the right page.** Composition, balance, the order a user fills it in, the fit of the template — that is the checklist in `review-checklists.md` and the rules in `SKILL.md`.
- **Relationships between parts.** Two radii nesting badly, two greys that are each native but wrong together, a colour role reused for an unrelated meaning.
- **Choice of content.** The wrong icon or image, a label that is accurate but unclear, data that is technically valid but implausible.
- **States not on screen.** Hover, focus, pressed, disabled, read-only for a user without edit rights, empty, error, loading — unless you put the page into that state and run the checks again.
- **Other contexts.** Other themes, other languages (longer captions overflow where English fits), other window widths and panel states not measured.
- **Components outside the census.** Elements without an `element-name`, and inner styling unless the census ran with inner elements.
- **Comparison without a reference.** The census and the overlay compare; on a page kind with no shipped reference they have nothing to compare against.

Look at the whole page at full resolution at least once, the way a user meets it, after the measurements.

## Report what was checked

A visual check reports its method, not a feeling. Include:

- **The reference**: schema name, template, and how it was opened; or that no reference existed and why.
- **Each instrument, ran or not**: style census (with or without inner elements), zoomed crops (which regions), overflow (at which widths and panel states), difference overlay (which components), blind critic (verdict and the gap it named), design loop or board if run. An instrument not run is listed with the reason.
- **Findings** as numbered issues in the format of *Pixel review format* in `review-checklists.md`: a "Now — build" / "Should be — native" crop pair, the measured numbers in the labels, the `element-name` and page-body node to change, and a `Done when:` line.
- **What was not verified**, from the list above — for example "census and overflow at the default width with panels closed; not checked with the right panel open or in another language".

"Looks native" with no method behind it is not a result.
