@echo off
rem Double-click to stop the ZOAURO demo processes only. "Stop-ZOAURO-Demo.cmd /all" also stops the four containers.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-launcher.ps1" stop %1
echo.
pause
