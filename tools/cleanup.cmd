@echo off
rem iMeet: tidy up (Recycle Bin) + commit. Log: artifacts\cleanup-log.txt
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup.ps1"
if errorlevel 1 goto fail

echo.
echo === git commit ===
git add .gitignore app.config.js modules src tools
git diff --cached --quiet && goto nothing
git commit -m "Tidy up: track native TTS module and Windows build config, drop unused Supertonic bridge and one-off scripts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01CG6Gxyr1557TZH23ZjFt1G"
if errorlevel 1 goto fail
goto done
:nothing
echo nothing to commit
:done
echo.
git status --short
echo.
echo CLEANUP OK (files are in the Recycle Bin; commit is local, push it from GitHub Desktop)
pause
exit /b 0

:fail
echo CLEANUP FAILED - see messages above
pause
exit /b 1
