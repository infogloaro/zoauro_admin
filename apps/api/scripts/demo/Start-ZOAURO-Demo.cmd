@echo off
rem Double-click to start the ZOAURO demo (Docker, demo API + worker + web, browser). See demo-launcher.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-launcher.ps1" start
echo.
pause
