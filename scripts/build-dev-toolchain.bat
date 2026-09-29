@echo off
setlocal enabledelayedexpansion
REM ===========================================================================
REM build-dev-toolchain.bat -- thin Windows launcher.
REM   The actual cross-platform logic lives in build_dev_toolchain.py (shared by
REM   this launcher and build-dev-toolchain.sh on macOS/Linux). This wrapper just
REM   resolves a real Python 3 and hands off, forwarding all arguments.
REM   Usage: build-dev-toolchain.bat [release | <branch-or-tag>]
REM
REM   Python resolution (side-effect-free first):
REM     1. `py -3` -- the Windows Python Launcher is always a real Python 3, never the
REM        0-byte Microsoft Store stub.
REM     2. Fallback ONLY if that fails: runtime\scripts\find_python.ps1, which skips the
REM        Store stub, verifies `--version` is Python 3.x, and (if nothing is found) may
REM        INSTALL Python via winget.
REM ===========================================================================
set "HERE=%~dp0"
set "DRIVER=%HERE%build_dev_toolchain.py"
set "RESOLVER=%HERE%..\runtime\scripts\find_python.ps1"

set "PYCMD="
py -3 --version >nul 2>&1 && set "PYCMD=py|-3"
if not defined PYCMD if exist "%RESOLVER%" (
  echo Resolving Python 3 via find_python.ps1 ^(may install Python via winget and prompt for confirmation^)...
  set "PY_RESOLVER_PATH=%RESOLVER%"
  REM 1) Run the resolver with output FULLY VISIBLE (no redirection) so any winget install progress /
  REM    consent prompt is shown -- the user must see what is being installed. This may install Python.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "& $env:PY_RESOLVER_PATH"
  REM 2) Re-run it QUIETLY only to read back the resolved interpreter. Python now exists (installed above
  REM    or already present), so this pass does no install and no prompt; suppressing its trivial output is
  REM    harmless. No handoff file is used -- there is no predictable %TEMP% path for another process to
  REM    squat. (The resolver PATH is passed via $env, never interpolated into the -Command text.)
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "& $env:PY_RESOLVER_PATH *^> $null; if ($env:PYTHON_CMD) { $env:PYTHON_CMD }"`) do set "PYCMD=%%P"
)
if not defined PYCMD (
  echo. & echo Python 3 is required but was not found on PATH ^(the Microsoft Store stub does not count^).
  echo Install Python 3 from https://www.python.org/downloads/ and re-run.
  exit /b 1
)
REM Validate the resolved interpreter basename before executing it (defence in depth: never exec an
REM arbitrary path). The py-launcher sentinel is trusted; a resolver-returned path must be python(3).exe/py.exe.
if not "!PYCMD!"=="py|-3" (
  for %%B in ("!PYCMD!") do set "PYBASE=%%~nxB"
  set "PYOK="
  if /i "!PYBASE!"=="python.exe"  set "PYOK=1"
  if /i "!PYBASE!"=="python3.exe" set "PYOK=1"
  if /i "!PYBASE!"=="py.exe"      set "PYOK=1"
  if not defined PYOK (
    echo. & echo Refusing to run an unexpected Python interpreter: "!PYCMD!"
    exit /b 1
  )
)
if "!PYCMD!"=="py|-3" (
  py -3 "%DRIVER%" %*
) else (
  "!PYCMD!" "%DRIVER%" %*
)
exit /b !errorlevel!
