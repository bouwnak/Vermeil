@echo off
rem Double-click to set up RVC voice clones (downloads 2 helper models, ~530 MB). See setup_rvc.ps1.
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0setup_rvc.ps1" %*
pause
