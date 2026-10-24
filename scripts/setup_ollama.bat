@echo off
rem Puts Ollama (the offline AI) inside this project's tools\ollama folder. Double-click me once.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_ollama.ps1" %*
pause
