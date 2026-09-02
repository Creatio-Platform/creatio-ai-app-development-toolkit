#!/usr/bin/env bash
# ===========================================================================
# build-dev-toolchain.command -- macOS double-click launcher.
#   Finder opens .command files in a new Terminal window; this wrapper just
#   hands off to build-dev-toolchain.sh (same folder, which resolves Python
#   and runs build_dev_toolchain.py) and then waits for Return, so the output
#   stays readable regardless of Terminal's close-on-exit setting.
#   Knowledge source (release | branch) is chosen interactively at step [0/7].
# ===========================================================================
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/build-dev-toolchain.sh" "$@"
status=$?

echo
if [[ $status -eq 0 ]]; then
  echo "build-dev-toolchain finished successfully."
else
  echo "build-dev-toolchain FAILED with exit code $status -- see the output above."
fi
exit "$status"
