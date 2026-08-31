#!/usr/bin/env bash
# ===========================================================================
# build-dev-toolchain.sh -- thin macOS/Linux launcher.
#   The actual cross-platform logic lives in build_dev_toolchain.py (shared by
#   this launcher and build-dev-toolchain.bat on Windows). This wrapper just
#   resolves a real Python 3 and hands off, forwarding all arguments.
#   Usage: ./build-dev-toolchain.sh [release | <branch-or-tag>]
#
#   Python is resolved by the repo's tested resolver runtime/scripts/find_python.sh,
#   which verifies `--version` reports Python 3.x (so an unversioned `python` that is
#   actually Python 2 is rejected instead of exec'd into a SyntaxError).
# ===========================================================================
# NB: -e is intentionally NOT set -- the sourced resolver returns non-zero on some
#     internal probes, and we want to handle "not found" ourselves.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER="$DIR/build_dev_toolchain.py"
RESOLVER="$DIR/../runtime/scripts/find_python.sh"

if [[ -f "$RESOLVER" ]]; then
  # shellcheck source=/dev/null
  source "$RESOLVER"
fi

# Fallback if the resolver is missing or did not set PYTHON_CMD: pick the first interpreter that reports
# Python 3.x (never exec an unversioned `python` blindly -- it may be Python 2).
if [[ -z "${PYTHON_CMD:-}" ]]; then
  for _cand in python3 python; do
    if command -v "$_cand" >/dev/null 2>&1 && "$_cand" --version 2>&1 | grep -q '^Python 3\.'; then
      PYTHON_CMD="$_cand"
      break
    fi
  done
fi

if [[ -z "${PYTHON_CMD:-}" ]]; then
  echo "Python 3 is required but was not found. Install from https://www.python.org/downloads/" >&2
  exit 1
fi

exec "$PYTHON_CMD" "$DRIVER" "$@"
