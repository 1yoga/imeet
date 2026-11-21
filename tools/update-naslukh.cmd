@echo off
rem iMeet: pack local @naslukh/speech-rn (D:\Work Projects\my project\naslukh) into vendor\, install it, then build the APK.
rem After `npm publish` of the same version, switch package.json back to "@naslukh/speech-rn": "<version>".
setlocal
cd /d "%~dp0.."
set "IMEET=%CD%"
set "NASLUKH=D:\Work Projects\my project\naslukh\packages\speech-rn"
set "LOG=%IMEET%\artifacts\naslukh-update-log.txt"
if not exist "%IMEET%\vendor" mkdir "%IMEET%\vendor"

echo [%date% %time%] npm pack %NASLUKH% > "%LOG%"
pushd "%NASLUKH%"
call npm pack --pack-destination "%IMEET%\vendor" >> "%LOG%" 2>&1
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" goto fail

echo [%date% %time%] npm install >> "%LOG%"
call npm install ./vendor/naslukh-speech-rn-0.2.0.tgz --no-audit --no-fund >> "%LOG%" 2>&1
if errorlevel 1 goto fail
echo [%date% %time%] NASLUKH OK >> "%LOG%"
echo Naslukh 0.2.0 installed, building APK...
call "%~dp0build-android.cmd"
exit /b 0

:fail
echo [%date% %time%] NASLUKH FAILED >> "%LOG%"
echo FAILED, see artifacts\naslukh-update-log.txt
pause
exit /b 1
