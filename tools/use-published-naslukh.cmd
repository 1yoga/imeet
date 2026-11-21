@echo off
rem iMeet: switch @naslukh/speech-rn from vendor\*.tgz to the published npm version (waits for the registry).
setlocal
cd /d "%~dp0.."
set "VER=0.2.0"
for /l %%i in (1,1,20) do (
  call npm view @naslukh/speech-rn@%VER% version >nul 2>&1 && goto install
  echo waiting for npm registry... %%i/20
  timeout /t 30 /nobreak >nul
)
echo @naslukh/speech-rn %VER% is still not visible on npm, try later
pause
exit /b 1

:install
call npm install @naslukh/speech-rn@%VER% --save-exact --no-audit --no-fund
if errorlevel 1 (
  echo FAILED
  pause
  exit /b 1
)
echo iMeet now uses @naslukh/speech-rn %VER% from npm. vendor\naslukh-speech-rn-*.tgz can be deleted.
pause
