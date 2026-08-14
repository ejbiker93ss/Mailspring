@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-ui-dev.ps1" %*
set "exitCode=%errorlevel%"
if not "%exitCode%"=="0" (
  echo.
  echo Fast UI restart failed. Press any key to close.
  pause >nul
)
exit /b %exitCode%
