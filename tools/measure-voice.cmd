@echo off
rem iMeet: voice latency and RAM on the USB-connected phone (adb). Results in artifacts\voice-metrics*.csv
cd /d "%~dp0.."
echo [%date% %time%] start > "artifacts\measure-run.txt"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { try { & '%~dp0measure-voice.ps1' } catch { $_ | Out-String } } *>&1 | Out-File -Append -Encoding utf8 'artifacts\measure-run.txt'"
echo [%date% %time%] exit %errorlevel% >> "artifacts\measure-run.txt"
echo Done. See artifacts\voice-metrics.csv
