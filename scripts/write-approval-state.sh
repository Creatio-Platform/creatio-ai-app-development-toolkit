#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo "Usage: scripts/write-approval-state.sh <AppName> <approvedBy>" >&2
  exit 1
fi
app_name="$1"
approved_by="$2"
requirements_file="output/${app_name}/requirements.md"
state_file="output/${app_name}/workflow-state.json"
if [ ! -f "$requirements_file" ]; then
  echo "requirements.md not found: $requirements_file" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi
if command -v shasum >/dev/null 2>&1; then
  requirements_sha256="$(shasum -a 256 "$requirements_file" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  requirements_sha256="$(sha256sum "$requirements_file" | awk '{print $1}')"
else
  echo "sha256 tool not found (shasum or sha256sum required)" >&2
  exit 1
fi
approved_at_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
mkdir -p "output/${app_name}"
jq -n \
  --arg appName "$app_name" \
  --arg requirementsSha256 "$requirements_sha256" \
  --arg approvedBy "$approved_by" \
  --arg approvedAtUtc "$approved_at_utc" \
  '{
    requirementsApproved: true,
    approvalToken: "APPROVE_REQUIREMENTS",
    appName: $appName,
    requirementsSha256: $requirementsSha256,
    approvedBy: $approvedBy,
    approvedAtUtc: $approvedAtUtc,
    interactionMode: "nl-business-first",
    businessChecklistComplete: true
  }' > "$state_file"
echo "$state_file"
