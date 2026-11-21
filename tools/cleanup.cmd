@echo off
rem iMeet: move old APKs/screenshots and Supertonic leftovers to the Recycle Bin. Log: artifacts\cleanup-log.txt
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup.ps1"
pause
