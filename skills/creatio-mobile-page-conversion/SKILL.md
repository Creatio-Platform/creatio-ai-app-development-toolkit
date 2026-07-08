---
name: creatio-mobile-page-conversion
description: Convert a Creatio Freedom UI WEB page into a Freedom UI MOBILE page for the Creatio Mobile app. Apply proactively — even if not explicitly selected and even if the user does not say "convert" — whenever the user wants an existing web page made available on mobile: convert/port a web page to mobile, build a mobile list or form page from an existing web page, or register a converted page as a mobile section/workplace. This skill drives the GATED conversion flow (get-mobile-page-conversion-guide → plain-language plan → Gate M approval → build the mobile body → Gate S section registration) so that nothing is written to Creatio until the developer approves. Keywords: convert to mobile, web to mobile, page to mobile, mobile page, mobile list page, mobile form page, Freedom UI mobile, MobileFormPage, MobileListPage, register mobile section, mobile workplace, get-mobile-page-conversion-guide, Leads_ListPage to mobile.
---

# Creatio mobile page conversion

Use this skill whenever the user wants an existing **Freedom UI WEB page** made available in the
**Creatio Mobile app** — converting/porting a web page to a mobile **list** or **form** page, and
optionally registering it as a mobile section. This is a **targeted, implementation-ready change**: it
does **not** require the full BA-style Business Plan / Gate R / `creatio-app-orchestrator` app-generation
flow.

## File resolution (read first)

The conversion playbook lives next to this file at `./references/page-to-mobile-conversion.md`. Other
toolkit files referenced here live under the **toolkit root** — the directory that contains `AGENTS.md`,
the parent of the `skills/` folder this file lives in (`../../` from this file). Resolve every path below
accordingly.

If you cannot read `./references/page-to-mobile-conversion.md`, **STOP**: tell the user the CAADT
toolkit files are not accessible from this session, and do not run the conversion from memory.

## Load order

1. Read `./references/page-to-mobile-conversion.md` — the **AUTHORITATIVE playbook**. It defines the
   full flow, the approval gates (Gate M, Gate S), the exact tool sequence, and the conversion report.
   Follow it exactly.
2. Read clio `get-guidance` with name `freedom-page-web-to-mobile-conversion` — the advisory engine
   guidance (component classification, the paste-verbatim data-section rules, the hard mobile rules).
3. Read `../../context/essentials.md` ("Freedom UI — Mobile Pages") for mobile platform basics
   (separate web/mobile pages, body format, component-registry differences).
4. Resolve every clio MCP tool contract through `get-tool-contract`; do not hardcode payloads.

## Gates are MANDATORY — this is the point of this skill

Conversion is **analysis-first**. The guide tool writes nothing; persistence and registration each
require explicit developer approval **after** you present a plain-language plan. Do not let an imperative
request collapse this into a single unattended pass.

- **Gate M (before ANY write).** After running `get-mobile-page-conversion-guide`, present the
  plain-language conversion plan (what transfers, what is adapted, what is unsupported, what needs a
  decision, the section-registration intent) and **STOP**. Do NOT call `create-page`, `update-page`,
  `validate-page`, or `create-page-business-rule` until the developer **explicitly approves** the plan in
  a separate response.
- **Gate S (before ANY section/workplace registration).** Do NOT call `odata-update` / `odata-create`
  (`SysModule` / `SysModuleInWorkplace` / `SysWorkplace`) or `register-related-page` until the developer
  **separately approves** the registration plan. Registering as a section is always the user's decision.
- **The initial request is NOT approval.** A prompt like *"convert Leads_ListPage to a mobile list page,
  then register it as the Leads section, then tell me what was set up"* states the **request** — it
  pre-authorizes nothing. Present the plan, then wait for an explicit go-ahead.
- **Headless / autonomous mode: never self-approve.** If you cannot get an interactive answer, produce
  the plan, ask for confirmation, and **END THE TURN** without writing or registering anything.

The detailed Gate M / Gate S rules, the conversion-plan contents, and the conversion-report format all
live in `./references/page-to-mobile-conversion.md` — follow it.
