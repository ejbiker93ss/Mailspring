@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0rebuild-and-start.ps1" %*
exit /b %errorlevel%
