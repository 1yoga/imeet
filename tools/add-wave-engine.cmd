@echo off
rem iMeet: GPU wave engine (Skia + Reanimated). Installs SDK-matched versions, clears Metro cache, builds APK.
setlocal
cd /d "%~dp0.."
set "LOG=%CD%\artifacts\wave-engine-log.txt"
echo [%date% %time%] expo install skia/reanimated/worklets > "%LOG%"
call npx expo install @shopify/react-native-skia react-native-reanimated react-native-worklets >> "%LOG%" 2>&1
if errorlevel 1 goto fail
rem babel-preset-expo adds the worklets plugin by itself; old Metro cache would hide it.
if exist "%TEMP%\metro-cache" rmdir /s /q "%TEMP%\metro-cache"
echo [%date% %time%] WAVE ENGINE OK >> "%LOG%"
echo Skia + Reanimated installed, building APK...
call "%~dp0build-android.cmd"
exit /b 0

:fail
echo [%date% %time%] WAVE ENGINE FAILED >> "%LOG%"
echo FAILED, see artifacts\wave-engine-log.txt
pause
exit /b 1
