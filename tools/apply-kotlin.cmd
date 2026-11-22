@echo off
chcp 65001 >nul
rem Возвращает правки из modules\imeet-voice\_kt в рабочий модуль (обратное действие к copy-kotlin.cmd).
setlocal
cd /d "%~dp0.."
set "SRC=modules\imeet-voice\_kt"
set "DST=modules\imeet-voice\android\src\main\java\com\imeet\voice"

if not exist "%SRC%\IMeetSileroModule.kt" (
  echo Не найдено: %SRC%\IMeetSileroModule.kt
  exit /b 1
)
copy /y "%SRC%\*.kt" "%DST%\" >nul
if errorlevel 1 (
  echo Не удалось скопировать файлы.
  exit /b 1
)
echo Готово: Kotlin-файлы из %SRC% скопированы в модуль.
endlocal
