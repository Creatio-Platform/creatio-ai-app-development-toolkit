@echo off
setlocal enabledelayedexpansion
REM ===========================================================================
REM build-dev-toolchain.bat -- thin Windows launcher.
REM   The actual cross-platform logic lives in build_dev_toolchain.py (shared by
REM   this launcher and build-dev-toolchain.sh on macOS/Linux). This wrapper just
REM   resolves a real Python 3 and hands off, forwarding all arguments.
REM   Usage: build-dev-toolchain.bat [release | <branch-or-tag>]
REM
REM   Python is resolved by the repo's tested resolver runtime\scripts\find_python.ps1,
REM   which prefers `py -3`, verifies `--version` reports Python 3.x, and skips the
REM   0-byte Microsoft Store stub (a bare `where python` would hand off to that stub,
REM   silently open the Store, and never run the driver).
REM ===========================================================================
set "HERE=%~dp0"
set "DRIVER=%HERE%build_dev_toolchain.py"
set "RESOLVER=%HERE%..\runtime\scripts\find_python.ps1"

set "PYCMD="
if exist "%RESOLVER%" (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%RESOLVER%' *^> $null; if ($env:PYTHON_CMD) { $env:PYTHON_CMD }"`) do set "PYCMD=%%P"
)
REM Fallback resolver if find_python.ps1 is missing: `py -3` first (never the Store stub), then a
REM python/python3 whose --version actually reports Python 3.x.
if not defined PYCMD (
  py -3 --version >nul 2>&1 && set "PYCMD=py|-3"
)
if not defined PYCMD (
  for %%C in (python3.exe python.exe) do (
    if not defined PYCMD (
      for /f "usebackq tokens=1,2" %%A in (`%%C --version 2^>^&1`) do (
        if /I "%%A"=="Python" (echo %%B| findstr /b "3." >nul && set "PYCMD=%%C")
      )
    )
  )
)
if not defined PYCMD (
  echo. & echo Python 3 is required but was not found on PATH ^(the Microsoft Store stub does not count^).
  echo Install Python 3 from https://www.python.org/downloads/ and re-run.
  exit /b 1
)
if "!PYCMD!"=="py|-3" (
  py -3 "%DRIVER%" %*
) else (
  "!PYCMD!" "%DRIVER%" %*
)
exit /b !errorlevel!
