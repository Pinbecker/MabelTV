@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-mabeltv-imager.ps1"
if errorlevel 1 (
  echo.
  echo The installer could not open. Please keep the message above for support.
  pause
  exit /b 1
)
