@echo off
rem Copy Naslukh Kotlin sources into artifacts\naslukh-src (flat, shallow path) so Claude can read them.
setlocal
cd /d "%~dp0.."
set "SRC=D:\Work Projects\my project\naslukh\packages\speech-rn\android\src\main\java"
if not exist "%SRC%" (echo Naslukh sources not found: %SRC% & pause & exit /b 1)
if not exist "artifacts\naslukh-src" mkdir "artifacts\naslukh-src"
for /r "%SRC%" %%F in (*.kt *.java) do copy /y "%%F" "artifacts\naslukh-src\" >nul
dir /b "artifacts\naslukh-src"
echo Done.
pause
