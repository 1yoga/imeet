# iMeet: уборка. Файлы уходят в Корзину Windows (можно восстановить). Лог: artifacts\cleanup-log.txt
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName Microsoft.VisualBasic
$root = Split-Path -Parent $PSScriptRoot
$art = Join-Path $root 'artifacts'
$log = Join-Path $art 'cleanup-log.txt'
Set-Content -Path $log -Value "[$(Get-Date -Format 'HH:mm:ss')] cleanup started" -Encoding UTF8
function Log($m) { Add-Content -Path $log -Value $m -Encoding UTF8; Write-Host $m }

$keep = @('imeet-silero55.apk', 'ruvoice-tts-1.1.2.apk', 'ruvoice-pack-cis_ru.zip', 'build-log.txt', 'cleanup-log.txt')
$targets = @()
$targets += Get-ChildItem $art -File | Where-Object {
  $_.Name -notin $keep -and (
    $_.Extension -eq '.png' -or $_.Extension -eq '.apk' -or
    $_.Name -in @('SileroTtsService.kt', 'Speaker.kt', 'ruvoice-tree.json', 'tts-android-dictionary-benchmark.md'))
}
$extra = @(
  (Join-Path $root 'src\core\voice\supertonicTts.ts'),
  (Join-Path $root 'tools\silero-v56')
)

$freed = 0
foreach ($f in $targets) {
  $freed += $f.Length
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($f.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
  Log "recycled: artifacts\$($f.Name) ($([math]::Round($f.Length / 1MB, 1)) MB)"
}
foreach ($p in $extra) {
  if (Test-Path $p -PathType Leaf) { $freed += (Get-Item $p).Length; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin'); Log "recycled: $p" }
  elseif (Test-Path $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin'); Log "recycled: $p\" }
}
Log ("freed: {0} MB (в Корзине, очистите её, чтобы освободить место)" -f [math]::Round($freed / 1MB, 0))

# Копия нативного модуля Supertonic наверх, чтобы его можно было прочитать и переделать (исходники не меняются).
$native = Join-Path $root 'modules\imeet-supertonic\android\src\main\java\com\imeet\supertonic'
$copy = Join-Path $art 'native-src'
New-Item -ItemType Directory -Force -Path $copy | Out-Null
Copy-Item (Join-Path $native '*.kt') $copy -Force
Copy-Item (Join-Path $root 'modules\imeet-supertonic\android\build.gradle') (Join-Path $copy 'build.gradle.txt') -Force
Get-ChildItem (Join-Path $root 'modules\imeet-supertonic\android\src\main\assets') -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Log "asset: $($_.FullName.Substring($root.Length)) $($_.Length)" }
Log "native sources copied to artifacts\native-src"
Log 'CLEANUP DONE'
