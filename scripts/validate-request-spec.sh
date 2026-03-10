#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/validate-request-spec.sh <request-spec.json>" >&2
  exit 1
fi
request_spec_file="$1"
if [ ! -f "$request_spec_file" ]; then
  echo "Request spec failed: file not found: $request_spec_file" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "Request spec failed: jq is required" >&2
  exit 1
fi
require_expr() {
  local expr="$1"
  local message="$2"
  if ! jq -e "$expr" "$request_spec_file" >/dev/null 2>&1; then
    echo "Request spec failed: $message" >&2
    exit 1
  fi
}
require_expr '.sourcePrompt | strings | length > 0' 'sourcePrompt must be a non-empty string'
require_expr '.businessChecklist.complete == true' 'businessChecklist.complete must be true'
sections=(
  businessOutcome
  actorsAndRoles
  domainModel
  lifecycleAndStatuses
  businessRules
  uxExpectations
  edgeCases
  acceptanceCriteria
)
for section in "${sections[@]}"; do
  require_expr ".businessChecklist.${section}.complete == true" "businessChecklist.${section}.complete must be true"
  require_expr ".businessChecklist.${section}.value | strings | length > 0" "businessChecklist.${section}.value must be a non-empty string"
done
require_expr '.technicalInputs.creatioUrl | strings | test("^https?://")' 'technicalInputs.creatioUrl must be a valid http(s) URL'
require_expr '.technicalInputs.credentialsStatus as $status | ["provided", "missing", "existing_env"] | index($status) != null' 'technicalInputs.credentialsStatus must be one of: provided, missing, existing_env'
require_expr '.assumptions | arrays' 'assumptions must be an array'
require_expr 'all(.assumptions[]?; type == "string" and length > 0)' 'assumptions must contain only non-empty strings'
echo "REQUEST_SPEC_OK ${request_spec_file}"
