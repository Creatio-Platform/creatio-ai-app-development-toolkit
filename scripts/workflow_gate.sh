#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/find_python.sh"
if [ "$#" -lt 1 ]; then
  echo "Usage: workflow_gate.sh <command> [args...]" >&2
  echo "Commands:" >&2
  echo "  plan-approve        <AppName> <planner> <routingMode> <credentialsStatus> <understanding> <confirmation>" >&2
  echo "  plan-check          <AppName>" >&2
  echo "  requirements-approve <AppName> <approver> <text>" >&2
  echo "  requirements-check  <AppName>" >&2
  echo "  implementation-check <AppName>" >&2
  exit 1
fi
cmd="$1"
shift || true
case "$cmd" in
  plan-approve)
    "$PYTHON_CMD" "${script_dir}/workflow_cli.py" write-planning-state "$@" >/dev/null
    exec "$PYTHON_CMD" "${script_dir}/workflow_cli.py" check-planning-gate "$1"
    ;;
  plan-check)
    exec "$PYTHON_CMD" "${script_dir}/workflow_cli.py" check-planning-gate "$@"
    ;;
  requirements-approve)
    "$PYTHON_CMD" "${script_dir}/workflow_cli.py" write-approval-state "$@" >/dev/null
    exec "$PYTHON_CMD" "${script_dir}/workflow_cli.py" check-approval-gate "$1"
    ;;
  requirements-check)
    exec "$PYTHON_CMD" "${script_dir}/workflow_cli.py" check-approval-gate "$@"
    ;;
  implementation-check)
    exec "$PYTHON_CMD" "${script_dir}/workflow_cli.py" check-implementation-plan-gate "$@"
    ;;
  *)
    echo "Usage: workflow_gate.sh <command> [args...]" >&2
    echo "Commands:" >&2
    echo "  plan-approve        <AppName> <planner> <routingMode> <credentialsStatus> <understanding> <confirmation>" >&2
    echo "  plan-check          <AppName>" >&2
    echo "  requirements-approve <AppName> <approver> <text>" >&2
    echo "  requirements-check  <AppName>" >&2
    echo "  implementation-check <AppName>" >&2
    exit 1
    ;;
esac
