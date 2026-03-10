#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 5 ]; then
  echo "Usage: scripts/write-planning-state.sh <AppName> <approvedBy> <creatioUrl> <understandingText> <confirmationText>" >&2
  exit 1
fi
workflow_root="${WORKFLOW_ROOT_DIR:-.}"
state_root="${WORKFLOW_STATE_DIR:-${workflow_root}/.workflow-state}"
app_name="$1"
approved_by="$2"
creatio_url="$3"
understanding_text="$4"
confirmation_text="$5"
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
if ! printf '%s' "$creatio_url" | grep -Eq '^https?://'; then
  echo "creatioUrl must be a valid http(s) URL" >&2
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
approved_at_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
mkdir -p "$planning_dir"
jq -n \
  --arg appName "$app_name" \
  --arg approvedBy "$approved_by" \
  --arg approvedAtUtc "$approved_at_utc" \
  --arg creatioUrl "$creatio_url" \
  --arg understandingText "$understanding_text" \
  --arg confirmationText "$confirmation_text" \
  '{
    planningApproved: true,
    appName: $appName,
    approvedBy: $approvedBy,
    approvedAtUtc: $approvedAtUtc,
    approvalSource: "natural-language",
    understandingText: $understandingText,
    confirmationText: $confirmationText,
    technicalInputs: {
      creatioUrl: $creatioUrl
    }
  }' > "$planning_file"
echo "$planning_file"
