#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/check-planning-gate.sh <AppName>" >&2
  exit 1
fi
workflow_root="${WORKFLOW_ROOT_DIR:-.}"
state_root="${WORKFLOW_STATE_DIR:-${workflow_root}/.workflow-state}"
app_name="$1"
planning_file="${state_root}/${app_name}/planning-state.json"
if [ ! -f "$planning_file" ]; then
  echo "Planning gate failed: planning-state.json not found: $planning_file" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "Planning gate failed: jq is required" >&2
  exit 1
fi
planning_approved="$(jq -r '.planningApproved // empty' "$planning_file")"
state_app_name="$(jq -r '.appName // empty' "$planning_file")"
approved_by="$(jq -r '.approvedBy // empty' "$planning_file")"
approved_at_utc="$(jq -r '.approvedAtUtc // empty' "$planning_file")"
approval_source="$(jq -r '.approvalSource // empty' "$planning_file")"
understanding_text="$(jq -r '.understandingText // empty' "$planning_file")"
confirmation_text="$(jq -r '.confirmationText // empty' "$planning_file")"
creatio_url="$(jq -r '.technicalInputs.creatioUrl // empty' "$planning_file")"
creatio_login="$(jq -r '.technicalInputs.creatioLogin // empty' "$planning_file")"
creatio_password="$(jq -r '.technicalInputs.creatioPassword // empty' "$planning_file")"
if [ "$planning_approved" != "true" ]; then
  echo "Planning gate failed: planningApproved must be true" >&2
  exit 1
fi
if [ "$state_app_name" != "$app_name" ]; then
  echo "Planning gate failed: appName mismatch (expected $app_name, got $state_app_name)" >&2
  exit 1
fi
if [ -z "$approved_by" ]; then
  echo "Planning gate failed: approvedBy is empty" >&2
  exit 1
fi
if [ -z "$approved_at_utc" ]; then
  echo "Planning gate failed: approvedAtUtc is empty" >&2
  exit 1
fi
if [ "$approval_source" != "natural-language" ]; then
  echo "Planning gate failed: approvalSource must be natural-language" >&2
  exit 1
fi
if [ -z "$understanding_text" ]; then
  echo "Planning gate failed: understandingText is empty" >&2
  exit 1
fi
if [ -z "$confirmation_text" ]; then
  echo "Planning gate failed: confirmationText is empty" >&2
  exit 1
fi
if ! printf '%s' "$creatio_url" | grep -Eq '^https?://'; then
  echo "Planning gate failed: technicalInputs.creatioUrl must be a valid http(s) URL" >&2
  exit 1
fi
if [ -z "$creatio_login" ]; then
  echo "Planning gate failed: technicalInputs.creatioLogin is empty" >&2
  exit 1
fi
if [ -z "$creatio_password" ]; then
  echo "Planning gate failed: technicalInputs.creatioPassword is empty" >&2
  exit 1
fi
echo "PLANNING_GATE_OK ${app_name}"
