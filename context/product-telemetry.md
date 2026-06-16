# Product Telemetry Contract

When the `send-telemetry` clio MCP tool is available, emit product telemetry for CAADT workflow milestones. Telemetry is diagnostic product metadata only. Use only the fields listed in the Telemetry payload section. Telemetry must never include sensitive data: no full prompts, passwords, tokens, customer names, raw usernames, full generated app content, or full MCP request/response payloads.

At CAADT workflow start, call clio MCP `get-telemetry-consent` before sending any product telemetry event. This is the read-only consent check. Ask the developer for permission to collect diagnostic product telemetry only when it returns `telemetry_consent=unknown`. The consent prompt must be a single-purpose interaction before requirements gathering, Business Plan discovery, or implementation planning. Do not combine the consent question with discovery questions. Use clio MCP `send-telemetry` with `event_name=session_started` and `telemetry_consent` set to either `granted` or `denied` to persist the first-run consent decision; clio stores the decision locally. When the decision is `denied`, clio records the decision and writes no telemetry event. Emit the `session_started` event itself only when consent is already granted or when the developer grants first-run consent. Treat telemetry as recorded only when the MCP result reports success; if the host displays an invocation exception, do not claim telemetry was recorded. If telemetry is denied or unavailable, continue the CAADT workflow without blocking the user.

Create one `session_id` for the CAADT workflow as a freshly generated random GUID and reuse it for every telemetry event in that conversation. Never derive `session_id` from user, account, file-path, host, or email data; it must be an opaque random identifier. Use the static Analytics Context from the installed skill or rule for `coding_agent`, `skill_version`, and `plugin_version`.

Telemetry payload:

- `session_id`
- `event_name`
- `coding_agent`
- `skill_version`
- `plugin_version`
- `telemetry_consent`, only when persisting the first-run consent decision

clio also records an anonymized installation identifier and other diagnostic fields it derives locally, so the agent does not send them; clio's `get-tool-contract` is the authoritative stored-event schema.

Required event mapping:

- `session_started`: first user input in the CAADT workflow.
- `pre_plan_clarification_requested`: agent asks extra questions before Business Plan generation.
- `pre_plan_user_input_received`: each user input before Business Plan generation.
- `business_plan_generated`: full Business Plan has been generated and shown in the visible conversation body. Emit this event immediately after presenting the complete Business Plan, never before or during drafting.
- `business_plan_generation_skipped`: Business Plan generation is intentionally skipped.
- `business_plan_feedback_received`: each user input or requested change before Business Plan approval.
- `business_plan_regenerated`: updated Business Plan has been regenerated and shown in the visible conversation body. Emit this event immediately after presenting the complete updated Business Plan.
- `business_plan_approved`: developer approves the Business Plan.
- `implementation_started`: implementation begins after Gate R approval and required runtime context is available.
- `implementation_user_input_received`: each user input after `implementation_started` and before a terminal `implementation_completed` or `implementation_failed` event.
- `implementation_completed`: implementation succeeds.
- `implementation_changes_requested`: developer requests extra changes after `implementation_completed`. Emit this before starting the follow-up change work, using the same `session_id`.
- `implementation_changes_applied`: requested post-completion implementation changes are applied and verified. Emit this after the follow-up change is complete.
- `implementation_failed`: implementation fails, is blocked, or exits unsuccessfully.

Telemetry emission checkpoints:

- After consent is granted: emit `session_started` before discovery starts.
- After showing the complete Business Plan: emit `business_plan_generated`.
- After explicit plan approval: emit `business_plan_approved` before runtime setup or implementation prep.
- After runtime context is available and before first implementation action: emit `implementation_started`.
- After planned work is saved and verified: emit `implementation_completed`.
- When implementation cannot continue: emit `implementation_failed`.
- After completed implementation, before follow-up change work: emit `implementation_changes_requested`.
- After follow-up change work is saved and verified: emit `implementation_changes_applied`.
