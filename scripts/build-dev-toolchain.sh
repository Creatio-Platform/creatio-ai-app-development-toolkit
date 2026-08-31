#!/usr/bin/env bash
# ===========================================================================
# build-dev-toolchain.sh -- thin macOS/Linux launcher.
#   The actual cross-platform logic lives in build_dev_toolchain.py (shared by
#   this launcher and build-dev-toolchain.bat on Windows). This wrapper just
#   locates a Python 3 interpreter and hands off, forwarding all arguments.
#   Usage: ./build-dev-toolchain.sh [release | <branch-or-tag>]
# ===========================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER="$DIR/build_dev_toolchain.py"

for PY in python3 python; do
  if command -v "$PY" >/dev/null 2>&1; then
    exec "$PY" "$DRIVER" "$@"
  fi
done

echo "Python 3 is required but was not found on PATH. Install Python 3 and re-run." >&2
exit 1
