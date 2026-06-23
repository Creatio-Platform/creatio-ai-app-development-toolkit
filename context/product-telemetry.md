# Product Telemetry Contract

When the `send-telemetry` clio MCP tool is available, emit product telemetry for CAADT workflow milestones. Telemetry is diagnostic product metadata only. Use only the fields listed in the Telemetry payload section. Telemetry must never include sensitive data: no full prompts, passwords, tokens, customer names, raw usernames, full generated app content, or full MCP request/response payloads.

clio's `get-tool-contract` for `send-telemetry` is the authoritative schema for the allowed event names and payload fields. The lists in this file are a convenience mirror kept in sync with that contract; if they ever disagree, the clio contract wins.

## Consent

At CAADT workflow start, call clio MCP `get-telemetry-consent` before sending any product telemetry event. This is the read-only consent check; it never writes. Ask the developer for permission to collect diagnostic product telemetry only when it returns `telemetry_consent=unknown`. The consent prompt must be a single-purpose interaction before requirements gathering, Business Plan discovery, or implementation planning. Do not combine the consent question with discovery questions.

Because enabling telemetry uploads these events to Creatio servers (not only local storage) and retains them for up to one year, the consent prompt must disclose this remote upload and the one-year retention so the decision is informed; it must also state that the data is diagnostic product metadata only — it includes a random, pseudonymous installation identifier (used only to group an installation's events for adoption analysis) but never prompts, generated content, credentials, or directly identifying personal data such as names, emails, or raw usernames — and that declining keeps telemetry off — nothing is collected or sent — and that consent can be withdrawn at any time (as easily as it was granted). Declining or later withdrawing never blocks the workflow.

### Consent state → what to do

`get-telemetry-consent` returns one of three states. **Persisting the decision** (a `send-telemetry` call that carries `telemetry_consent`) is a different action from **emitting the `session_started` event** (a product event clio stores and counts). On a first-run grant they happen to be the same call; on a first-run denial that same call persists the decision but stores no event. Persisting the first-run decision is required either way — skipping it leaves consent `unknown` and re-prompts the developer on every future run.

| Consent state at workflow start | Ask the developer? | Persist the decision | `session_started` event |
| --- | --- | --- | --- |
| `unknown`, developer **grants** | Yes — single-purpose prompt | Call `send-telemetry` once with `event_name=session_started` **and** `telemetry_consent=granted` | This same call **is** the `session_started` emission — do not send a second `session_started` for the "first user input" mapping |
| `unknown`, developer **denies** | Yes — single-purpose prompt | Call `send-telemetry` once with `event_name=session_started` **and** `telemetry_consent=denied`; clio records the decision only and stores **no** event (status `consent-denied`) | None — no `session_started` event is stored, now or later in this run |
| `granted` (from a prior run) | No | Nothing to persist (already stored) | Emit `session_started` once at workflow start, **without** `telemetry_consent` |
| `denied` (denied earlier or withdrawn) | No | Nothing to persist (already stored) | None — do not emit any telemetry this run |

Emit `session_started` exactly once per workflow. Treat telemetry as recorded only when the MCP result reports success; if the host displays an invocation exception, do not claim telemetry was recorded. If telemetry is denied or unavailable, continue the CAADT workflow without blocking the user.

## Consent withdrawal

The developer can withdraw telemetry consent at any time. When the developer asks to stop, turn off, opt out of, or withdraw telemetry (in any phrasing), call clio MCP `withdraw-telemetry-consent`. It sets the stored decision to `denied`, stops further collection and any new uploads, and deletes any not-yet-uploaded local events (clio reports how many were purged); an upload already in progress at the moment of withdrawal may still finish. Treat the withdrawal as effective only when the MCP result reports success; then confirm to the developer that telemetry is off and stop sending events for the rest of the workflow. A withdrawn decision reads back as `telemetry_consent=denied`, so consent is not requested again. Withdrawal is forward-looking: it does not delete events already uploaded to Creatio, which expire on the one-year retention timer. If `withdraw-telemetry-consent` is unavailable or reports failure, tell the developer telemetry could not be turned off, do not claim it was, and never block the workflow.

## Session identifier

Create one `session_id` for the CAADT workflow as a freshly generated random GUID and reuse it for every telemetry event in that conversation. Never derive `session_id` from user, account, file-path, host, or email data; it must be an opaque random identifier. Use the static Analytics Context from the installed skill or rule for `coding_agent` and `plugin_version`.

## Telemetry payload

Like every parameterized clio MCP tool, `send-telemetry` takes a single top-level `args` object — put all fields **inside** `args`, never at the top level (a flat, top-level payload is rejected with a missing-`args` error). The live `send-telemetry` tool schema is the source of truth for the exact shape; build the call from it rather than inferring a flat payload from the field list below.

Fields to send (inside `args`):

- `session_id`
- `event_name`
- `coding_agent`
- `plugin_version`
- `telemetry_consent` — only when persisting the first-run consent decision (see the consent table above)
- `duration_ms` — optional; clio infers each step's duration from local session timing, so send it only when you have a more accurate measurement for the step; omit it otherwise

Example (first-run grant):

```json
{ "args": { "session_id": "a7f3b2e1-9c4d-4e8a-b5f6-2d1c3e7a9b0f", "event_name": "session_started", "coding_agent": "Claude Code", "plugin_version": "1.1.0", "telemetry_consent": "granted" } }
```

clio also records an anonymized installation identifier and other diagnostic fields it derives locally, so the agent does not send them; the full set of locally derived, stored, and uploaded attributes is owned and documented by clio (see the clio telemetry ADR), not enumerated by this contract.

## Events — when to emit

Emit each event at the point described, reusing the same `session_id`. Events fire as the workflow reaches them; not every workflow reaches every event. `session_started` follows the consent table above.

| Event | When to emit |
| --- | --- |
| `session_started` | First user input in the CAADT workflow. Emitted once per workflow — see the consent table (on a first-run grant the consent-persisting send is this emission). |
| `pre_plan_clarification_requested` | The agent asks extra questions before Business Plan generation. |
| `pre_plan_user_input_received` | Each user input before Business Plan generation. |
| `business_plan_generated` | The full Business Plan has been generated and shown in the visible conversation body. Emit immediately after presenting the complete Business Plan, never before or during drafting. |
| `business_plan_generation_skipped` | Business Plan generation is intentionally skipped. |
| `business_plan_feedback_received` | Each user input or requested change before Business Plan approval. |
| `business_plan_regenerated` | An updated Business Plan has been regenerated and shown in the visible conversation body. Emit immediately after presenting the complete updated plan. |
| `business_plan_approved` | The developer approves the Business Plan. Emit after explicit plan approval, before runtime setup or implementation prep. |
| `implementation_started` | Implementation begins after Gate R approval and the required runtime context is available. Emit before the first implementation action. |
| `implementation_user_input_received` | Each user input after `implementation_started` and before a terminal `implementation_completed` or `implementation_failed` event. |
| `implementation_completed` | Implementation succeeds. |
| `implementation_changes_requested` | The developer requests extra changes after `implementation_completed`. Emit before starting the follow-up change work. |
| `implementation_changes_applied` | Requested post-completion changes are applied and verified. Emit after the follow-up change is complete. |
| `implementation_failed` | Implementation fails, is blocked, or cannot continue. |
