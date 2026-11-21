@echo off
rem Pack the embedded voice models into one zip for first-launch download (same host as Naslukh models).
rem Output: artifacts\voice-models\imeet-voice-models-1.zip and its SHA-256 in sha256.txt
setlocal
cd /d "%~dp0.."
set "SRC=%CD%\artifacts\silero-onnx\result3\app-assets"
set "OUT=%CD%\artifacts\voice-models"
if not exist "%SRC%\vocoder.onnx" (echo Models not found - run tools\silero-onnx\run.cmd first. & pause & exit /b 1)
if not exist "%OUT%" mkdir "%OUT%"
if exist "%OUT%\imeet-voice-models-1.zip" del "%OUT%\imeet-voice-models-1.zip"
echo Packing (a minute)...
powershell -NoProfile -Command "Compress-Archive -Path '%SRC%\*' -DestinationPath '%OUT%\imeet-voice-models-1.zip' -CompressionLevel Optimal; (Get-FileHash '%OUT%\imeet-voice-models-1.zip' -Algorithm SHA256).Hash.ToLower() | Set-Content -NoNewline '%OUT%\sha256.txt'; Get-ChildItem '%SRC%' | Select-Object Name,Length | Format-Table -AutoSize | Out-String | Set-Content '%OUT%\contents.txt'"
if errorlevel 1 (echo FAILED & pause & exit /b 1)
for %%A in ("%OUT%\imeet-voice-models-1.zip") do echo Zip: %%~zA bytes
type "%OUT%\sha256.txt"
echo.
echo Upload artifacts\voice-models\imeet-voice-models-1.zip to the models host
echo (next to naslukh-models-0.1.0.zip) so it opens at https://models.1yoga.link/imeet-voice-models-1.zip
pause
