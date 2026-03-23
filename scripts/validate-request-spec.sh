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
require_expr '.technicalInputs | objects' 'technicalInputs must be an object'
sections=(
  businessOutcome
  coreProblem
  actorsAndRoles
  domainModel
  lifecycleAndStatuses
  businessLogic
  uxExpectations
  edgeCases
  acceptanceCriteria
  analytics
  accessRestrictions
)
for section in "${sections[@]}"; do
  require_expr ".businessChecklist.${section}.complete == true" "businessChecklist.${section}.complete must be true"
  require_expr ".businessChecklist.${section}.value | strings | length > 0" "businessChecklist.${section}.value must be a non-empty string"
  require_expr ".businessChecklist.${section}.source as \$source | [\"confirmed\", \"assumed\"] | index(\$source) != null" "businessChecklist.${section}.source must be confirmed or assumed"
  require_expr "if .businessChecklist.${section}.source == \"assumed\" then (.businessChecklist.${section}.assumption | strings | length > 0) else true end" "businessChecklist.${section}.assumption must be a non-empty string when source is assumed"
  require_expr "if .businessChecklist.${section}.source == \"assumed\" then (.businessChecklist.${section}.assumption as \$assumption | .assumptions | index(\$assumption) != null) else true end" "businessChecklist.${section}.assumption must be listed in assumptions when source is assumed"
done
require_expr '(.technicalInputs.environmentMode // (if (.technicalInputs.creatioUrl? | strings | test("^https?://")) then "site-ready-now" else "planning-first" end)) as $mode | ["site-ready-now", "planning-first"] | index($mode) != null' 'technicalInputs.environmentMode must be site-ready-now or planning-first when provided'
require_expr '.technicalInputs.credentialsStatus as $status | ["provided", "missing", "existing_env", "deferred"] | index($status) != null' 'technicalInputs.credentialsStatus must be one of: provided, missing, existing_env, deferred'
require_expr '(.technicalInputs.environmentMode // (if (.technicalInputs.creatioUrl? | strings | test("^https?://")) then "site-ready-now" else "planning-first" end)) as $mode | if $mode == "site-ready-now" then (.technicalInputs.creatioUrl | strings | test("^https?://")) else ((.technicalInputs.creatioUrl == null) or (.technicalInputs.creatioUrl == "") or (.technicalInputs.creatioUrl | strings | test("^https?://"))) end' 'technicalInputs.creatioUrl must be a valid http(s) URL when environmentMode=site-ready-now; planning-first may defer it'
require_expr '.assumptions | arrays' 'assumptions must be an array'
require_expr 'all(.assumptions[]?; type == "string" and length > 0)' 'assumptions must contain only non-empty strings'
echo "REQUEST_SPEC_OK ${request_spec_file}"
