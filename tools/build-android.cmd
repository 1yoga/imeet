@echo off
rem iMeet: release APK (arm64-v8a) + install on a USB-connected phone. Log: artifacts\build-log.txt
setlocal
cd /d "%~dp0.."
set "CI=1"
set "LOG=%CD%\artifacts\build-log.txt"
if defined ANDROID_HOME set "PATH=%ANDROID_HOME%\platform-tools;%PATH%"
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools" set "PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools;%PATH%"

echo [%date% %time%] iMeet build started > "%LOG%"
echo Step 1/3: expo prebuild...
call npx expo prebuild --platform android --no-install >> "%LOG%" 2>&1
if errorlevel 1 goto fail

echo Step 2/3: gradle assembleRelease (several minutes)...
pushd android
call gradlew.bat :app:assembleRelease >> "%LOG%" 2>&1
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" goto fail

copy /y "android\app\build\outputs\apk\release\app-release.apk" "artifacts\imeet-silero55.apk" >> "%LOG%" 2>&1
if errorlevel 1 goto fail

echo Step 3/3: install on phone...
where adb >nul 2>&1
if errorlevel 1 (
  echo adb not found, install skipped >> "%LOG%"
) else (
  adb devices >> "%LOG%" 2>&1
  adb install -r "artifacts\imeet-silero55.apk" >> "%LOG%" 2>&1 && echo INSTALL OK >> "%LOG%" || echo INSTALL FAILED >> "%LOG%"
)
echo [%date% %time%] BUILD OK >> "%LOG%"
echo.
echo BUILD OK: artifacts\imeet-silero55.apk  (log: artifacts\build-log.txt)
if not defined NOPAUSE pause
exit /b 0

:fail
echo [%date% %time%] BUILD FAILED >> "%LOG%"
echo.
echo BUILD FAILED, see artifacts\build-log.txt
if not defined NOPAUSE pause
exit /b 1
