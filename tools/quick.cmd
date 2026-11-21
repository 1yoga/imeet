@echo off
rem Fast loop for native changes: incremental build + install + launch, then save the phone log for Claude.
rem No cleanup, no typecheck, no commit (ship.cmd does those). Log: artifacts\build-log.txt, artifacts\logcat.txt
setlocal
cd /d "%~dp0.."
set "CI=1"
set "LOG=%CD%\artifacts\build-log.txt"
if defined ANDROID_HOME set "PATH=%ANDROID_HOME%\platform-tools;%PATH%"
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools" set "PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools;%PATH%"
echo [%date% %time%] quick build > "%LOG%"

if exist "android\app\build.gradle" goto build
echo === prebuild (android folder missing) ===
call npx expo prebuild --platform android --no-install >> "%LOG%" 2>&1
if errorlevel 1 goto fail

:build
rem Voice models are downloaded by the app on first launch: keep them out of the APK.
if exist "%CD%\modules\imeet-voice\android\src\main\assets\silero" rmdir /s /q "%CD%\modules\imeet-voice\android\src\main\assets\silero"
echo === build (incremental, usually 1-2 min) ===
pushd android
call gradlew.bat :app:assembleRelease >> "%LOG%" 2>&1
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" goto fail
copy /y "android\app\build\outputs\apk\release\app-release.apk" "artifacts\imeet-silero55.apk" >nul

echo === install and start on the phone ===
adb install -r "artifacts\imeet-silero55.apk" >> "%LOG%" 2>&1
if errorlevel 1 (echo INSTALL FAILED - is the phone connected? & goto end)
adb logcat -c
adb shell monkey -p com.imeet.voicecheck -c android.intent.category.LAUNCHER 1 >nul 2>&1
echo.
echo Test on the phone now. When done, come back here and press any key:
echo the phone log will be saved to artifacts\logcat.txt for Claude.
pause >nul
adb logcat -d -v time IMeetSilero:V IMeetMetrics:V ReactNativeJS:V AndroidRuntime:E *:E > "artifacts\logcat.txt"
echo Saved artifacts\logcat.txt
call "%~dp0pull-metrics.cmd" nopause
goto end

:fail
echo.
echo BUILD FAILED, see artifacts\build-log.txt
:end
pause
