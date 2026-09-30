#!/usr/bin/env bash
# ===========================================================================
# build-dev-toolchain.sh -- thin macOS/Linux launcher.
#   The actual cross-platform logic lives in build_dev_toolchain.py (shared by
#   this launcher and build-dev-toolchain.bat on Windows). This wrapper just
#   resolves a real Python 3 and hands off, forwarding all arguments.
#   Usage: ./build-dev-toolchain.sh [release | <branch-or-tag>]
#
#   Python resolution order (side-effect-free first):
#     1. A local probe: the first of python3/python whose --version reports Python 3.x.
#     2. Fallback ONLY if that fails: the repo's runtime/scripts/find_python.sh, which
#        additionally tries standard install locations and, if still nothing is found,
#        may INSTALL Python via the system package manager (`brew install python3`, or
#        `sudo apt-get install python3` -- which can prompt for a password).
# ===========================================================================
# NB: -e is intentionally NOT set -- the probe/resolver return non-zero on misses.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER="$DIR/build_dev_toolchain.py"
RESOLVER="$DIR/../runtime/scripts/find_python.sh"

PYTHON_CMD=""
# 1. Local, side-effect-free probe (never installs anything). Reject an unversioned `python` that is
#    actually Python 2 by requiring the --version banner to say Python 3.x.
for _cand in python3 python; do
  if command -v "$_cand" >/dev/null 2>&1 && "$_cand" --version 2>&1 | grep -q '^Python 3\.'; then
    PYTHON_CMD="$_cand"
    break
  fi
done

# 2. Only if the local probe found nothing, fall back to the repo resolver (may install Python).
if [[ -z "$PYTHON_CMD" && -f "$RESOLVER" ]]; then
  set +u                 # the sourced resolver may reference unset vars
  # shellcheck source=/dev/null
  source "$RESOLVER"
  set -u
fi

if [[ -z "${PYTHON_CMD:-}" ]]; then
  echo "Python 3 is required but was not found. Install from https://www.python.org/downloads/" >&2
  exit 1
fi

exec "$PYTHON_CMD" "$DRIVER" "$@"
