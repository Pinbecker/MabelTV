@echo off
setlocal
cd /d "%~dp0"
start "Mabel TV" "%~dp0mabeltv.exe" --fullscreen --channels "%~dp0config\channels.json" --settings "%~dp0config\settings.json"
