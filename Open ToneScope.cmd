@echo off
pwsh.exe -NoLogo -NoProfile -File "%~dp0scripts\open-demo.ps1"
if errorlevel 1 pause
