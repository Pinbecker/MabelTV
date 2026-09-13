@echo off
setlocal
cd /d "%~dp0"
start "Mabel TV" "%~dp0mabeltv.exe" --fullscreen --database "%~dp0config\mabeltv.db"
