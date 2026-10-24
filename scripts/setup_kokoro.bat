@echo off
rem Double-click to set up Kokoro (Vermeil's online voice) inside the app - no Docker. See setup_kokoro.ps1.
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0setup_kokoro.ps1" %*
pause
