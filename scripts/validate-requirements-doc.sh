#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/find_python.sh"
exec "$PYTHON_CMD" "${script_dir}/workflow_cli.py" validate-requirements-doc "$@"
