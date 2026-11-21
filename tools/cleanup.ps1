# iMeet: уборка. Всё уходит в Корзину Windows (можно восстановить). Лог: artifacts\cleanup-log.txt
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName Microsoft.VisualBasic
$root = Split-Path -Parent $PSScriptRoot
$art = Join-Path $root 'artifacts'
$log = Join-Path $art 'cleanup-log.txt'
Set-Content -Path $log -Value "[$(Get-Date -Format 'HH:mm:ss')] cleanup v3 started" -Encoding UTF8
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
  'modules\imeet-supertonic',                 # заменён модулем modules\imeet-voice (без Supertonic)
  'artifacts\native-src',                     # копия старых нативных исходников для разбора
  'docs\naslukh-speech-rn-events.md',         # ТЗ для «Наслух» — реализовано в @naslukh/speech-rn 0.2.0
  'src\core\agent',                          # заготовки контрактов без реализации
  'src\core\runtime',
  'src\core\voice\index.ts',
  'src\core\voice\supertonicTts.ts',           # мост к Supertonic: нигде не импортируется
  'tools\silero-v56',                          # сборка пакета Silero v5.6 — выбрали v5.5
  'tools\add-wave-engine.cmd',                 # движок волны уже стоит
  'tools\update-naslukh.cmd',                  # «Наслух» теперь из npm
  'tools\use-published-naslukh.cmd',
  'vendor',                                    # пустая папка от локального архива «Наслух»
  'assets\icons\ui\leaf.svg',                  # «Спокойная» в макете с иконкой лица, лист не нужен
  'tools\silero-onnx\export_onnx.py',          # первые пробы экспорта Silero; рабочий скрипт — export_v3.py
  'tools\silero-onnx\export_v2.py'
) | ForEach-Object { Recycle (Join-Path $root $_) }

# 4. Служебные метаданные C2PA в картинках (добавляются при передаче файлов из облака Claude):
#    в SVG — блок <metadata>, в JPG — сегмент APP11. На вид картинок не влияют, только раздувают файлы.
$utf8 = New-Object System.Text.UTF8Encoding $false
Get-ChildItem (Join-Path $root 'assets') -Recurse -Filter *.svg | ForEach-Object {
  $text = [IO.File]::ReadAllText($_.FullName)
  $clean = $text -replace ' xmlns:c2pa="[^"]*"', '' -replace '(?s)<metadata>.*?</metadata>', ''
  if ($clean -ne $text) { [IO.File]::WriteAllText($_.FullName, $clean, $utf8); Log "c2pa removed: $($_.Name)" }
}
Get-ChildItem (Join-Path $root 'assets') -Recurse -Filter *.jpg | ForEach-Object {
  $b = [IO.File]::ReadAllBytes($_.FullName)
  if ($b.Length -lt 4 -or $b[0] -ne 0xFF -or $b[1] -ne 0xD8) { return }
  $out = New-Object IO.MemoryStream
  $out.Write($b, 0, 2)
  $i = 2; $changed = $false
  while ($i -lt $b.Length - 4 -and $b[$i] -eq 0xFF -and $b[$i + 1] -ne 0xDA) {
    $len = [int]$b[$i + 2] * 256 + [int]$b[$i + 3]
    if ($b[$i + 1] -eq 0xEB) { $changed = $true } else { $out.Write($b, $i, $len + 2) }
    $i += $len + 2
  }
  $out.Write($b, $i, $b.Length - $i)
  if ($changed) { [IO.File]::WriteAllBytes($_.FullName, $out.ToArray()); Log "c2pa removed: $($_.Name)" }
}

$docs = Join-Path $root 'docs'
if ((Test-Path $docs) -and -not (Get-ChildItem $docs -Force)) { Remove-Item $docs }

Log ("freed: {0} MB (в Корзине — очистите её, чтобы освободить место)" -f [math]::Round($freed / 1MB, 0))
Log 'CLEANUP DONE'
