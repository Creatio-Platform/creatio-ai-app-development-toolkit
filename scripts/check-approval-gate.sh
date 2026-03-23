#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/check-approval-gate.sh <AppName>" >&2
  exit 1
fi
workflow_root="${WORKFLOW_ROOT_DIR:-.}"
app_name="$1"
"${script_dir}/check-planning-gate.sh" "$app_name" >/dev/null
requirements_file="${workflow_root}/output/${app_name}/requirements.md"
request_spec_file="${workflow_root}/output/${app_name}/request-spec.json"
state_file="${workflow_root}/output/${app_name}/workflow-state.json"
if [ ! -f "$requirements_file" ]; then
  echo "Gate failed: requirements.md not found: $requirements_file" >&2
  exit 1
fi
if [ ! -f "$request_spec_file" ]; then
  echo "Gate failed: request-spec.json not found: $request_spec_file" >&2
  exit 1
fi
if [ ! -f "$state_file" ]; then
  echo "Gate failed: workflow-state.json not found: $state_file" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "Gate failed: jq is required" >&2
  exit 1
fi
"${script_dir}/validate-requirements-doc.sh" "$requirements_file" >/dev/null
"${script_dir}/validate-request-spec.sh" "$request_spec_file" >/dev/null
if command -v shasum >/dev/null 2>&1; then
  requirements_sha256="$(shasum -a 256 "$requirements_file" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  requirements_sha256="$(sha256sum "$requirements_file" | awk '{print $1}')"
else
  echo "Gate failed: sha256 tool not found (shasum or sha256sum required)" >&2
  exit 1
fi
requirements_approved="$(jq -r '.requirementsApproved // empty' "$state_file")"
approval_token="$(jq -r '.approvalToken // empty' "$state_file")"
state_app_name="$(jq -r '.appName // empty' "$state_file")"
state_requirements_sha256="$(jq -r '.requirementsSha256 // empty' "$state_file")"
approved_by="$(jq -r '.approvedBy // empty' "$state_file")"
approved_at_utc="$(jq -r '.approvedAtUtc // empty' "$state_file")"
approval_source="$(jq -r '.approvalSource // empty' "$state_file")"
approval_text="$(jq -r '.approvalText // empty' "$state_file")"
interaction_mode="$(jq -r '.interactionMode // empty' "$state_file")"
business_checklist_complete="$(jq -r '.businessChecklistComplete // empty' "$state_file")"
if [ "$requirements_approved" != "true" ]; then
  echo "Gate failed: requirementsApproved must be true" >&2
  exit 1
fi
if [ "$approval_token" != "APPROVE_REQUIREMENTS" ]; then
  echo "Gate failed: approvalToken must be APPROVE_REQUIREMENTS" >&2
  exit 1
fi
if [ "$state_app_name" != "$app_name" ]; then
  echo "Gate failed: appName mismatch (expected $app_name, got $state_app_name)" >&2
  exit 1
fi
if [ "$state_requirements_sha256" != "$requirements_sha256" ]; then
  echo "Gate failed: requirementsSha256 mismatch" >&2
  exit 1
fi
if [ -z "$approved_by" ]; then
  echo "Gate failed: approvedBy is empty" >&2
  exit 1
fi
if [ -z "$approved_at_utc" ]; then
  echo "Gate failed: approvedAtUtc is empty" >&2
  exit 1
fi
if [ "$approval_source" != "natural-language" ]; then
  echo "Gate failed: approvalSource must be natural-language" >&2
  exit 1
fi
if [ -z "$approval_text" ]; then
  echo "Gate failed: approvalText is empty" >&2
  exit 1
fi
if [ "$interaction_mode" != "nl-business-first" ]; then
  echo "Gate failed: interactionMode must be nl-business-first" >&2
  exit 1
fi
if [ "$business_checklist_complete" != "true" ]; then
  echo "Gate failed: businessChecklistComplete must be true" >&2
  exit 1
fi
echo "GATE_OK ${app_name}"
