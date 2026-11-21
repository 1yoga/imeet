# iMeet: замер голосов в Voice Lab через adb.
# Результат: artifacts\voice-metrics.csv, artifacts\voice-metrics-memory.csv, лог artifacts\voice-metrics-log.txt
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'artifacts'
$log = Join-Path $out 'voice-metrics-log.txt'
$csvRuns = Join-Path $out 'voice-metrics.csv'
$csvMem = Join-Path $out 'voice-metrics-memory.csv'
$pkg = 'com.imeet.voicecheck'
$engine = 'ru.kost.ruvoice'

$adb = 'adb'
foreach ($p in @("$env:ANDROID_HOME\platform-tools\adb.exe", "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe")) {
  if ($p -and (Test-Path $p)) { $adb = $p; break }
}

Set-Content -Path $log -Value '' -Encoding UTF8
function Log($m) {
  $line = '[{0:HH:mm:ss}] {1}' -f (Get-Date), $m
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding UTF8
}

function Shell([string]$cmd) { (& $adb shell $cmd 2>&1 | Out-String) }

$tmpXml = Join-Path $env:TEMP 'imeet-ui.xml'
function Get-Ui {
  Shell 'uiautomator dump /sdcard/imeet-ui.xml' | Out-Null
  if (Test-Path $tmpXml) { Remove-Item $tmpXml -Force }
  & $adb pull /sdcard/imeet-ui.xml $tmpXml 2>&1 | Out-Null
  if (-not (Test-Path $tmpXml)) { return $null }
  try { return [xml](Get-Content -Raw -Encoding UTF8 $tmpXml) } catch { return $null }
}
function Nodes($ui) { if ($ui) { @($ui.SelectNodes('//node')) } else { @() } }
function Center($node) {
  if ($node.bounds -match '\[(\d+),(\d+)\]\[(\d+),(\d+)\]') {
    return @{ x = [int](([int]$Matches[1] + [int]$Matches[3]) / 2); y = [int](([int]$Matches[2] + [int]$Matches[4]) / 2) }
  }
  return $null
}

$size = Shell 'wm size'
$W = 1080; $H = 2340
if ($size -match '(\d+)x(\d+)\s*$') { $W = [int]$Matches[1]; $H = [int]$Matches[2] }
if ($size -match 'Override size:\s*(\d+)x(\d+)') { $W = [int]$Matches[1]; $H = [int]$Matches[2] }

function ScrollDown { Shell "input swipe $([int]($W/2)) $([int]($H*0.70)) $([int]($W/2)) $([int]($H*0.35)) 350" | Out-Null; Start-Sleep -Milliseconds 600 }
function ScrollUp { Shell "input swipe $([int]($W/2)) $([int]($H*0.35)) $([int]($W/2)) $([int]($H*0.70)) 350" | Out-Null; Start-Sleep -Milliseconds 600 }

# Найти элемент (с прокруткой) и нажать на его центр.
function Tap([scriptblock]$match, [string]$what) {
  $direction = 'up'
  for ($i = 0; $i -lt 12; $i++) {
    $node = Nodes (Get-Ui) | Where-Object { & $match $_ } | Select-Object -First 1
    if ($node) {
      $c = Center $node
      if ($c.y -gt ($H * 0.12) -and $c.y -lt ($H * 0.88)) {
        Shell "input tap $($c.x) $($c.y)" | Out-Null
        return $true
      }
      if ($c.y -ge ($H * 0.88)) { ScrollDown } else { ScrollUp }
    } else {
      if ($i -eq 4) { $direction = 'down' }
      if ($direction -eq 'down') { ScrollDown } else { ScrollUp }
    }
  }
  Log "Не найдено: $what"
  return $false
}

function TotalPssKb([string]$process) {
  $info = Shell "dumpsys meminfo $process"
  if ($info -match 'TOTAL PSS:\s+(\d+)') { return [int]$Matches[1] }
  if ($info -match 'TOTAL\s+(\d+)') { return [int]$Matches[1] }
  return $null
}
function MiB($kb) { if ($kb) { [math]::Round($kb / 1024, 0) } else { '' } }

# Ждём, пока карточка «Последний запуск» покажет нужный голос и реплику в конечном состоянии.
function Wait-Run([string]$voiceLabel, [string]$phrase, [int]$timeoutSec) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
    $texts = @(Nodes (Get-Ui) | ForEach-Object { $_.text } | Where-Object { $_ })
    $idx = [array]::FindIndex([string[]]$texts, [Predicate[string]]{ param($t) $t.StartsWith('Последний запуск · ') })
    if ($idx -lt 0) { ScrollDown; continue }
    $heading = $texts[$idx]; $cardPhrase = if ($idx + 1 -lt $texts.Count) { $texts[$idx + 1] } else { '' }
    $card = $texts[$idx..([math]::Min($idx + 6, $texts.Count - 1))]
    $state = $card | Where-Object { $_ -eq 'Готово.' -or $_ -eq 'Остановлено.' -or $_ -like 'Воспроизведение не удалось*' } | Select-Object -First 1
    if ($heading -eq "Последний запуск · $voiceLabel" -and $cardPhrase -eq $phrase -and $state) {
      $first = ''; $pss = ''
      foreach ($t in $card) {
        if ($t -match 'Задержка до начала звука:\s*(\d+)') { $first = $Matches[1] }
        if ($t -match '\(PSS\):\s*(\d+)') { $pss = $Matches[1] }
      }
      return @{ state = $state; firstFrameMs = $first; pssMiB = $pss; seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1) }
    }
    Start-Sleep -Milliseconds 300
  }
  return @{ state = 'таймаут'; firstFrameMs = ''; pssMiB = ''; seconds = $timeoutSec }
}

Log "adb: $adb, экран ${W}x${H}"
$devices = & $adb devices 2>&1 | Out-String
Log ($devices.Trim() -replace "`r?`n", ' | ')
if ($devices -notmatch "`tdevice") { Log 'Телефон не подключён по adb.'; exit 1 }

Shell 'input keyevent KEYCODE_WAKEUP' | Out-Null
Shell 'wm dismiss-keyguard' | Out-Null
Shell "am force-stop $pkg" | Out-Null
Start-Sleep -Seconds 1
Shell "am start -W -a android.intent.action.VIEW -d imeet://voice-lab $pkg" | Out-Null
Start-Sleep -Seconds 5

$texts = @(Nodes (Get-Ui) | ForEach-Object { $_.text })
if (-not ($texts -contains 'Voice Lab')) {
  Log 'Ссылка imeet://voice-lab не открыла Voice Lab, открываем с главного экрана'
  Shell "monkey -p $pkg -c android.intent.category.LAUNCHER 1" | Out-Null
  Start-Sleep -Seconds 5
  Tap { param($n) $n.text -like 'Открыть Voice Lab*' } 'Открыть Voice Lab' | Out-Null
  Start-Sleep -Seconds 3
}

$memRows = New-Object System.Collections.Generic.List[object]
$memRows.Add([pscustomobject]@{ point = 'Voice Lab открыт, до озвучки'; imeet_pss_mib = MiB (TotalPssKb $pkg); ruvoice_pss_mib = MiB (TotalPssKb $engine) })

$voices = @(
  'Silero v5_5_ru · xenia', 'Silero v5_5_ru · kseniya', 'Silero v5_5_ru · baya',
  'Silero v5_5_ru · aidar', 'Silero v5_5_ru · eugene', 'Android TextToSpeech'
)
$phrases = @('Короткий вопрос', 'История и вопрос', 'Реакции')
$runs = New-Object System.Collections.Generic.List[object]

foreach ($voice in $voices) {
  Log "Голос: $voice"
  if (-not (Tap { param($n) $n.text -and $n.text.StartsWith($voice) } $voice)) { continue }
  Start-Sleep -Seconds 2
  $unavailable = Nodes (Get-Ui) | Where-Object { $_.text -like 'Нужен RuVoice*' } | Select-Object -First 1
  if ($unavailable) { Log "  недоступен: $($unavailable.text)"; $runs.Add([pscustomobject]@{ voice = $voice; phrase = ''; state = 'голос недоступен'; first_audio_ms = ''; tap_to_done_s = ''; imeet_pss_mib = '' }); continue }
  foreach ($phrase in $phrases) {
    if (-not (Tap { param($n) $n.'content-desc' -eq "Слушать: $phrase" } "Слушать: $phrase")) { continue }
    $r = Wait-Run $voice $phrase 90
    Log ("  {0}: {1}, до звука {2} мс, до конца {3} с, PSS iMeet {4} МиБ" -f $phrase, $r.state, $r.firstFrameMs, $r.seconds, $r.pssMiB)
    $runs.Add([pscustomobject]@{ voice = $voice; phrase = $phrase; state = $r.state; first_audio_ms = $r.firstFrameMs; tap_to_done_s = $r.seconds; imeet_pss_mib = $r.pssMiB })
    Start-Sleep -Milliseconds 500
  }
  $memRows.Add([pscustomobject]@{ point = "после голоса $voice"; imeet_pss_mib = MiB (TotalPssKb $pkg); ruvoice_pss_mib = MiB (TotalPssKb $engine) })
}

$runs | Export-Csv -Path $csvRuns -NoTypeInformation -Encoding UTF8
$memRows | Export-Csv -Path $csvMem -NoTypeInformation -Encoding UTF8
Shell 'screencap -p /sdcard/imeet-voicelab.png' | Out-Null
& $adb pull /sdcard/imeet-voicelab.png (Join-Path $out 'voice-metrics-screen.png') 2>&1 | Out-Null
Log 'MEASURE DONE'
