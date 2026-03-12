#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$#" -ne 3 ]; then
  echo "Usage: scripts/write-approval-state.sh <AppName> <approvedBy> <approvalText>" >&2
  exit 1
fi
workflow_root="${WORKFLOW_ROOT_DIR:-.}"
app_name="$1"
approved_by="$2"
approval_text="$3"
requirements_file="${workflow_root}/output/${app_name}/requirements.md"
request_spec_file="${workflow_root}/output/${app_name}/request-spec.json"
state_file="${workflow_root}/output/${app_name}/workflow-state.json"
if [ ! -f "$requirements_file" ]; then
  echo "requirements.md not found: $requirements_file" >&2
  exit 1
fi
if [ ! -f "$request_spec_file" ]; then
  echo "request-spec.json not found: $request_spec_file" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi
if [ -z "$approved_by" ]; then
  echo "approvedBy must be non-empty" >&2
  exit 1
fi
if [ -z "$approval_text" ]; then
  echo "approvalText must be non-empty" >&2
  exit 1
fi
"${script_dir}/check-planning-gate.sh" "$app_name" >/dev/null
"${script_dir}/validate-request-spec.sh" "$request_spec_file" >/dev/null
if command -v shasum >/dev/null 2>&1; then
  requirements_sha256="$(shasum -a 256 "$requirements_file" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  requirements_sha256="$(sha256sum "$requirements_file" | awk '{print $1}')"
else
  echo "sha256 tool not found (shasum or sha256sum required)" >&2
  exit 1
fi
approved_at_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
mkdir -p "${workflow_root}/output/${app_name}"
jq -n \
  --arg appName "$app_name" \
  --arg requirementsSha256 "$requirements_sha256" \
  --arg approvedBy "$approved_by" \
  --arg approvedAtUtc "$approved_at_utc" \
  --arg approvalText "$approval_text" \
  '{
    requirementsApproved: true,
    approvalToken: "APPROVE_REQUIREMENTS",
    appName: $appName,
    requirementsSha256: $requirementsSha256,
    approvedBy: $approvedBy,
    approvedAtUtc: $approvedAtUtc,
    approvalSource: "natural-language",
    approvalText: $approvalText,
    interactionMode: "nl-business-first",
    businessChecklistComplete: true,
    planningGateApproved: true
  }' > "$state_file"
echo "$state_file"
