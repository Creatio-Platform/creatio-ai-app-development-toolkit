#!/usr/bin/env bash
set -euo pipefail
# Unified workflow gate management.
# Combines write + check into atomic operations.
#
# Usage:
#   scripts/workflow_gate.sh plan-approve <AppName> <url> <login> <password> "<understanding>" "<confirmation>"
#   scripts/workflow_gate.sh plan-check <AppName>
#   scripts/workflow_gate.sh requirements-approve <AppName> "<approver>" "<text>"
#   scripts/workflow_gate.sh requirements-check <AppName>

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workflow_root="${WORKFLOW_ROOT_DIR:-.}"
state_root="${WORKFLOW_STATE_DIR:-${workflow_root}/.workflow-state}"

cmd="${1:-}"
shift || true

case "$cmd" in
  plan-approve)
    "$script_dir/write-planning-state.sh" "$@" >/dev/null
    "$script_dir/check-planning-gate.sh" "$1"
    ;;
  plan-check)
    "$script_dir/check-planning-gate.sh" "$@"
    ;;
  requirements-approve)
    "$script_dir/write-approval-state.sh" "$@" >/dev/null
    "$script_dir/check-approval-gate.sh" "$1"
    ;;
  requirements-check)
    "$script_dir/check-approval-gate.sh" "$@"
    ;;
  *)
    echo "Usage: workflow_gate.sh <command> [args...]" >&2
    echo "Commands:" >&2
    echo "  plan-approve        <AppName> <url> <login> <password> <understanding> <confirmation>" >&2
    echo "  plan-check          <AppName>" >&2
    echo "  requirements-approve <AppName> <approver> <text>" >&2
    echo "  requirements-check  <AppName>" >&2
    exit 1
    ;;
esac
