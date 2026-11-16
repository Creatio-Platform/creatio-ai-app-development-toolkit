---
name: creatio-mobile-business-logic
description: 'Write, build and deploy custom business logic for the Creatio Mobile app as a TypeScript remote module on @creatio/mobile-common: request handlers that extend built-in page behaviour, custom requests triggered from page buttons, virtual data sources, and SDK services (dialogs, geolocation, barcode, NFC, system settings, data model). Apply proactively - even if not explicitly selected - whenever a mobile Freedom UI page needs behaviour that business rules and built-in converters cannot express, or when a web page handler, a dropped button action or a handler-computed attribute has to work on mobile. This skill drives the GATED flow (inspect the mobile page, plain-language logic plan, Gate L approval, project and build, Gate D approval, deploy to a package through clio, device check) so nothing is generated or written to Creatio without approval. Keywords: mobile business logic, mobile handler, remote module, mobile SDK, mobile-common, CrtRequestHandler, custom request, virtual data source, validation on save in mobile, button action in mobile.'
---

# Creatio mobile business logic

Use this skill whenever a **Freedom UI MOBILE page** needs behaviour that lives in code: reacting to a
save, a data load or an attribute change, running an action from a button, or feeding a page from data
that no entity holds. In the Creatio Mobile app that code is a **remote module** — a TypeScript project
built on the `@creatio/mobile-common` SDK into one script that a Creatio package carries to the device.

This is a **targeted, implementation-ready change**: it does **not** require the full BA-style Business
Plan / Gate R / `creatio-app-orchestrator` app-generation flow.

## File resolution (read first)

The playbook lives next to this file at `./references/remote-module-playbook.md`, together with
`./references/project-layout.md`, `./references/sdk-guide.md` and
`./references/local-behaviour-check.md`. Other toolkit files referenced here
live under the **toolkit root** — the directory that contains `AGENTS.md`, the parent of the `skills/`
folder this file lives in (`../../` from this file). Resolve every path below accordingly.

If you cannot read `./references/remote-module-playbook.md`, **STOP**: tell the user the CAADT toolkit
files are not accessible from this session, and do not write a remote module from memory.

## What this skill can and cannot deliver

A remote module registers **request handlers** and **virtual data sources**, and calls the SDK services.
That covers extending a built-in request, a custom request behind a button, computed attributes, lookup
and detail filters, navigation, dialogs, device services and data access through the model API.

The SDK has no API for a custom validator, a custom converter, a UI component or an authenticated HTTP
call. When the request needs one of those, do not invent it: offer the route the playbook's "Choosing
the mechanism" section gives — a business rule, a built-in converter, a save handler that blocks with a
dialog, or a business process started from the handler — and say plainly what stays out of reach.

## Preflight (check first)

Run every check before the Load order. Each failed check is a **STOP** with its own message.

1. **clio tool surface.** Call **`get-tool-contract`** and confirm the index lists `get-page`,
   `update-page`, `validate-page`, `get-request-info`, `create-workspace`, `add-package`,
   `push-workspace`, `list-package-files` and `get-package-file`. Use `get-tool-contract`, NOT the
   server's `tools/list`: the workspace and package-file tools are long-tail tools, reachable through
   `clio-run` and absent from `tools/list` even when they work. If any is missing, tell the user
   verbatim:

   > Your clio does not ship the tools this flow needs to deliver a mobile remote module. Update it with:
   > `dotnet tool update clio -g`
   > then re-run this request.

2. **Local toolchain.** Run `node --version` and `npm --version`. The build needs Node.js 20 or newer
   with npm. If either is missing or older, tell the user verbatim:

   > Building a mobile remote module needs Node.js 20 or newer with npm on this machine. Install it from
   > https://nodejs.org, then re-run this request.

   Never install or upgrade Node.js yourself.

3. **Environment.** Call `list-environments` and confirm the target environment is registered. Then
   call `list-package-files` for any package that exists on it: the workspace and package-file tools
   need cliogate, and this call is the probe. When it answers that cliogate is missing or too old, ask
   the developer to run `clio install-gate -e <environment>` and retry — do not run it unasked.

## Load order

0. Read clio `get-guidance` with name `core-rules` and name `routing`, as the clio server requires
   before any operation. `routing` has no entry for this flow; this skill is the route.
1. Read `./references/remote-module-playbook.md` — the **AUTHORITATIVE playbook**. It defines the flow,
   the approval gates (Gate L, Gate D), the tool sequence, the plan and report formats and the device
   check. Follow it exactly.
2. Read `./references/sdk-guide.md` before writing any module code, `./references/project-layout.md`
   before creating the project, and `./references/local-behaviour-check.md` before verifying the build. The installed SDK type declarations are the source of truth for the API;
   the guide says where they are and how to read them, and it wins only on the runtime rules the
   declarations cannot express.
3. Read `../../context/essentials.md` ("Freedom UI — Mobile Pages") for mobile platform basics.
4. **Before editing a mobile page body** (wiring a button to a request, adding a data source): call clio
   `get-guidance` with name `mobile-page-modification`, then **invoke the `creatio-ui-guidelines`
   skill** and apply its mobile-relevant rules to anything visible you add. A module that only shows
   its own dialogs changes no page body and does not trigger this step; the playbook's text rule
   covers what such a dialog says.
5. Call clio `get-guidance` with name `list`. When the catalog carries `mobile-remote-module`, read it:
   it owns the Creatio-side mechanics (package placement, page wiring) and wins over the playbook on
   those. When it is absent, the playbook's own mechanics apply — that is not a blocker.
6. Resolve every clio MCP tool contract through `get-tool-contract`; do not hardcode payloads.

## Product telemetry — emit the shared stages with `workflow: "mobile-business-logic"`

Read `get-guidance name=product-telemetry` for the stage vocabulary and the consent flow, and
`../../context/product-telemetry.md` for this flow's emission points. Emit with clio MCP
`send-telemetry`. Event names are **flow-agnostic stages**; this flow is identified by the `workflow`
field, so do not invent per-flow event names — clio rejects them.

| Send | With | At the point where you |
| --- | --- | --- |
| `workflow_started` | — | take the first request for mobile logic |
| `clarification_requested` / `user_input_received` | — | ask the developer something the flow waits on / receive their answer |
| `plan_blocked` | `variant=toolchain-unavailable` | fail a Preflight check — emit before the STOP message |
| `plan_presented` | — | present the plain-language logic plan |
| `plan_changes_requested` | — | the developer asks to adjust the plan at **Gate L** |
| `plan_approved` | — | get approval at **Gate L** — before any file is generated |
| `build_started` | — | begin creating the project |
| `work_item_completed` | `variant=module` | confirm the built module on the environment after **Gate D** |
| `work_item_completed` | `variant=page` | finish and validate a page that triggers or consumes the module, once per page |
| `workflow_completed` / `workflow_failed` | — | reach the end of the run |
| `changes_requested` | — | the developer asks for further changes AFTER the run completed. Emit before starting that follow-up work |
| `changes_applied` | — | the follow-up changes are deployed and confirmed |

Telemetry is non-blocking and must never interfere with Gate L or Gate D. If clio rejects an event name
(older clio), stop emitting for the rest of the run and carry on.

- **Gate D emits nothing.** No stage marks the delivery plan or its approval.
- `workflow_completed` means the module is delivered and confirmed on the environment. The device check
  is the developer's and may happen after the run ends.
- When consent is unknown and there is no developer to ask, emit nothing.
- Send `coding_agent` and `plugin_version` only when the installation supplies them; never invent one.

## Gates are MANDATORY

Logic is **plan-first**: inspecting the page and the SDK writes nothing, and both generating code and
delivering it require explicit developer approval **after** you present a plain-language plan.

- **Gate L** — before creating the project or writing any module code. The developer approves *what the
  logic does*, on which pages, and what it cannot do.
- **Gate D** — before ANY write to the Creatio environment (`push-workspace`, `update-page`). The
  developer approves *where it goes*: the environment, the package and the pages that change.
- **The initial request is NOT approval**, and in headless / autonomous mode you present the plan, ask,
  and END THE TURN without writing — never self-approve.
- **A green build is not a working feature.** Nothing in clio runs the Mobile app, so the run ends with
  the device check the playbook lists, reported as *not yet confirmed* until the developer confirms it.

The AUTHORITATIVE gate rules — what each plan must contain and the FORBIDDEN-until-approved tool lists —
live in the "Gate L" / "Gate D" sections of `./references/remote-module-playbook.md`. That file is the
single source of truth for the process; make gate and process changes there.
