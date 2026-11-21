@echo off
rem Pull the voice metrics log from the phone and build a summary (latency, memory, speed).
rem Result: artifacts\metrics\voice-metrics.jsonl (raw), voice-metrics-report.md, voice-metrics.csv
setlocal
cd /d "%~dp0.."
if defined ANDROID_HOME set "PATH=%ANDROID_HOME%\platform-tools;%PATH%"
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools" set "PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools;%PATH%"
call :pull
if "%~1"=="" pause
exit /b 0

:pull
if not exist "artifacts\metrics" mkdir "artifacts\metrics"
set "REMOTE=/sdcard/Android/data/com.imeet.voicecheck/files"
adb pull "%REMOTE%/voice-metrics.jsonl" "artifacts\metrics\voice-metrics.jsonl" >nul 2>&1
if errorlevel 1 (echo No metrics on the phone yet - play something in Voice Lab first. & exit /b 0)
adb pull "%REMOTE%/voice-metrics.jsonl.1" "artifacts\metrics\voice-metrics.old.jsonl" >nul 2>&1
py -3 tools\voice_metrics_report.py "artifacts\metrics\voice-metrics.jsonl"
if errorlevel 1 python tools\voice_metrics_report.py "artifacts\metrics\voice-metrics.jsonl"
exit /b 0
