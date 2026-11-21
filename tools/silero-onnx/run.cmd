@echo off
rem Silero TTS v5 -> ONNX probe. Output: artifacts\silero-onnx (not in git).
rem First run downloads PyTorch (~200 MB) and the Silero model (~145 MB).
setlocal
cd /d "%~dp0..\.."
set "OUT=%CD%\artifacts\silero-onnx"
if not exist "%OUT%" mkdir "%OUT%"
set "LOG=%OUT%\run-log.txt"
echo run v5 > "%LOG%"

set "PY="
for %%V in (3.12 3.13 3.11) do (
  if not defined PY (
    py -%%V --version >nul 2>&1 && set "PY=py -%%V"
  )
)
if defined PY goto have_py
echo ERROR: Python 3.12 not found. Python 3.14+ has no onnxruntime yet.
echo Install Python 3.12 from https://www.python.org/downloads/release/python-31210/
echo (Windows installer 64-bit; it can live next to your other Python), then run again.
echo ERROR: python 3.11-3.13 not found >> "%LOG%"
goto done

:have_py
echo Python: %PY%
%PY% --version >> "%LOG%" 2>&1

rem Recreate the environment if it was built with another Python version.
if exist "%OUT%\venv\Scripts\python.exe" (
  "%OUT%\venv\Scripts\python.exe" -c "import sys; sys.exit(0 if sys.version_info[:2] in ((3,11),(3,12),(3,13)) else 1)" >nul 2>&1
  if errorlevel 1 (
    echo Removing old environment built with another Python...
    rmdir /s /q "%OUT%\venv"
  )
)
if exist "%OUT%\venv\Scripts\python.exe" goto have_venv
echo === 1/4 creating Python environment ===
%PY% -m venv "%OUT%\venv" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ERROR: could not create venv, see %LOG%
  goto done
)
:have_venv
set "VPY=%OUT%\venv\Scripts\python.exe"

"%VPY%" -c "import torch, onnx, onnxruntime" >nul 2>&1
if not errorlevel 1 goto have_pkgs
echo === 2/4 installing PyTorch, onnx, onnxruntime (a few minutes) ===
"%VPY%" -m pip install --upgrade pip >> "%LOG%" 2>&1
"%VPY%" -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu >> "%LOG%" 2>&1
if errorlevel 1 "%VPY%" -m pip install torch --index-url https://download.pytorch.org/whl/cpu >> "%LOG%" 2>&1
"%VPY%" -m pip install numpy onnx onnxruntime >> "%LOG%" 2>&1
"%VPY%" -c "import torch, onnx, onnxruntime" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ERROR: packages did not install, see %LOG%
  goto done
)
:have_pkgs

set "MODEL=%OUT%\v5_5_ru.pt"
if exist "%MODEL%" goto have_model
echo === 3/4 downloading Silero v5_5_ru ===
curl -L --fail -o "%MODEL%" https://models.silero.ai/models/tts/ru/v5_5_ru.pt
if not errorlevel 1 goto have_model
del "%MODEL%" >nul 2>&1
echo v5_5_ru failed, trying v5_ru...
set "MODEL=%OUT%\v5_ru.pt"
curl -L --fail -o "%MODEL%" https://models.silero.ai/models/tts/ru/v5_ru.pt
if errorlevel 1 (
  del "%MODEL%" >nul 2>&1
  echo ERROR: model download failed
  echo ERROR: model download failed >> "%LOG%"
  goto done
)
:have_model

echo === 4/4 converting and checking (a couple of minutes) ===
set PYTHONIOENCODING=utf-8
"%VPY%" "%~dp0export_v3.py" "%MODEL%" "%OUT%\result3"
if errorlevel 1 echo ERROR: conversion script failed, see artifacts\silero-onnx\result3\log.txt
echo.
echo Done. Report: artifacts\silero-onnx\result3\report.md
if exist "%OUT%\result3" explorer "%OUT%\result3"

:done
echo.
echo Log: %LOG%
pause
