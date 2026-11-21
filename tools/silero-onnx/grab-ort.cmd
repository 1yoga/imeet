@echo off
rem Copies the onnxruntime-android and sherpa-onnx packages from the Gradle cache into artifacts\ort
rem so Claude can fit the onnxruntime Java bridge to the onnxruntime that ships with sherpa-onnx.
setlocal
cd /d "%~dp0..\.."
set "OUT=%CD%\artifacts\ort"
if not exist "%OUT%" mkdir "%OUT%"
set "CACHE=%USERPROFILE%\.gradle\caches\modules-2\files-2.1"
for /r "%CACHE%\com.microsoft.onnxruntime\onnxruntime-android" %%F in (*.aar) do copy /y "%%F" "%OUT%\" >nul && echo found: %%~nxF
for /r "%CACHE%\com.github.k2-fsa.sherpa-onnx" %%F in (*.aar) do copy /y "%%F" "%OUT%\" >nul && echo found: %%~nxF
echo.
dir /b "%OUT%"
echo.
echo Done. Tell Claude the files are in artifacts\ort
pause
