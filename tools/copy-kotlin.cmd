@echo off
chcp 65001 >nul
rem Копирует Kotlin-файлы голосового модуля на уровень выше, чтобы Claude мог их прочитать.
rem Копия лежит в modules\imeet-voice\_kt и исключена из git локально (ship.cmd её не закоммитит).
setlocal
cd /d "%~dp0.."
set "SRC=modules\imeet-voice\android\src\main\java\com\imeet\voice"
set "DST=modules\imeet-voice\_kt"

if not exist "%SRC%\IMeetSileroModule.kt" (
  echo Не найдено: %SRC%\IMeetSileroModule.kt
  exit /b 1
)

if not exist "%DST%" mkdir "%DST%"
copy /y "%SRC%\*.kt" "%DST%\" >nul
if errorlevel 1 (
  echo Не удалось скопировать файлы.
  exit /b 1
)

if exist ".git\info" (
  findstr /x /c:"modules/imeet-voice/_kt/" ".git\info\exclude" >nul 2>nul
  if errorlevel 1 >>".git\info\exclude" echo modules/imeet-voice/_kt/
)

echo Готово: файлы скопированы в %DST%
echo После правок папку _kt можно удалить.
endlocal
