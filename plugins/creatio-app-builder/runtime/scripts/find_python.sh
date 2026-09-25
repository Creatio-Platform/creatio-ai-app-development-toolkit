#!/usr/bin/env bash
# find_python.sh — Resolve Python 3 on macOS/Linux, auto-install if missing.
#
# Usage (source into current shell to export PYTHON_CMD):
#   source runtime/scripts/find_python.sh
#   # or:  . runtime/scripts/find_python.sh
#
# Exports PYTHON_CMD to the resolved Python 3 executable path.
# All subsequent python calls should use: "$PYTHON_CMD" script.py ...

_fpython_test() {
    local cmd="$1"
    command -v "$cmd" &>/dev/null || return 1
    local ver
    ver=$("$cmd" --version 2>&1)
    [[ "$ver" =~ ^Python\ 3\. ]] || return 1
    return 0
}

# Already resolved
if [[ -n "${PYTHON_CMD:-}" ]] && _fpython_test "$PYTHON_CMD"; then
    echo "[INFO] Python already resolved: $PYTHON_CMD"
    return 0 2>/dev/null || exit 0
fi

# 1. python3 in PATH
if _fpython_test python3; then
    export PYTHON_CMD=python3
    echo "[INFO] Python found: python3"
    return 0 2>/dev/null || exit 0
fi

# 2. Homebrew paths (Apple Silicon first, then Intel Mac / Linux)
for _fp_path in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
    if _fpython_test "$_fp_path"; then
        export PYTHON_CMD="$_fp_path"
        echo "[INFO] Python found: $PYTHON_CMD"
        return 0 2>/dev/null || exit 0
    fi
done
unset _fp_path

# 3. python (some environments only have unversioned alias)
if _fpython_test python; then
    export PYTHON_CMD=python
    echo "[INFO] Python found: python"
    return 0 2>/dev/null || exit 0
fi

# 4. Auto-install
_fp_os="$(uname -s)"
if [[ "$_fp_os" == "Darwin" ]]; then
    echo "[INFO] Python 3 not found. Installing via Homebrew..."
    if command -v brew &>/dev/null; then
        brew install python3
    else
        echo "[ERROR] Homebrew not found."
        echo "        Install Homebrew: https://brew.sh"
        echo "        Or install Python 3 directly: https://www.python.org/downloads/"
        return 1 2>/dev/null || exit 1
    fi
else
    echo "[INFO] Python 3 not found. Installing via apt-get..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y python3
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y python3
    else
        echo "[ERROR] No supported package manager (apt-get, dnf) found."
        echo "        Install Python 3 manually: https://www.python.org/downloads/"
        return 1 2>/dev/null || exit 1
    fi
fi

# Retry after install
if _fpython_test python3; then
    export PYTHON_CMD=python3
    echo "[INFO] Python installed: $PYTHON_CMD"
    return 0 2>/dev/null || exit 0
fi

echo "[ERROR] Python 3 could not be found or installed automatically."
echo "        Install manually: https://www.python.org/downloads/"
return 1 2>/dev/null || exit 1
