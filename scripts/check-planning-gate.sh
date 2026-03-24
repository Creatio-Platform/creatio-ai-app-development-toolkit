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
routing_mode="$(jq -r '.routingMode // empty' "$planning_file")"
environment_inputs_deferred="$(jq -r '.environmentInputsDeferred // empty' "$planning_file")"
understanding_text="$(jq -r '.understandingText // empty' "$planning_file")"
confirmation_text="$(jq -r '.confirmationText // empty' "$planning_file")"
creatio_url="$(jq -r '.technicalInputs.creatioUrl // empty' "$planning_file")"
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
if [ -z "$routing_mode" ]; then
  if printf '%s' "$creatio_url" | grep -Eq '^https?://'; then
    routing_mode="site-ready-now"
  else
    routing_mode="planning-first"
  fi
fi
case "$routing_mode" in
  site-ready-now|planning-first) ;;
  *)
    echo "Planning gate failed: routingMode must be site-ready-now or planning-first" >&2
    exit 1
    ;;
esac
if [ "$routing_mode" = "site-ready-now" ] && ! printf '%s' "$creatio_url" | grep -Eq '^https?://'; then
  echo "Planning gate failed: technicalInputs.creatioUrl must be a valid http(s) URL when routingMode=site-ready-now" >&2
  exit 1
fi
if [ -n "$creatio_url" ] && ! printf '%s' "$creatio_url" | grep -Eq '^https?://'; then
  echo "Planning gate failed: technicalInputs.creatioUrl must be a valid http(s) URL when provided" >&2
  exit 1
fi
if [ "$routing_mode" = "planning-first" ] && [ -n "$environment_inputs_deferred" ] && [ "$environment_inputs_deferred" != "true" ]; then
  echo "Planning gate failed: environmentInputsDeferred must be true when routingMode=planning-first" >&2
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
echo "PLANNING_GATE_OK ${app_name}"
