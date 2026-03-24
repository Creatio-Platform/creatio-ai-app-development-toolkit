#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 5 ] && [ "$#" -ne 6 ]; then
  echo "Usage:" >&2
  echo "  scripts/write-planning-state.sh <AppName> <approvedBy> <creatioUrl> <understandingText> <confirmationText>" >&2
  echo "  scripts/write-planning-state.sh <AppName> <approvedBy> <routingMode> <creatioUrlOrDeferred> <understandingText> <confirmationText>" >&2
  exit 1
fi
workflow_root="${WORKFLOW_ROOT_DIR:-.}"
state_root="${WORKFLOW_STATE_DIR:-${workflow_root}/.workflow-state}"
app_name="$1"
approved_by="$2"
if [ "$#" -eq 6 ]; then
  routing_mode="$3"
  creatio_url="$4"
  understanding_text="$5"
  confirmation_text="$6"
else
  legacy_value="$3"
  understanding_text="$4"
  confirmation_text="$5"
  case "$legacy_value" in
    planning-first|deferred|-|"")
      routing_mode="planning-first"
      creatio_url=""
      ;;
    *)
      routing_mode="site-ready-now"
      creatio_url="$legacy_value"
      ;;
  esac
fi
planning_dir="${state_root}/${app_name}"
planning_file="${planning_dir}/planning-state.json"
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi
if [ -z "$approved_by" ]; then
  echo "approvedBy must be non-empty" >&2
  exit 1
fi
if [ -z "$understanding_text" ]; then
  echo "understandingText must be non-empty" >&2
  exit 1
fi
if [ -z "$confirmation_text" ]; then
  echo "confirmationText must be non-empty" >&2
  exit 1
fi
case "$routing_mode" in
  site-ready-now|planning-first) ;;
  *)
    echo "routingMode must be one of: site-ready-now, planning-first" >&2
    exit 1
    ;;
esac
case "$creatio_url" in
  planning-first|deferred|-)
    creatio_url=""
    ;;
esac
if [ "$routing_mode" = "site-ready-now" ] && ! printf '%s' "$creatio_url" | grep -Eq '^https?://'; then
  echo "creatioUrl must be a valid http(s) URL when routingMode=site-ready-now" >&2
  exit 1
fi
if [ -n "$creatio_url" ] && ! printf '%s' "$creatio_url" | grep -Eq '^https?://'; then
  echo "creatioUrl must be a valid http(s) URL when provided" >&2
  exit 1
fi
if [ "$routing_mode" = "planning-first" ]; then
  environment_inputs_deferred="true"
else
  environment_inputs_deferred="false"
fi
approved_at_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
mkdir -p "$planning_dir"
jq -n \
  --arg appName "$app_name" \
  --arg approvedBy "$approved_by" \
  --arg approvedAtUtc "$approved_at_utc" \
  --arg routingMode "$routing_mode" \
  --arg creatioUrl "$creatio_url" \
  --argjson environmentInputsDeferred "$environment_inputs_deferred" \
  --arg understandingText "$understanding_text" \
  --arg confirmationText "$confirmation_text" \
  '{
    planningApproved: true,
    appName: $appName,
    approvedBy: $approvedBy,
    approvedAtUtc: $approvedAtUtc,
    approvalSource: "natural-language",
    routingMode: $routingMode,
    environmentInputsDeferred: $environmentInputsDeferred,
    understandingText: $understandingText,
    confirmationText: $confirmationText,
    technicalInputs: {
      creatioUrl: $creatioUrl
    }
  }' > "$planning_file"
echo "$planning_file"
