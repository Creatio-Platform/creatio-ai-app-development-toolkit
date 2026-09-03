---
name: creatio-mobile-page-conversion
description: 'Convert a Creatio Freedom UI WEB page, or a classic Mobile application wizard list page (legacy Mobile<Entity>GridPageSettings<Workplace> schema), into a Freedom UI MOBILE page for the Creatio Mobile app. Apply proactively — even if not explicitly selected and even if the user does not say "convert" — whenever the user wants a web page or a legacy mobile page made available on mobile: convert/port a page to mobile, build a mobile list or form page from an existing page, migrate a classic mobile section to Freedom UI mobile, or register a converted page as a mobile section/workplace. Drives the GATED flow (get-mobile-page-conversion-guide → plan → Gate M → build body → Gate S) so nothing is written until the developer approves. Keywords: convert to mobile, web to mobile, mobile page, mobile list page, mobile form page, Freedom UI mobile, MobileListPage, GridPageSettings, legacy mobile page, Mobile application wizard, register mobile section, mobile workplace.'
---

# Creatio mobile page conversion

Use this skill whenever the user wants an existing page made available in the **Creatio Mobile app** as a
Freedom UI mobile **list** or **form** page, optionally registered as a mobile section. Two source types
are supported, through ONE tool and ONE flow:

- a **Freedom UI WEB page** (`sourceType: freedom-web`) — converted/ported to a mobile list or form page;
- a **classic Mobile application wizard LIST page** — a legacy `Mobile<Entity>GridPageSettings<Workplace>`
  settings schema (`sourceType: legacy-mobile-grid-page`, ENG-95730) — converted to a mobile list page the
  Freedom UI Mobile designer can open.

Out of scope: a legacy wizard **RECORD** page (`Mobile<Entity>RecordPageSettings<Workplace>`, detected and
reported as not yet supported — ENG-95731) and a **Classic UI web** page (migrate it to a Freedom UI web
page first). This is a **targeted, implementation-ready change**: it does **not** require the full BA-style
Business Plan / Gate R / `creatio-app-orchestrator` app-generation flow.

## File resolution (read first)

The conversion playbook lives next to this file at `./references/page-to-mobile-conversion.md`. Other
toolkit files referenced here live under the **toolkit root** — the directory that contains `AGENTS.md`,
the parent of the `skills/` folder this file lives in (`../../` from this file). Resolve every path below
accordingly.

If you cannot read `./references/page-to-mobile-conversion.md`, **STOP**: tell the user the CAADT
toolkit files are not accessible from this session, and do not run the conversion from memory.

## Preflight: the converter is a GATED clio feature (check first)

The mobile page converter (web source AND legacy wizard source — one flag covers both, there is no second
flag for the legacy path) is an **experimental clio feature, off by default**. The converter-specific
surface — the `get-mobile-page-conversion-guide` tool and the `get-guidance` article
`freedom-page-web-to-mobile-conversion` — is gated behind the feature flag **`mobile-page-converter`**
and is **not registered** until that flag is enabled. (The general page tools `create-page` /
`update-page` / `validate-page` and `create-related-page-addon` (web `RelatedPage` + mobile
`MobileRelatedPage` via `schema-type=mobile`) are always available and are NOT gated — but on their own
they are not enough to run this flow correctly.)

Before the Load order below, verify the converter is available: list the server tools (or call
`get-tool-contract`) and check for `get-mobile-page-conversion-guide`.

- **If present** → also confirm the paired guidance article loads before proceeding: Load order step 2
  calls `get-guidance` with name `freedom-page-web-to-mobile-conversion`. If that call falls back to
  `availableGuides` (the article is absent or was renamed) instead of returning the real conversion
  guidance, **STOP** — but this is a DIFFERENT failure than the flag being off, so do NOT reuse the
  `--enable` message below (the flag is already enabled; re-running it cannot restore a missing article).
  Tell the user verbatim:

  > The `mobile-page-converter` feature is enabled, but its `freedom-page-web-to-mobile-conversion`
  > guidance article could not be loaded (missing or renamed in this clio version). Update or reinstall
  > clio to a version that ships this article, or check whether it was renamed (`get-guidance` with no
  > name lists `availableGuides`). Do NOT re-run `clio experimental --name mobile-page-converter --enable`
  > — the flag is already on and that will not restore the article.

  Do NOT proceed with the tool but no guidance, or you will build the body missing the paste-verbatim
  data-section and hard mobile rules with no warning. Otherwise proceed with the Load order and the flow.
- **If absent** → the feature is turned off. **STOP** and tell the user verbatim:

  > The Web→Mobile converter is not enabled in your clio. Enable it once with:
  > `clio experimental --name mobile-page-converter --enable`
  > then re-run this request. (Disable later with `--disable`; list all flags with `clio experimental`.)

  Do **not** run the conversion from memory or hand-roll the mobile body with the general page tools
  while the flag is off — without `get-mobile-page-conversion-guide` and the
  `freedom-page-web-to-mobile-conversion` guidance you lack the authoritative component mapping and
  paste-verbatim data sections. Do not try to work around the gate.

## Load order

1. Read `./references/page-to-mobile-conversion.md` — the **AUTHORITATIVE playbook**. It defines the
   full flow, the approval gates (Gate M, Gate S), the exact tool sequence, and the conversion report.
   Follow it exactly.
2. Read clio `get-guidance` with name `freedom-page-web-to-mobile-conversion` — the advisory ENGINE-layer
   guidance and the single source of truth for the body-building mechanics (component classification,
   per-operation `elementMap` rules, `mobileValues` paste, the paste-verbatim data-section rules, adaptive /
   tab-body / normalization behavior, the hard mobile rules). The playbook defers to it for all mechanics.
   **Legacy wizard source:** the article's web-specific mechanics (multi-entry `elementMap`, adaptive layout,
   tab layers, normalizations, business rules, requests) do NOT apply — the guide arrives with none of those
   fields; `resourceStrings` carries just the page title (`DefaultPageTitle`), registered the same way. For a legacy source the mechanics are the guide's own `constraints` + `nextSteps`
   (composed by the converter for THIS conversion), plus the article's shared sections: GATES, DATA SECTIONS
   (paste, don't rebuild), the list-row merge-by-name rule and HARD MOBILE RULES.
3. Read `../../context/essentials.md` ("Freedom UI — Mobile Pages") for mobile platform basics
   (separate web/mobile pages, body format, component-registry differences).
4. **Before authoring the mobile page body (Flow step 7):** (a) call clio `get-guidance` with name
   `mobile-page-modification` — the platform-mandated mobile page-authoring guidance (mobile component
   registry, body constraints, Scaffold inheritance rules). `../../context/essentials.md` requires this
   call before editing ANY mobile page body, and the mechanical `mobileValues` paste does not exempt it.
   Then (b) **invoke the `creatio-ui-guidelines` skill** and apply its mobile-relevant rules (component
   choice, lookups, fields, captions, tooltips, accessibility), and run its review checklist before
   treating the page as done. `create-page` / `update-page` on a mobile page are the same page-authoring
   tool calls the toolkit's Core Rules gate behind `creatio-ui-guidelines`. **For a legacy wizard source the
   UI review is report-only:** the body is a verbatim paste of what the guide returned, so a UI finding goes
   into the conversion report and the designer hand-off — never into the body.
5. Resolve every clio MCP tool contract through `get-tool-contract`; do not hardcode payloads.
6. **One-schema rule:** capture the `schemaUId` returned by `create-page` and pass it as
   `target-schema-uid` on every subsequent `update-page`. Otherwise, when the chosen package is not the
   app's design package, `update-page` writes a replacing schema in the design package and leaves the
   created mobile schema empty — the Mobile app then loads the empty schema and crashes. Details in the
   playbook's Flow step 7.
7. **Source body isolation (legacy wizard source):** never read the source settings schema — or any of its
   replacing layers — into the conversation: no `get-page`, `get-page-hierarchy`, `get-client-unit-schema`,
   `export-schema`, and no `odata-read` of `SysSchema.Body` on it. `get-mobile-page-conversion-guide` reads
   and merges the package layers internally and returns facts only (`guide.legacySource`); those facts are all
   the plan and report need. `get-page` is used only on the NEW mobile page (read-back, Flow step 7a).

## Gates are MANDATORY — this is the point of this skill

Conversion is **analysis-first**: the guide tool writes nothing, and persistence and registration each
require explicit developer approval **after** you present a plain-language plan. Do not let an imperative
request collapse this into a single unattended pass. The invariants:

- **Gate M** — before ANY write (`create-page` / `update-page` / `validate-page` /
  `create-page-business-rule`).
- **Gate S** — before ANY section/workplace registration (`odata-update` / `odata-create` /
  `create-related-page-addon` with `schema-type=mobile`).
- **The initial request is NOT approval**, and in headless / autonomous mode you present the plan, ask,
  and END THE TURN without writing — never self-approve.
- **Same gates for both source types.** A legacy wizard source goes through the identical FORBIDDEN lists.
  A guide that comes back with `success: false` (custom viewConfig refused, legacy RECORD page, unreadable
  source) ends the run in a **failed state with nothing written** — relay the tool's message; never work around it.

The AUTHORITATIVE, detailed gate rules — the two-choice (View details / Adjust vs Approve) flow, what the
plan must contain, and the exact FORBIDDEN-until-approved tool lists — live in the "Gate M" / "Gate S"
sections of `./references/page-to-mobile-conversion.md`. That file is the single source of truth for the
**PROCESS** layer (the flow, the gates, the plan/report format, environment resolution, section
registration): follow it, and make gate/process changes there. The body-building **MECHANICS** are a
separate layer whose single source of truth is the clio `freedom-page-web-to-mobile-conversion` guidance
article (Load order step 2) — make mechanic changes there, not in the playbook, and if the two ever
disagree the guidance article wins on mechanics.
