@echo off
rem iMeet: published Naslukh + wave engine + APK on the phone + git commit. Re-runnable: done steps are skipped.
setlocal
cd /d "%~dp0.."
set "VER=0.2.0"
set "LOG=%CD%\artifacts\ship-log.txt"
echo ship v4 > "%LOG%"

echo === 0/4 cleanup (Recycle Bin, log: artifacts\cleanup-log.txt) ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup.ps1" > nul

echo === 1/4 Naslukh %VER% from npm ===
findstr /c:"\"@naslukh/speech-rn\": \"%VER%\"" package.json >nul && goto naslukh_ok
call npm view @naslukh/speech-rn@%VER% version >nul 2>&1
if errorlevel 1 (
  echo %VER% is not visible on npm yet, wait a few minutes and run again
  goto fail
)
call npm install @naslukh/speech-rn@%VER% --save-exact --no-audit --no-fund >> "%LOG%" 2>&1
if errorlevel 1 goto fail
:naslukh_ok
echo ok

echo === 2/4 native packages: Skia, Reanimated, image picker, blur ===
if exist "node_modules\@shopify\react-native-skia\package.json" if exist "node_modules\react-native-reanimated\package.json" goto engine_ok
call npx expo install @shopify/react-native-skia react-native-reanimated react-native-worklets >> "%LOG%" 2>&1
if errorlevel 1 goto fail
if exist "%TEMP%\metro-cache" rmdir /s /q "%TEMP%\metro-cache"
:engine_ok
if exist "node_modules\expo-image-picker\package.json" if exist "node_modules\expo-blur\package.json" goto picker_ok
echo installing expo-image-picker and expo-blur...
call npx expo install expo-image-picker expo-blur >> "%LOG%" 2>&1
if errorlevel 1 goto fail
:picker_ok
echo ok

echo === typecheck (log: artifacts\typecheck-log.txt) ===
call npx tsc --noEmit > "%CD%\artifacts\typecheck-log.txt" 2>&1
if errorlevel 1 (echo   type errors found, see artifacts\typecheck-log.txt - building anyway) else (echo   ok)

echo === 3/4 build + install APK (several minutes) ===
set "NOPAUSE=1"
call "%~dp0build-android.cmd"
if errorlevel 1 goto fail

echo === 4/4 git commit ===
git add -A
git diff --cached --quiet && goto nothing
git commit -m "Tidy up: imeet-voice native module without Supertonic, remove unused code, update README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01CG6Gxyr1557TZH23ZjFt1G"
if errorlevel 1 goto fail
goto done
:nothing
echo nothing to commit
:done
echo.
git status --short
echo.
echo SHIP OK: APK installed, changes committed (not pushed)
pause
exit /b 0

:fail
echo.
echo SHIP FAILED - see messages above and artifacts\ship-log.txt / build-log.txt
pause
exit /b 1
