@echo off
rem Vermeil installer for Windows - double-click me BEFORE opening the app the first time.
rem Installs Python (if missing), the packages, her voice, Rig ^& animate (UniMate) and a desktop shortcut.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
pause
