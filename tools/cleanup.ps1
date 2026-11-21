# iMeet: уборка. Всё уходит в Корзину Windows (можно восстановить). Лог: artifacts\cleanup-log.txt
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName Microsoft.VisualBasic
$root = Split-Path -Parent $PSScriptRoot
$art = Join-Path $root 'artifacts'
$log = Join-Path $art 'cleanup-log.txt'
Set-Content -Path $log -Value "[$(Get-Date -Format 'HH:mm:ss')] cleanup v2 started" -Encoding UTF8
function Log($m) { Add-Content -Path $log -Value $m -Encoding UTF8; Write-Host $m }
$freed = 0
function Recycle($path) {
  if (Test-Path $path -PathType Leaf) {
    $script:freed += (Get-Item $path).Length
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
    Log "recycled: $($path.Substring($root.Length + 1))"
  } elseif (Test-Path $path -PathType Container) {
    $script:freed += (Get-ChildItem $path -Recurse -File | Measure-Object Length -Sum).Sum
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
    Log "recycled: $($path.Substring($root.Length + 1))\"
  }
}

# 1. Нативные исходники — копия наверх, чтобы следующий шаг (переименование модуля) можно было подготовить.
$native = Join-Path $root 'modules\imeet-supertonic\android\src\main\java\com\imeet\supertonic'
$copy = Join-Path $art 'native-src'
New-Item -ItemType Directory -Force -Path $copy | Out-Null
Copy-Item (Join-Path $native '*.kt') $copy -Force
Log 'native sources copied to artifacts\native-src'

# 2. artifacts: старые APK, скриншоты, разбор RuVoice, отчёты Supertonic, старые логи.
$keep = @('imeet-silero55.apk', 'ruvoice-tts-1.1.2.apk', 'ruvoice-pack-cis_ru.zip', 'build-log.txt', 'ship-log.txt', 'cleanup-log.txt')
Get-ChildItem $art -File | Where-Object {
  $_.Name -notin $keep -and (
    $_.Extension -in @('.png', '.apk') -or
    $_.Name -in @('SileroTtsService.kt', 'Speaker.kt', 'ruvoice-tree.json', 'tts-android-dictionary-benchmark.md',
                  'naslukh-update-log.txt', 'wave-engine-log.txt'))
} | ForEach-Object { Recycle $_.FullName }

# 3. Код и скрипты, которые больше не нужны.
@(
  'src\core\voice\supertonicTts.ts',           # мост к Supertonic: нигде не импортируется
  'tools\silero-v56',                          # сборка пакета Silero v5.6 — выбрали v5.5
  'tools\add-wave-engine.cmd',                 # движок волны уже стоит
  'tools\update-naslukh.cmd',                  # «Наслух» теперь из npm
  'tools\use-published-naslukh.cmd',
  'vendor'                                     # пустая папка от локального архива «Наслух»
) | ForEach-Object { Recycle (Join-Path $root $_) }

Log ("freed: {0} MB (в Корзине — очистите её, чтобы освободить место)" -f [math]::Round($freed / 1MB, 0))
Log 'CLEANUP DONE'
